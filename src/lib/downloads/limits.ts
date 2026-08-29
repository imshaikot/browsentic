/**
 * What Browsentic will and will not take off a page.
 *
 * A download is a page-initiated write to the user’s disk, reached through an agent that
 * may be reading an injected instruction — the file-upload threat model pointing the other
 * way. These limits are the part of the answer that is not a prompt: a ceiling so a page
 * cannot fill a disk, and a refusal for the file types whose whole purpose is to run.
 *
 * Shared rather than daemon-only because the action’s own descriptions quote the numbers,
 * and a limit the tool description contradicts is a limit callers work around by accident.
 */

export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

/** A captured download handed back to a page travels the socket as base64, so it caps lower. */
export const MAX_ATTACH_BYTES = 25 * 1024 * 1024;

export const DOWNLOAD_TTL_DAYS = 14;

/**
 * Refused outright, whatever the page says the type is. An installer or a script arriving
 * because a page asked for one is not a document with an unusual extension, and there is no
 * version of “download this .dmg for me” worth the failure mode of getting it wrong.
 */
const EXECUTABLE_EXTENSIONS = new Set([
  'app', 'apk', 'appimage', 'bat', 'cmd', 'com', 'deb', 'dll', 'dmg', 'dylib', 'exe',
  'gadget', 'jar', 'js', 'jse', 'ko', 'ksh', 'lnk', 'msi', 'msix', 'mpkg', 'out', 'pkg', 'ps1',
  'psm1', 'reg', 'rpm', 'run', 'scr', 'sh', 'so', 'vb', 'vbe', 'vbs', 'wsf', 'wsh',
]);

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function isExecutableName(name: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(extensionOf(name));
}

const UNITS = ['B', 'KB', 'MB', 'GB'];

export function describeSize(bytes: number): string {
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${unit === 0 ? size : size.toFixed(1)} ${UNITS[unit]}`;
}
