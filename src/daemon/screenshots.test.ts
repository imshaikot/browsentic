import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { configPath } from './agent/config';
import { uploadedSkillsDir } from './agent/skills';
import { saveScreenshot, screenshotDir } from './screenshots';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
const defaultDir = join(homedir(), 'browsentic', 'screenshot');

const configure = (value: Record<string, unknown>) => {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(value));
};

beforeEach(() => {
  rmSync(configPath, { force: true });
  rmSync(join(homedir(), 'browsentic'), { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('saving a screenshot', () => {
  test('it is decoded into ~/browsentic/screenshot under a timestamped name, readable only by the user', () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 21, 14, 5, 9), toFake: ['Date'] });
    const path = saveScreenshot(png);
    expect({
      dir: dirname(path),
      name: /^screenshot-20260921-140509-[0-9a-f]{6}\.png$/.test(basename(path)),
      bytes: readFileSync(path).equals(PNG_BYTES),
      mode: statSync(path).mode & 0o777,
    }).toEqual({ dir: defaultDir, name: true, bytes: true, mode: 0o600 });
  });

  test('the extension follows the image type', () => {
    expect(['image/jpeg', 'image/webp', 'image/gif'].map((mime) => basename(saveScreenshot(`data:${mime};base64,AAAA`, { filename: 'shot' })))).toEqual([
      'shot.jpg',
      'shot.webp',
      'shot.png',
    ]);
  });

  test('a filename is kept to a plain name inside the screenshot folder', () => {
    expect(['../../.ssh/authorized_keys', 'Pricing page (dark).png', '...', '.hidden'].map((filename) => basename(saveScreenshot(png, { filename })))).toEqual([
      'authorized_keys.png',
      'Pricing_page__dark_.png',
      expect.stringMatching(/^screenshot-\d{8}-\d{6}\.png$/),
      'hidden.png',
    ]);
    expect(readdirSync(defaultDir)).toHaveLength(4);
  });

  test('a mapping run saves into its staged map, and nowhere outside the skills folder', () => {
    const staged = join(uploadedSkillsDir(), '.staging', 'run-1', 'screenshots');
    expect(dirname(saveScreenshot(png, { dir: staged, filename: '01-home.png' }))).toBe(staged);
    expect(() => saveScreenshot(png, { dir: join(homedir(), '.ssh') })).toThrow(`refusing to write a screenshot outside ${uploadedSkillsDir()}`);
  });

  test('something that is not a base64 data URL is refused', () => {
    expect(() => saveScreenshot('https://example.com/shot.png')).toThrow('screenshot result was not a base64 data URL');
  });
});

describe('where screenshots go', () => {
  test('~/browsentic/screenshot by default', () => {
    expect(screenshotDir()).toBe(defaultDir);
  });

  test('a configured folder may start with ~, be relative to home, or be absolute', () => {
    const dirs = ['~/Pictures/Browsentic', 'Pictures/Browsentic', '/Volumes/Shots', '~'].map((dir) => {
      configure({ screenshotDir: dir });
      return screenshotDir();
    });
    expect(dirs).toEqual([join(homedir(), 'Pictures', 'Browsentic'), join(homedir(), 'Pictures', 'Browsentic'), '/Volumes/Shots', homedir()]);
  });

  test('a blank setting is the default', () => {
    configure({ screenshotDir: '  ' });
    expect(screenshotDir()).toBe(defaultDir);
  });
});
