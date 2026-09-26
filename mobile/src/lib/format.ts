import type { Sex } from '@/data/types';

/** Elapsed time as the recorder shows it: 7.9 s → "00:07", 64 min → "1:04:00". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

/** "Fri, 25 Sep" */
export function formatToday(date = new Date()): string {
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "54 · M", "8 · F", or whatever part is known */
export function ageSex(age: number | null, sex: Sex | null): string {
  return [age, sex].filter((part) => part != null).join(' · ');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
