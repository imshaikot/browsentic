import { describe, expect, test } from 'vitest';
import { browserOf, launch, locateBrowsers, sourceFor, storeSteps, storeUrl } from './browsers';

describe('where each browser gets the extension', () => {
  test('every Chromium browser from the Chrome Web Store, Edge too until its own listing is published, Firefox the signed add-on', () => {
    expect([sourceFor('chrome'), sourceFor('brave'), sourceFor('edge'), sourceFor('firefox')]).toEqual([
      'chrome-web-store',
      'chrome-web-store',
      'chrome-web-store',
      'firefox',
    ]);
    expect(storeUrl('firefox', '0.8.0')).toBe(
      'https://github.com/imshaikot/browsentic/releases/download/v0.8.0/browsentic-0.8.0-firefox.xpi',
    );
  });

  test('Edge is told to allow other stores first, Opera to add its helper, and the rest the button they show', () => {
    expect([storeSteps('edge')[0], storeSteps('opera')[0], storeSteps('brave')[0]]).toEqual([
      expect.stringContaining('Allow extensions from other stores'),
      expect.stringContaining('Install Chrome Extensions'),
      'Press “Add to Brave”.',
    ]);
  });
});

describe('browserOf', () => {
  test('reads the brand the extension reported', () => {
    expect(['Google Chrome', 'Microsoft Edge', 'Brave', 'Opera', 'Chromium', 'Firefox', 'Something Else', undefined].map(browserOf)).toEqual([
      'chrome',
      'edge',
      'brave',
      'opera',
      'chromium',
      'firefox',
      undefined,
      undefined,
    ]);
  });
});

describe('locateBrowsers', () => {
  const present = (...paths: string[]) => (path: string) => paths.includes(path);

  test('on a Mac, by the app in /Applications or ~/Applications', () => {
    const found = locateBrowsers({
      platform: 'darwin',
      home: '/Users/me',
      exists: present('/Applications/Google Chrome.app', '/Users/me/Applications/Arc.app'),
    });
    expect(found).toEqual([
      { id: 'chrome', path: '/Applications/Google Chrome.app' },
      { id: 'arc', path: '/Users/me/Applications/Arc.app' },
    ]);
  });

  test('on Windows, by App Paths first and the usual install folders after', () => {
    const found = locateBrowsers({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      registered: (program) => (program === 'msedge.exe' ? 'C:\\Edge\\msedge.exe' : undefined),
      exists: present('C:\\Edge\\msedge.exe', 'C:\\Users\\me\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
    });
    expect(found).toEqual([
      { id: 'edge', path: 'C:\\Edge\\msedge.exe' },
      { id: 'brave', path: 'C:\\Users\\me\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' },
    ]);
  });

  test('on Linux, by a program on PATH', () => {
    const found = locateBrowsers({ platform: 'linux', env: { PATH: '/usr/bin:/snap/bin' }, exists: present('/snap/bin/firefox', '/usr/bin/google-chrome-stable') });
    expect(found).toEqual([
      { id: 'chrome', path: '/usr/bin/google-chrome-stable' },
      { id: 'firefox', path: '/snap/bin/firefox' },
    ]);
  });
});

describe('launch', () => {
  const url = 'https://chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp';

  test('opens the page in the browser that was found, or the default one', () => {
    expect([
      launch(url, { id: 'brave', path: '/Applications/Brave Browser.app' }, 'darwin'),
      launch(url, { id: 'edge', path: 'C:\\Edge\\msedge.exe' }, 'win32'),
      launch(url, undefined, 'win32'),
      launch(url, undefined, 'linux'),
    ]).toEqual([
      ['open', ['-a', '/Applications/Brave Browser.app', url]],
      ['C:\\Edge\\msedge.exe', [url]],
      ['explorer.exe', [url]],
      ['xdg-open', [url]],
    ]);
  });
});
