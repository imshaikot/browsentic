import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { allowed, get, isPrivateAddress } from './sitemap';

type Seed = Parameters<typeof allowed>[1];

const PRIVATE = [
  '10.0.0.1', '127.0.0.1', '127.1.2.3', '0.0.0.0', '169.254.169.254', '172.16.0.1', '172.31.255.1',
  '192.168.1.1', '100.64.0.1', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
  '::1', '::', '0:0:0:0:0:0:0:1',
  'fc00::1', 'fd12:3456::1',
  'fe80::1', 'fe90::1', 'fea0::1', 'febf::1',
  '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe',
  '::127.0.0.1', '2002:7f00:1::', '64:ff9b::a9fe:a9fe',
  'fec0::1', 'ff02::1',
  '', 'not-an-ip', '1.2.3', '999.1.1.1',
];

const PUBLIC = [
  '8.8.8.8', '93.184.216.34', '1.1.1.1', '172.32.0.1', '192.169.1.1', '198.20.0.1', '223.255.255.255',
  '2606:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '2002:0808:0808::', '64:ff9b::808:808',
];

describe('isPrivateAddress', () => {
  for (const address of PRIVATE) {
    test(`isPrivateAddress(${address || '""'}) → true`, () => {
      expect(isPrivateAddress(address)).toBe(true);
    });
  }
  for (const address of PUBLIC) {
    test(`isPrivateAddress(${address}) → false`, () => {
      expect(isPrivateAddress(address)).toBe(false);
    });
  }
});

describe('allowed', () => {
  const seed: Seed = { origin: 'https://example.com', protocol: 'https:', hostname: 'example.com', port: '', address: '93.184.216.34', family: 4 };
  const ALLOWED: [href: string, want: boolean][] = [
    ['https://example.com/sitemap.xml', true],
    ['https://EXAMPLE.com/a', true],
    ['http://example.com/a', false],
    ['https://evil.com/a', false],
    ['https://example.com:8443/a', false],
    ['https://169.254.169.254/latest/meta-data', false],
    ['https://sub.example.com/a', false],
  ];
  for (const [href, want] of ALLOWED) {
    test(`allowed(${href})`, () => {
      expect(allowed(new URL(href), seed)).toBe(want);
    });
  }
});

describe('fetching from a live server', () => {
  const server = createServer((req, res) => {
    if (req.url === '/plain') return res.writeHead(200).end('hello sitemap');
    if (req.url === '/redirect') return res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
    if (req.url === '/big') return res.writeHead(200).end('x'.repeat(5 * 1024 * 1024));
    if (req.url === '/gz') return res.writeHead(200).end(gzipSync(Buffer.from('gzipped body')));
    res.writeHead(404).end();
  });
  let local: Seed;
  const fetchFrom = (path: string) => get(`${local.origin}${path}`, local, { bytes: 0, documents: 0 }, AbortSignal.timeout(10_000));

  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = String((server.address() as AddressInfo).port);
    local = { origin: `http://127.0.0.1:${port}`, protocol: 'http:', hostname: '127.0.0.1', port, address: '127.0.0.1', family: 4 };
  });
  afterAll(() => {
    server.close();
  });

  test('live plain body', async () => {
    expect(await fetchFrom('/plain')).toBe('hello sitemap');
  });

  test('live redirect to metadata refused', async () => {
    expect(await fetchFrom('/redirect')).toBeNull();
  });

  test('live gzip round-trips', async () => {
    expect(await fetchFrom('/gz')).toBe('gzipped body');
  });

  test('live oversize truncated', async () => {
    const big = await fetchFrom('/big');
    expect(big).not.toBeNull();
    expect(big!.length).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  test('live off-origin refused', async () => {
    expect(await get('http://169.254.169.254/', local, { bytes: 0, documents: 0 }, AbortSignal.timeout(10_000))).toBeNull();
  });
});
