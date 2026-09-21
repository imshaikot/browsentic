import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { configPath } from './agent/config';
import { uploadedSkillsDir } from './agent/skills';
import { persistScreenshot } from './daemon';

// Everything else in daemon.ts needs a running daemon with a browser attached, which is the integration suite's job.

const capture = success({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', format: 'png', width: 1280, height: 800 });
const screenshotDir = join(homedir(), 'browsentic', 'screenshot');

const data = (result: ActionResult) => (result.ok ? (result.data as Record<string, unknown>) : {});

beforeEach(() => {
  rmSync(configPath, { force: true });
  rmSync(join(homedir(), 'browsentic'), { recursive: true, force: true });
});

// docs/internals/request-path.md: "persistScreenshot() writes nothing unless the call passed save: true
// or a mapping run supplied a saveTo … A failed write becomes saveError — the capture still succeeds."
describe('keeping a screenshot', () => {
  test('a capture the agent took to look at the page leaves no file behind', () => {
    expect([persistScreenshot('page.screenshot', {}, capture), existsSync(screenshotDir)]).toEqual([capture, false]);
  });

  test('save: true writes it, at mode 0600, and says where', () => {
    const kept = data(persistScreenshot('page.screenshot', { save: true, filename: 'pricing' }, capture));
    expect([kept.savedTo, statSync(String(kept.savedTo)).mode & 0o777, kept.width]).toEqual([join(screenshotDir, 'pricing.png'), 0o600, 1280]);
  });

  test('only a real true asks for a save, since the content script applies the default and the daemon never sees it', () => {
    expect([persistScreenshot('page.screenshot', { save: 'true' }, capture), existsSync(screenshotDir)]).toEqual([capture, false]);
  });

  test("a mapping run's saveTo writes it without being asked, under the run's own name", () => {
    const staged = join(uploadedSkillsDir(), '.staging', 'run-1', 'screenshots');
    const kept = data(persistScreenshot('page.screenshot', { filename: 'ignored' }, capture, { dir: staged, filename: '01-home.png' }));
    expect(kept.savedTo).toBe(join(staged, '01-home.png'));
  });

  test('a save that fails is reported as saveError, and the capture still succeeds', () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ screenshotDir: join(homedir(), 'occupied') }));
    writeFileSync(join(homedir(), 'occupied'), 'a file where the folder should be');
    const result = persistScreenshot('page.screenshot', { save: true }, capture);
    const { saveError, ...rest } = data(result);
    expect([result.ok, rest, saveError]).toEqual([true, data(capture), expect.stringContaining(join(homedir(), 'occupied'))]);
  });

  test('a failed capture, a capture with no image, and every other action pass through untouched', () => {
    const results = [
      persistScreenshot('page.screenshot', { save: true }, failure('TAB_UNREACHABLE', 'chrome:// page')),
      persistScreenshot('page.screenshot', { save: true }, success({ skipped: true })),
      persistScreenshot('page.extractText', { save: true }, capture),
    ];
    expect([results, existsSync(screenshotDir)]).toEqual([[failure('TAB_UNREACHABLE', 'chrome:// page'), success({ skipped: true }), capture], false]);
  });
});
