import { describe, expect, test } from 'vitest';
import { isExecutableName } from './limits';

describe('what never lands on the disk', () => {
  for (const name of ['setup.exe', 'App.DMG', 'install.sh', 'run.ps1', 'lib.so', 'app.apk', 'x.jar', 'a.msi']) {
    test(`isExecutableName(${name}) → true`, () => {
      expect(isExecutableName(name)).toBe(true);
    });
  }

  for (const name of ['expenses.csv', 'invoice.pdf', 'notes.md', 'photo.jpeg', 'archive.zip', 'data.json', 'noext']) {
    test(`isExecutableName(${name}) → false`, () => {
      expect(isExecutableName(name)).toBe(false);
    });
  }

  test('a path is judged by its basename', () => {
    expect(isExecutableName('/home/me/bin/report.csv')).toBe(false);
  });

  test('a dotfile has no extension to judge', () => {
    expect(isExecutableName('.bashrc')).toBe(false);
  });
});
