// @vitest-environment node
import { beforeAll, describe, expect, test } from 'vitest';
import { callToolkit, installerSource } from './toolkit';

// The toolkit lives in the page's main world and is called from the content script's isolated
// one. Both share a window and a document, which is all the protocol needs, so one stand-in of
// each plays both worlds.
function makeWorld() {
  const attributes = new Map<string, string>();
  Object.assign(globalThis, {
    window: new EventTarget(),
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        getAttribute: (name: string) => attributes.get(name) ?? null,
        hasAttribute: (name: string) => attributes.has(name),
        removeAttribute: (name: string) => attributes.delete(name),
      },
    },
  });
  return attributes;
}

// The main world evaluates exactly the string CDP would hand it.
const install = (id: string, code: string) => (0, eval)(installerSource(id, code)) as { name: string; arity: number }[];

describe('installing', () => {
  let attributes: Map<string, string>;
  let names: { name: string; arity: number }[];
  beforeAll(() => {
    attributes = makeWorld();
    names = install(
      'kit-1',
      `
      tools.echo = (value) => value;
      tools.add = (a, b) => a + b;
      tools.slow = async (ms) => { await new Promise((d) => setTimeout(d, ms)); return 'late'; };
      tools.boom = () => { throw new Error('page said no'); };
      tools.nothing = () => undefined;
      tools.cyclic = () => { const o = {}; o.self = o; return o; };
      const helper = 1;
    `,
    );
  });

  test('install reports only the functions', () => {
    expect(names.map((entry) => entry.name).sort()).toEqual(['add', 'boom', 'cyclic', 'echo', 'nothing', 'slow']);
  });

  // `/` passes no arguments, so only a zero-argument entry point can become a saved tool.
  test('install reports each arity', () => {
    expect(Object.fromEntries(names.map((entry) => [entry.name, entry.arity]))).toEqual({
      echo: 1,
      add: 2,
      slow: 1,
      boom: 0,
      nothing: 0,
      cyclic: 0,
    });
  });

  test('install stamps the attribute', () => {
    expect(attributes.get('data-browsentic-toolkit')).toBe('kit-1');
  });

  describe('calling across the bridge', () => {
    test('a value round trips', async () => {
      expect(await callToolkit('echo', [{ a: [1, 2] }], 1000)).toEqual({ a: [1, 2] });
    });

    test('several arguments arrive in order', async () => {
      expect(await callToolkit('add', [2, 40], 1000)).toBe(42);
    });

    test('an async function is awaited', async () => {
      expect(await callToolkit('slow', [10], 1000)).toBe('late');
    });

    test('undefined comes back as null', async () => {
      expect(await callToolkit('nothing', [], 1000)).toBeNull();
    });

    test('a throw surfaces as CODE_ERROR', async () => {
      await expect(callToolkit('boom', [], 1000)).rejects.toMatchObject({
        code: 'CODE_ERROR',
        message: expect.stringContaining('page said no'),
      });
    });

    test('an unknown function is rejected by the page', async () => {
      await expect(callToolkit('nope', [], 1000)).rejects.toMatchObject({ code: 'CODE_ERROR' });
    });

    test('a non-JSON return is reported, not hung', async () => {
      await expect(callToolkit('cyclic', [], 1000)).rejects.toMatchObject({ code: 'CODE_ERROR' });
    });

    test('a slow call times out', async () => {
      await expect(callToolkit('slow', [500], 120)).rejects.toMatchObject({ code: 'TIMEOUT' });
    });

    test('the abandoned call did not corrupt the next one', async () => {
      await new Promise((done) => setTimeout(done, 600));
      expect(await callToolkit('add', [1, 1], 1000)).toBe(2);
    });
  });

  describe('re-installing over a live toolkit', () => {
    let second: { name: string; arity: number }[];
    beforeAll(() => {
      second = install('kit-2', `tools.echo = () => 'replaced';`);
    });

    test('re-install swaps the toolkit', () => {
      expect(second.map((entry) => entry.name)).toEqual(['echo']);
    });

    test('re-install restamps the id', () => {
      expect(attributes.get('data-browsentic-toolkit')).toBe('kit-2');
    });

    test('the new function answers', async () => {
      expect(await callToolkit('echo', [], 1000)).toBe('replaced');
    });

    test('the old function is gone', async () => {
      await expect(callToolkit('add', [1, 1], 1000)).rejects.toMatchObject({ code: 'CODE_ERROR' });
    });
  });
});

describe('a page with no toolkit', () => {
  beforeAll(() => {
    makeWorld();
  });

  test('calling into a bare page reports TOOLKIT_MISSING', async () => {
    await expect(async () => callToolkit('echo', [], 1000)).rejects.toMatchObject({ code: 'TOOLKIT_MISSING' });
  });

  test('code defining no functions throws at install', () => {
    expect(() => install('kit-3', 'const x = 1;')).toThrow('no functions');
  });
});
