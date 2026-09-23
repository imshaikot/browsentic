import { describe, expect, test } from 'vitest';
import { extensionOf, kindOf, screenFile, type Reader } from './file-screen';

const MB = 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);

const textOnly: Reader = { label: 'Codex', opens: ['text'], openers: () => ['Claude Code'] };
const everything: Reader = { label: 'Claude Code', opens: ['text', 'pdf', 'image'], openers: () => [] };

const file = (name: string, size: number, mime = '') => ({ name, mime, size });
const screen = (bytes: Buffer, reader = everything, name = 'upload', mime = '') => screenFile(file(name, bytes.length, mime), bytes, reader);

describe('what kind of file it is', () => {
  test.each([
    ['a PDF', PDF, 'pdf'],
    ['a PNG', PNG, 'image'],
    ['a JPEG', JPEG, 'image'],
    ['a GIF', Buffer.from('GIF89a\u0001\u0000'), 'image'],
    ['a WebP', WEBP, 'image'],
    ['CSV', Buffer.from('date,amount\n2026-08-01,12.50\n'), 'text'],
    ['UTF-8 prose with accents', Buffer.from('Crème brûlée — 3 €'), 'text'],
    ['a ZIP', ZIP, null],
    ['bytes with a NUL in them', Buffer.from([0x41, 0x00, 0x42]), null],
    ['invalid UTF-8', Buffer.from([0x41, 0xc3, 0x28, 0x42]), null],
  ] as const)('%s is %s', (_, bytes, kind) => {
    expect(kindOf(bytes)).toBe(kind);
  });

  test('a multi-byte character cut by the sample boundary is still text', () => {
    const bytes = Buffer.concat([Buffer.alloc(64 * 1024 - 1, 0x61), Buffer.from('é')]);
    expect(kindOf(bytes)).toBe('text');
  });

  test('the bytes decide, not the name or type the browser gave it', () => {
    expect([screen(PNG, everything, 'notes.txt', 'text/plain'), screen(Buffer.from('plain words'), everything, 'photo.png', 'image/png')]).toEqual([
      { ok: true, kind: 'image', extension: 'png' },
      { ok: true, kind: 'text', extension: 'txt' },
    ]);
  });

  test.each([
    ['a PDF', PDF, 'pdf'],
    ['a PNG', PNG, 'png'],
    ['a JPEG', JPEG, 'jpg'],
    ['a GIF', Buffer.from('GIF89a\u0001\u0000'), 'gif'],
    ['a WebP', WEBP, 'webp'],
    ['text', Buffer.from('plain words'), 'txt'],
  ] as const)('%s is named .%s, whatever it was called', (_, bytes, extension) => {
    expect(extensionOf(bytes, kindOf(bytes) ?? 'text')).toBe(extension);
  });
});

describe('what is rejected before any agent is started', () => {
  test('an empty file', () => {
    expect(screen(Buffer.alloc(0), everything, 'blank.txt')).toEqual({ ok: false, code: 'EMPTY', message: '“blank.txt” is empty.' });
  });

  test('a file over the storage cap, which arrives as a size with no bytes', () => {
    expect(screenFile(file('backup.sql', 42 * MB), Buffer.alloc(0), everything)).toEqual({
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: '“backup.sql” is 42 MB; files over 10 MB are not read.',
    });
  });

  test('an archive, named as one', () => {
    expect(screen(ZIP, everything, 'report.docx')).toEqual({
      ok: false,
      code: 'UNSUPPORTED_TYPE',
      message: '“report.docx” is a ZIP archive (Word, Excel and PowerPoint files are ZIP archives too). Browsentic reads text, PDF and image files.',
    });
  });

  test('any other binary, with the type the browser gave it', () => {
    expect(screen(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]), everything, 'tool', 'application/octet-stream')).toMatchObject({
      code: 'UNSUPPORTED_TYPE',
      message: '“tool” is a binary file (application/octet-stream). Browsentic reads text, PDF and image files.',
    });
  });

  test('a kind over its own limit, below the storage cap', () => {
    expect(screen(Buffer.alloc(6 * MB, 0x61), everything, 'huge.log')).toEqual({
      ok: false,
      code: 'FILE_TOO_LARGE',
      kind: 'text',
      message: '“huge.log” is 6 MB; text files over 5 MB are not read.',
    });
  });

  test('a PDF for an agent that cannot open one, naming the agents that can', () => {
    expect(screen(PDF, textOnly, 'invoice.pdf')).toEqual({
      ok: false,
      code: 'UNSUPPORTED_TYPE',
      kind: 'pdf',
      message: 'Codex cannot open PDFs here. Switch to Claude Code to have it read.',
    });
  });

  test('text reaches every agent', () => {
    expect(screen(Buffer.from('hello'), textOnly)).toEqual({ ok: true, kind: 'text', extension: 'txt' });
  });
});
