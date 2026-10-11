import { z } from 'zod';
import { errorCodes } from './errors.js';

const text = z.string().nullable();
export const courseSchema = z.object({
  course_id: z.string(),
  name: z.string(),
  teacher: text,
  semester_id: z.string(),
  course_number: text,
  source_url: text,
});
export type Course = z.infer<typeof courseSchema>;
export const attachmentSchema = z.object({
  file_id: text,
  name: text,
  size_display: text,
  source_url: text,
  kind: z.enum(['assignment', 'answer']),
});
export const assignmentSchema = z.object({
  course_id: z.string(),
  assignment_id: z.string(),
  base_assignment_id: text,
  title: z.string(),
  description: text,
  description_html: text,
  published_at: text,
  deadline: text,
  late_submission_deadline: text,
  submission_status: z.enum(['submitted', 'unsubmitted', 'unknown']),
  graded: z.boolean().nullable(),
  submitted_at: text,
  source_url: text,
  attachments: z.array(attachmentSchema),
});
export type Assignment = z.infer<typeof assignmentSchema>;
export const announcementSchema = z.object({
  course_id: z.string(),
  announcement_id: z.string(),
  title: z.string(),
  content: text,
  published_at: text,
  publisher: text,
  source_url: text,
});
export type Announcement = z.infer<typeof announcementSchema>;
export const fileSchema = z.object({
  course_id: z.string(),
  file_id: z.string(),
  entry_id: z.string(),
  name: z.string(),
  description: text,
  extension: text,
  size_bytes: z.number().nonnegative().nullable(),
  size_display: text,
  category_id: text,
  category_name: text,
  uploaded_at: text,
  source_url: text,
});
export type CourseFile = z.infer<typeof fileSchema>;
export const warningSchema = z.object({ code: z.string(), course_id: text, message: z.string() });
export type Warning = z.infer<typeof warningSchema>;
export interface Batch<T> {
  items: T[];
  warnings: Warning[];
}
export const authSchema = z.object({
  authenticated: z.boolean(),
  needs_reauthentication: z.boolean(),
  state: z.enum(['authenticated', 'missing', 'expired', 'invalid', 'unavailable']),
  checked_at: z.string(),
  guidance: text,
  error_code: z.enum(errorCodes).nullable(),
});
export type AuthStatus = z.infer<typeof authSchema>;
export interface LearnApi {
  authStatus(): Promise<AuthStatus>;
  currentSemester(): Promise<string>;
  courses(semester: string): Promise<Batch<Course>>;
  assignments(courseId: string): Promise<Batch<Assignment>>;
  announcements(courseId: string): Promise<Batch<Announcement>>;
  files(courseId: string): Promise<Batch<CourseFile>>;
  download(courseId: string, fileId: string): Promise<Response>;
}
