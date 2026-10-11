export const TIME_ZONE = 'Asia/Shanghai';
const offset = 8 * 60 * 60 * 1000;
export function shanghaiDate(value: Date | undefined): string | null {
  if (!value || !Number.isFinite(value.getTime())) return null;
  return new Date(value.getTime() + offset).toISOString().replace('Z', '+08:00');
}
export function nowShanghai(): string {
  return shanghaiDate(new Date())!;
}
