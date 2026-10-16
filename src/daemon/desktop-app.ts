/**
 * The Mac and Windows apps lay the CLI down in ~/.browsentic/cli with a marker naming the app itself,
 * which is how the Bridge knows there is an app to ask, and how to start it when a browser asks to
 * pair and nobody is watching.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './lockfile';
import { log } from './log';
import { APP_MARKER } from './npx';

export interface DesktopApp {
  kind: 'mac' | 'windows';
  path: string;
  present: boolean;
}

export function desktopApp(platform: NodeJS.Platform = process.platform, state = stateDir): DesktopApp | null {
  if (platform !== 'darwin' && platform !== 'win32') return null;
  try {
    const marker = JSON.parse(readFileSync(join(state, 'cli', APP_MARKER), 'utf8')) as { app?: unknown };
    if (typeof marker.app !== 'string' || !marker.app) return null;
    return { kind: platform === 'darwin' ? 'mac' : 'windows', path: marker.app, present: existsSync(marker.app) };
  } catch {
    return null;
  }
}

/** In the background on macOS (`open -g`), so it never takes the keyboard from the browser that asked. */
export function launchArgs(app: DesktopApp): [string, string[]] {
  return app.kind === 'mac' ? ['open', ['-g', app.path, '--args', '--pairing']] : [app.path, ['--pairing']];
}

export function launchDesktopApp(app: DesktopApp | null = desktopApp()): boolean {
  if (!app?.present) return false;
  const [file, args] = launchArgs(app);
  try {
    const child = spawn(file, args, { detached: true, stdio: 'ignore' });
    child.on('error', (error) => log(`could not start the app at ${app.path}: ${String(error)}`));
    child.unref();
    log(`started the app at ${app.path} to ask about a browser`);
    return true;
  } catch (error) {
    log(`could not start the app at ${app.path}: ${String(error)}`);
    return false;
  }
}
