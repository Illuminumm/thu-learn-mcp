import { load } from 'cheerio';
import { CourseType, type RemoteFile } from 'thu-learn-lib';
import type { Authentication, LearnReader } from '../auth/manager.js';
import type {
  Announcement,
  Assignment,
  Batch,
  Course,
  CourseFile,
  LearnApi,
  Warning,
} from '../domain/models.js';
import { AppError } from '../domain/errors.js';
import { shanghaiDate } from '../domain/time.js';
import { safeSchoolUrl } from '../infra/http.js';

export function nullable(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
export function plainText(html: string | undefined): string | null {
  if (!html) return null;
  const $ = load(html);
  $('script,style,iframe,object').remove();
  $('br').replaceWith('\n');
  $('p,div,li,tr,h1,h2,h3,h4').each((_i, element) => {
    $(element).append('\n');
  });
  return nullable(
    $.root()
      .text()
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n/g, '\n\n'),
  );
}
export function sourceUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = safeSchoolUrl(value);
    const allowed = new Set([
      'wlkcid',
      'xszyid',
      'id',
      'wjid',
      'fileId',
      'mk',
      'sfgk',
      'browser',
      'pageType',
    ]);
    for (const key of [...url.searchParams.keys()])
      if (!allowed.has(key)) url.searchParams.delete(key);
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
/** Retain rich academic content as inert data, never as an executable page. */
export function descriptionHtml(html: string | undefined): string | null {
  if (!html) return null;
  const $ = load(html);
  $('script[type^="math/tex"]').each((_i, element) => {
    $(element).replaceWith($('<code></code>').text($(element).text()));
  });
  $(
    'script,style,iframe,object,embed,base,link,meta,form,input,button,textarea,select,template,svg',
  ).remove();
  const tags = new Set(
    'html head body p div span br hr a img ul ol li dl dt dd table thead tbody tfoot tr th td caption h1 h2 h3 h4 h5 h6 strong em b i u s sub sup pre code blockquote math mrow mi mo mn mfrac msqrt mroot msub msup msubsup munder mover munderover mtable mtr mtd mtext semantics annotation'.split(
      ' ',
    ),
  );
  const attributes = new Set(['alt', 'title', 'colspan', 'rowspan', 'encoding', 'display']);
  $('*').each((_i, element) => {
    if (!('name' in element) || !('attribs' in element)) return;
    if (!tags.has(element.name)) {
      $(element).replaceWith($(element).contents());
      return;
    }
    for (const [key, value] of Object.entries(element.attribs)) {
      if (key === 'src' || key === 'href') {
        let url: string | null = null;
        try {
          url = sourceUrl(new URL(value, 'https://learn.tsinghua.edu.cn').href);
        } catch {
          /* Unsafe URL omitted. */
        }
        if (url) $(element).attr(key, url);
        else $(element).removeAttr(key);
      } else if (!attributes.has(key)) {
        $(element).removeAttr(key);
      }
    }
  });
  return nullable($('body').html() || $.root().html());
}
function attachment(file: RemoteFile, kind: 'assignment' | 'answer') {
  return {
    file_id: nullable(file.id),
    name: nullable(file.name),
    size_display: nullable(file.size),
    source_url: sourceUrl(file.downloadUrl),
    kind,
  };
}
function limitWarnings(size: number, courseId: string, kind: string): Warning[] {
  return size >= 200
    ? [
        {
          code: 'UPSTREAM_LIMIT',
          course_id: courseId,
          message: `${kind} reached the upstream 200-item threshold; results may be incomplete.`,
        },
      ]
    : [];
}
export class ThuLearnAdapter implements LearnApi {
  private readonly caches = new WeakMap<LearnReader, Map<string, { at: number; value: unknown }>>();
  constructor(
    private readonly auth: Authentication,
    private readonly ttlMs = 60_000,
  ) {}
  private query<T>(key: string, operation: (reader: LearnReader) => Promise<T>): Promise<T> {
    return this.auth.run(async (reader) => {
      let cache = this.caches.get(reader);
      if (!cache) {
        cache = new Map();
        this.caches.set(reader, cache);
      }
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < this.ttlMs) return hit.value as T;
      const value = await operation(reader);
      cache.set(key, { at: Date.now(), value });
      return value;
    });
  }
  authStatus() {
    return this.auth.status();
  }
  currentSemester(): Promise<string> {
    return this.query('semester', async (reader) => (await reader.getCurrentSemester()).id);
  }
  courses(semester: string): Promise<Batch<Course>> {
    return this.query(`courses:${semester}`, async (reader) => ({
      items: (await reader.getCourseList(semester, CourseType.STUDENT)).map((c) => ({
        course_id: c.id,
        name: c.name,
        teacher: nullable(c.teacherName),
        semester_id: semester,
        course_number: nullable(c.courseNumber),
        source_url: sourceUrl(c.url),
      })),
      warnings: [],
    }));
  }
  assignments(courseId: string): Promise<Batch<Assignment>> {
    return this.query(`assignments:${courseId}`, async (reader) => {
      const raw = await reader.getHomeworkList(courseId);
      const items: Assignment[] = raw.map((a) => ({
        course_id: courseId,
        assignment_id: a.id,
        base_assignment_id: nullable(a.baseId),
        title: a.title,
        description: plainText(a.description),
        description_html: descriptionHtml(a.description),
        published_at: null,
        deadline: shanghaiDate(a.deadline),
        late_submission_deadline: shanghaiDate(a.lateSubmissionDeadline),
        submission_status:
          a.submitted === true ? 'submitted' : a.submitted === false ? 'unsubmitted' : 'unknown',
        graded: typeof a.graded === 'boolean' ? a.graded : null,
        submitted_at: shanghaiDate(a.submitTime),
        source_url: sourceUrl(a.url),
        attachments: [
          ...(a.attachment ? [attachment(a.attachment, 'assignment')] : []),
          ...(a.answerAttachment ? [attachment(a.answerAttachment, 'answer')] : []),
        ],
      }));
      return {
        items: [...new Map(items.map((a) => [a.assignment_id, a])).values()],
        warnings: limitWarnings(raw.length, courseId, 'Assignments'),
      };
    });
  }
  announcements(courseId: string): Promise<Batch<Announcement>> {
    return this.query(`announcements:${courseId}`, async (reader) => {
      const raw = await reader.getNotificationList(courseId);
      return {
        items: raw.map((a) => ({
          course_id: courseId,
          announcement_id: a.id,
          title: a.title,
          content: plainText(a.content),
          published_at: shanghaiDate(a.publishTime),
          publisher: nullable(a.publisher),
          source_url: sourceUrl(a.url),
        })),
        warnings: limitWarnings(raw.length, courseId, 'Announcements'),
      };
    });
  }
  files(courseId: string): Promise<Batch<CourseFile>> {
    return this.query(`files:${courseId}`, async (reader) => {
      const raw = await reader.getFileList(courseId);
      return {
        items: raw.map((f) => ({
          course_id: courseId,
          file_id: f.fileId,
          entry_id: f.id,
          name: f.remoteFile.name || f.title,
          description: plainText(f.description),
          extension: nullable(f.fileType),
          size_bytes: Number.isFinite(f.rawSize) && f.rawSize >= 0 ? f.rawSize : null,
          size_display: nullable(f.size),
          category_id: nullable(f.category?.id),
          category_name: nullable(f.category?.title),
          uploaded_at: shanghaiDate(f.uploadTime),
          source_url: sourceUrl(f.downloadUrl),
        })),
        warnings: limitWarnings(raw.length, courseId, 'Course files'),
      };
    });
  }
  async download(courseId: string, fileId: string): Promise<Response> {
    const file = (await this.files(courseId)).items.find((f) => f.file_id === fileId);
    if (!file) throw new AppError('NOT_FOUND');
    if (!file.source_url) throw new AppError('UNSAFE_PATH');
    const url = safeSchoolUrl(file.source_url);
    if (url.pathname !== '/b/wlxt/kj/wlkc_kjxxb/student/downloadFile')
      throw new AppError('UNSAFE_PATH');
    return this.auth.fetchWithSession(url);
  }
}
