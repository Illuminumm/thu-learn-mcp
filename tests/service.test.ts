import { describe, expect, it } from 'vitest';
import { LearnService } from '../src/service/learn.js';
import { DownloadStore } from '../src/infra/download.js';
import { AppError } from '../src/domain/errors.js';
import { assignment, course, mockApi } from './fixtures.js';
import { shanghaiDate } from '../src/domain/time.js';

const paging = { offset: 0, limit: 50 };
const downloads = new DownloadStore('unused', 1024);
describe('LearnService', () => {
  it('paginates courses, assignments and resolves full description', async () => {
    const service = new LearnService(mockApi(), downloads);
    expect((await service.listCourses({ offset: 1, limit: 1 })).data).toMatchObject({
      items: [],
      total: 1,
      next_offset: null,
    });
    expect((await service.listAssignments(paging)).data.items[0]).toMatchObject({
      description_summary: '完整题目\n第二段',
    });
    expect(
      (await service.getAssignment({ course_id: 'c1', assignment_id: 'a1' })).data.description,
    ).toBe(assignment.description);
    await expect(
      service.getAssignment({ course_id: 'bad', assignment_id: 'a1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.getAssignment({ course_id: 'c1', assignment_id: 'bad' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('handles empty lists and file filters', async () => {
    const service = new LearnService(mockApi(), downloads);
    expect(
      (await service.listFiles({ course_id: 'c1', extension: '.PDF', ...paging })).data.total,
    ).toBe(1);
    expect(
      (await service.listFiles({ course_id: 'c1', query: '不存在', ...paging })).data.total,
    ).toBe(0);
    const empty = new LearnService(
      mockApi({ courses: async () => ({ items: [], warnings: [] }) }),
      downloads,
    );
    expect((await empty.listAssignments(paging)).data.items).toEqual([]);
  });
  it('sorts announcements chronologically with missing dates last', async () => {
    const base = await mockApi().announcements('c1');
    const item = base.items[0]!;
    const api = mockApi({
      announcements: async () => ({
        items: [
          { ...item, announcement_id: 'old', published_at: '2026-10-01T00:00:00+08:00' },
          { ...item, announcement_id: 'unknown', published_at: null },
          { ...item, announcement_id: 'new' },
        ],
        warnings: [],
      }),
    });
    const service = new LearnService(api, downloads);
    expect(
      (
        await service.listAnnouncements({ course_id: 'c1', order: 'desc', ...paging })
      ).data.items.map((a) => a.announcement_id),
    ).toEqual(['new', 'old', 'unknown']);
  });
  it('reports partial cross-course failures but aborts authentication and rate-limit failures', async () => {
    const api = mockApi({
      courses: async () => ({ items: [course, { ...course, course_id: 'c2' }], warnings: [] }),
      assignments: async (id) => {
        if (id === 'c2') throw new AppError('NETWORK_ERROR');
        return { items: [assignment], warnings: [] };
      },
    });
    const result = await new LearnService(api, downloads).listAssignments(paging);
    expect(result.complete).toBe(false);
    expect(result.data.total).toBe(1);
    expect(result.warnings[0]?.course_id).toBe('c2');
    for (const code of ['AUTH_REQUIRED', 'RATE_LIMITED'] as const) {
      api.assignments = async () => {
        throw new AppError(code);
      };
      await expect(new LearnService(api, downloads).listAssignments(paging)).rejects.toMatchObject({
        code,
      });
    }
  });
  it('uses an exact Shanghai rolling window and preserves independent deadline/submission state', async () => {
    const items = [
      assignment,
      { ...assignment, assignment_id: 'late', deadline: '2026-10-11T11:59:59+08:00' },
      { ...assignment, assignment_id: 'done', submission_status: 'submitted' as const },
      { ...assignment, assignment_id: 'unknown', submission_status: 'unknown' as const },
      { ...assignment, assignment_id: 'missing', deadline: null },
      { ...assignment, assignment_id: 'outside', deadline: '2026-10-12T12:00:01+08:00' },
      { ...assignment, assignment_id: 'edge', deadline: '2026-10-12T12:00:00+08:00' },
    ];
    const service = new LearnService(
      mockApi({ assignments: async () => ({ items, warnings: [] }) }),
      downloads,
      () => new Date('2026-10-11T04:00:00Z'),
    );
    const options = { ...paging, days: 1, overdue_days: 1, include_submitted: true };
    const result = await service.deadlines(options);
    expect(result.data.items.map((a) => a.assignment_id)).toEqual([
      'late',
      'a1',
      'done',
      'unknown',
      'edge',
    ]);
    expect(result.data.items[0]?.status).toBe('overdue');
    expect(result.data.items.find((a) => a.assignment_id === 'done')?.status).toBe('submitted');
    expect(result.data.items.find((a) => a.assignment_id === 'unknown')?.status).toBe('unknown');
    expect(result.data.unknown_deadline_count).toBe(1);
    expect(result.complete).toBe(false);
    const future = await service.deadlines({
      ...options,
      overdue_days: 0,
      include_submitted: false,
    });
    expect(future.data.items.map((a) => a.assignment_id)).toEqual(['a1', 'unknown', 'edge']);
    expect(shanghaiDate(new Date('2026-10-11T16:00:00Z'))).toBe('2026-10-12T00:00:00.000+08:00');
    expect(shanghaiDate(new Date('invalid'))).toBeNull();
  });
});
