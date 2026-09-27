import { statSync } from 'node:fs';

/**
 * Windows keeps no POSIX permission bits — every file there reads as 0o666 or 0o444 — so a test
 * asserts a mode only where it means something: on Windows both of these answer null.
 */
export const modeOf = (path: string): number | null => (process.platform === 'win32' ? null : statSync(path).mode & 0o777);

export const bits = (mode: number): number | null => (process.platform === 'win32' ? null : mode);
