import { existsSync, mkdirSync, readFileSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ActionResult } from '@/lib/actions/protocol';
import { configPath } from './agent/config';
import {
  adoptDownload,
  clearDownloads,
  downloadDir,
  resolveAttachment,
  storedDownloads,
  sweepDownloads,
  type CapturedItem,
  type DownloadRecord,
} from './downloads';
import { stateDir } from './lockfile';

// The store's refusals are only worth anything if the refused file is gone afterwards, so these
// run against the real filesystem inside the sandboxed home.
const saveTo = join(stateDir, 'download');
const browserDir = join(stateDir, 'from-browser');

const plant = (name: string, body = 'a,b\n1,2'): CapturedItem => {
  const browserPath = join(browserDir, name);
  writeFileSync(browserPath, body);
  return { browserPath, name, mime: name.endsWith('.csv') ? 'text/csv' : '', size: body.length, url: `https://example.com/${name}`, host: 'example.com' };
};

const refusal = (item: CapturedItem, hosts: string[]) => {
  const result = adoptDownload(item, hosts);
  return [result.ok ? 'adopted' : result.error.code, existsSync(item.browserPath) ? 'left on disk' : 'deleted'];
};

function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}

beforeAll(() => {
  mkdirSync(browserDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify({ downloadDir: saveTo }));
  if (downloadDir() !== saveTo) throw new Error(`the download store saves to ${downloadDir()}, not the sandbox`);
});

afterAll(() => {
  clearDownloads();
});

describe('what the store refuses', () => {
  test('an off-scope download is refused and deleted', () => {
    expect(refusal(plant('leak.csv'), ['other.com'])).toEqual(['DOWNLOAD_OFF_SCOPE', 'deleted']);
  });

  test('an executable is refused and deleted', () => {
    expect(refusal(plant('installer.dmg'), ['example.com'])).toEqual(['DOWNLOAD_REFUSED', 'deleted']);
  });

  test('an oversize download is refused and deleted', () => {
    const big = plant('huge.tar', '');
    truncateSync(big.browserPath, 101 * 1024 * 1024);
    expect(refusal({ ...big, size: 12 }, ['example.com'])).toEqual(['DOWNLOAD_TOO_LARGE', 'deleted']);
  });
});

describe('what the store keeps', () => {
  const csv = 'date,amount,vendor\n2026-08-01,12.50,acme';
  let adopted: ActionResult<DownloadRecord>;
  let kept: DownloadRecord;
  beforeAll(() => {
    adopted = adoptDownload(plant('expenses.csv', csv), ['example.com']);
    kept = unwrap(adopted);
  });

  test('an in-scope document is adopted', () => {
    expect(adopted.ok).toBe(true);
  });

  test('and written where only the user can read it', () => {
    expect(statSync(kept.savedTo).mode & 0o777).toBe(0o600);
  });

  test('with notes about its shape, not its contents', () => {
    expect(kept.notes).toBe('text/csv, 40 B — 2 rows × 3 columns');
  });

  test('an unscoped run may download from anywhere', () => {
    expect(adoptDownload(plant('ok.csv'), ['*']).ok).toBe(true);
  });

  // An agent that supplies its own bytes would be uploading something it composed, under an
  // approval prompt that says "one of the user's files". The internal fields never survive.
  describe('attaching a file', () => {
    test('caller-supplied file bytes are stripped', () => {
      const forged = { fileId: 'f1', target: { text: 'CV' }, name: 'payroll.csv', mime: 'text/csv', content: 'aGVsbG8=' };
      expect(unwrap(resolveAttachment('page.attachFile', forged))).toEqual({ fileId: 'f1', target: { text: 'CV' } });
    });

    test('stripping leaves other actions alone', () => {
      expect(unwrap(resolveAttachment('page.fillInput', { value: 'x', content: 'y' }))).toEqual({ value: 'x', content: 'y' });
    });

    test('a captured download fills them in itself', () => {
      expect(unwrap(resolveAttachment('page.attachFile', { downloadId: kept.id, target: {}, content: 'forged' }))).toEqual({
        downloadId: kept.id,
        target: {},
        name: 'expenses.csv',
        mime: 'text/csv',
        content: Buffer.from(csv).toString('base64'),
      });
    });

    test('naming both sources is refused', () => {
      expect(resolveAttachment('page.attachFile', { fileId: 'f', downloadId: 'd', target: {} })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    test('an unknown download id is a clean failure', () => {
      expect(resolveAttachment('page.attachFile', { downloadId: 'nope', target: {} })).toMatchObject({
        ok: false,
        error: { code: 'DOWNLOAD_NOT_FOUND' },
      });
    });
  });

  describe('expiry', () => {
    let aged: DownloadRecord[];
    beforeAll(() => {
      const index = join(stateDir, 'downloads.json');
      aged = (JSON.parse(readFileSync(index, 'utf8')) as DownloadRecord[]).map((record) => ({ ...record, capturedAt: '2020-01-01T00:00:00.000Z' }));
      writeFileSync(index, JSON.stringify(aged));
    });

    test('captures past the ttl are swept', () => {
      expect(sweepDownloads()).toBe(2);
    });

    test('and their files go with them', () => {
      expect(aged.map((record) => existsSync(record.savedTo))).toEqual([false, false]);
    });

    test('leaving nothing to list', () => {
      expect(storedDownloads()).toHaveLength(0);
    });
  });
});
