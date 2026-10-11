import { CookieJar } from 'tough-cookie';
import type { Config } from '../src/config.js';
import type { Session, SessionStore } from '../src/auth/store.js';
import type { Assignment, CourseFile, LearnApi } from '../src/domain/models.js';

export const config: Config = {
  sessionDir: '',
  downloadDir: '',
  requestTimeoutMs: 1000,
  retries: 0,
  requestIntervalMs: 0,
  cacheTtlMs: 60_000,
  maxDownloadBytes: 1024 * 1024,
};
export class MemoryStore implements SessionStore {
  constructor(public value: Session | null = null) {}
  async load() {
    return this.value;
  }
  async save(session: Session) {
    this.value = session;
  }
  async clear() {
    this.value = null;
  }
}
export async function sessionStore(): Promise<MemoryStore> {
  const jar = new CookieJar();
  await jar.setCookie(
    'JSESSIONID=test-only-cookie; Path=/; HttpOnly; Secure',
    'https://learn.tsinghua.edu.cn',
  );
  return new MemoryStore({
    version: 1,
    updated_at: '2026-10-11T00:00:00Z',
    cookies: await jar.serialize(),
  });
}
export const course = {
  course_id: 'c1',
  name: '测试课程',
  teacher: '测试教师',
  semester_id: '2026-2027-1',
  course_number: '1001',
  source_url: 'https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/course?wlkcid=c1',
};
export const assignment: Assignment = {
  course_id: 'c1',
  assignment_id: 'a1',
  base_assignment_id: 'b1',
  title: '作业一',
  description: '完整题目\n第二段',
  description_html: '<p>完整题目</p><p>第二段</p>',
  published_at: null,
  deadline: '2026-10-12T00:00:00.000+08:00',
  late_submission_deadline: null,
  submission_status: 'unsubmitted',
  graded: false,
  submitted_at: null,
  source_url: 'https://learn.tsinghua.edu.cn/f/wlxt/kczy/zy/student/viewCj?wlkcid=c1&xszyid=a1',
  attachments: [],
};
export const file: CourseFile = {
  course_id: 'c1',
  file_id: 'f1',
  entry_id: 'entry1',
  name: '讲义',
  description: '第一讲',
  extension: 'pdf',
  size_bytes: 8,
  size_display: '8B',
  category_id: null,
  category_name: null,
  uploaded_at: null,
  source_url:
    'https://learn.tsinghua.edu.cn/b/wlxt/kj/wlkc_kjxxb/student/downloadFile?sfgk=0&wjid=f1',
};
export function mockApi(overrides: Partial<LearnApi> = {}): LearnApi {
  return {
    authStatus: async () => ({
      authenticated: true,
      needs_reauthentication: false,
      state: 'authenticated',
      checked_at: '2026-10-11T12:00:00.000+08:00',
      guidance: null,
      error_code: null,
    }),
    currentSemester: async () => course.semester_id,
    courses: async () => ({ items: [course], warnings: [] }),
    assignments: async () => ({ items: [assignment], warnings: [] }),
    announcements: async () => ({
      items: [
        {
          course_id: 'c1',
          announcement_id: 'n1',
          title: '通知',
          content: '上课',
          published_at: '2026-10-11T12:00:00.000+08:00',
          publisher: '教师',
          source_url: null,
        },
      ],
      warnings: [],
    }),
    files: async () => ({ items: [file], warnings: [] }),
    download: async () =>
      new Response('test-pdf', {
        headers: {
          'content-disposition': "attachment; filename*=UTF-8''%E8%AE%B2%E4%B9%89.pdf",
          'content-type': 'application/pdf',
        },
      }),
    ...overrides,
  };
}
export function schoolNetwork(calls: string[] = []): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push(url.pathname);
    const cookie = new Headers(init?.headers).get('cookie');
    if (!cookie?.includes('JSESSIONID=test-only-cookie'))
      return new Response(null, { status: 403 });
    const path = url.pathname;
    if (path === '/f/wlxt/index/course/student/')
      return new Response('<a href="course?x=1&_csrf=test-only-csrf">课程</a>', {
        headers: { 'content-type': 'text/html' },
      });
    if (url.searchParams.get('_csrf') !== 'test-only-csrf')
      return new Response(null, { status: 403 });
    if (path.endsWith('getCurrentAndNextSemester'))
      return Response.json({
        message: 'success',
        result: {
          id: course.semester_id,
          xnxq: course.semester_id,
          kssj: '2026-09-01',
          jssj: '2027-01-01',
        },
      });
    if (path.includes('loadCourseBySemesterId'))
      return Response.json({
        message: 'success',
        resultList: [
          {
            wlkcid: 'c1',
            zywkcm: '测试课程',
            kcm: '测试课程',
            ywkcm: 'Test',
            jsm: '测试教师',
            jsh: 't1',
            kch: '1001',
            kxh: 1,
          },
        ],
      });
    if (path.includes('v_wlkc_xk_sjddb')) return Response.json([]);
    if (path.endsWith('zyListWj'))
      return Response.json({
        result: 'success',
        object: {
          aaData: [
            {
              xszyid: 'a1',
              zyid: 'b1',
              bt: '作业一',
              wlkcid: 'c1',
              jzsj: '2026-10-12 00:00:00',
              scsj: null,
              pysj: null,
              cj: null,
              zywcfs: 1,
              zytjfs: 2,
            },
          ],
        },
      });
    if (/zyListYjwg|zyListYpg|yxzylist/.test(path))
      return Response.json({ result: 'success', object: { aaData: [] } });
    if (path.endsWith('/viewCj'))
      return new Response(
        '<div class="list fujian clearfix"><div class="ftitle"><a href="/b/wlxt/kczy/zy/student/downloadFile/c1/att1?fileId=att1">题目.pdf</a></div><div class="fl"><span class="color">1M</span></div></div>' +
          '<div class="list fujian clearfix"></div>'.repeat(3),
      );
    if (path.endsWith('/zy/student/detail'))
      return Response.json({ result: 'success', msg: '<p>完整题目</p><p>第二段</p>' });
    if (/pageListXsby/.test(path))
      return Response.json({
        result: 'success',
        object: {
          aaData: path.endsWith('Wgq')
            ? [
                {
                  ggid: 'n1',
                  bt: '通知',
                  ggnr: Buffer.from('<p>下周上课</p>').toString('base64'),
                  fbsj: '2026-10-11 12:00:00',
                  fbrxm: '教师',
                },
              ]
            : [],
        },
      });
    if (path.endsWith('kjxxbByWlkcidAndSizeForStudent'))
      return Response.json({
        result: 'success',
        object: [
          {
            kjxxid: 'entry1',
            wjid: 'f1',
            bt: '讲义',
            ms: '第一讲',
            wjdx: 8,
            fileSize: '8B',
            wjlx: 'pdf',
            scsj: '2026-10-10 09:00:00',
          },
        ],
      });
    if (path.includes('wlkc_kjflb'))
      return Response.json({ result: 'success', object: { rows: [] } });
    if (path.endsWith('/downloadFile'))
      return new Response('test-pdf', { headers: { 'content-type': 'application/pdf' } });
    throw new Error(`Unimplemented synthetic route: ${path}`);
  };
}
