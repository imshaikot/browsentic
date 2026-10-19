import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { AGENTS, type AgentKind } from '@/lib/agents/catalog';
import { stateDir } from '../../lockfile';
import { listing, stubCli } from './fixtures/support';
import { RUNNERS } from './index';
import { listerFor, modelsFor, refreshModels } from './models';
import type { CommandLister, Listing, ModelLister, Runner } from './types';

const bin = join(stateDir, 'model-bin');
const calls = join(stateDir, 'model-calls.log');
const store = join(stateDir, 'models.json');

/** The version each recording was made with, for a runner that lists per version. */
const RECORDED: Partial<Record<AgentKind, string>> = { opencode: 'opencode v2.0.32' };

const parsed = (kind: AgentKind, output: Listing) => {
  const lister = listerFor(RUNNERS[kind], RECORDED[kind]);
  if (!lister || 'file' in lister) throw new Error(`${kind} does not list its models with a command`);
  return lister.parse(output);
};

const codexCache = () => readFileSync(new URL('./fixtures/codex/0.155.1-models_cache.json', import.meta.url), 'utf8');

describe("each CLI's own list, as recorded", () => {
  test('Antigravity lists every model with its label, in its own order', () => {
    const ids = parsed('antigravity', listing('antigravity', '1.2.11-models.txt'));
    expect([ids?.length, ids?.[0], ids?.at(-1)]).toEqual([14, 'gemini-3.8-flash-high', 'gpt-oss-120b-medium']);
  });

  test('Cursor lists the ids under its heading, and not the tip that follows them', () => {
    const ids = parsed('cursor', listing('cursor', '2026.09.18-models.txt')) ?? [];
    expect([ids[0], ids.includes('composer-2.5'), ids.some((id) => /tip|:/i.test(id)), ids.length]).toEqual(['auto', true, false, 241]);
  });

  test('Grok lists the default and the rest alike', () => {
    expect(parsed('grok', listing('grok', '1.0.40-models.txt'))).toEqual(['grok-4.7']);
  });

  test("Codex's cache yields the models its own picker lists, by its priority, and none of its hidden helpers", () => {
    const lister = listerFor(RUNNERS.codex, 'codex-cli 0.155.1');
    expect(lister && 'file' in lister ? lister.parse(codexCache()) : null).toEqual(['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']);
  });

  // Zen's free models serve only requests carrying OpenCode's own tools, so a Browsentic run on one is refused.
  test("OpenCode 2 lists what Browsentic's own sign-in reaches, by provider and in order, and none of Zen's free models", () => {
    const ids = parsed('opencode', listing('opencode', '2.0.32-models.txt')) ?? [];
    expect([ids.length, ids.every((id) => id.startsWith('opencode/')), ids.includes('opencode/claude-sonnet-5-5')]).toEqual([31, true, true]);
    expect(ids.filter((id) => id.endsWith('-free') || id === 'opencode/big-pickle')).toEqual([]);
    expect(ids).toEqual([...ids].sort());
  });

  test('OpenCode 2 leaves out a model that cannot call a tool, and keeps a free one of any provider but Zen', () => {
    const ids = parsed('opencode', listing('opencode', '2.0.32-models-provider-keys.txt')) ?? [];
    expect([ids.length, ids.includes('google/gemma-4-31b-it'), ids.includes('openai/text-embedding-3-small'), ids.some((id) => id.startsWith('opencode/'))]).toEqual([
      115,
      true,
      false,
      false,
    ]);
  });

  test.each([
    ['antigravity', '1.2.11-models-signed-out.txt'],
    ['cursor', '2026.09.18-models-signed-out.txt'],
    ['grok', '1.0.40-models-signed-out.txt'],
    ['opencode', '2.0.32-models-signed-out.txt'],
  ] as const)('%s signed out is no list at all', (kind, name) => {
    expect(parsed(kind, listing(kind, name))).toBeNull();
  });

  test('every curated fallback names only models its CLI listed', () => {
    const listed = {
      antigravity: parsed('antigravity', listing('antigravity', '1.2.11-models.txt')),
      cursor: parsed('cursor', listing('cursor', '2026.09.18-models.txt')),
      grok: parsed('grok', listing('grok', '1.0.40-models.txt')),
      opencode: parsed('opencode', listing('opencode', '2.0.32-models-provider-keys.txt')),
    };
    const unlisted = Object.entries(listed).flatMap(([kind, ids]) =>
      AGENTS[kind as AgentKind].models.filter((id) => !ids?.includes(id)).map((id) => `${kind}: ${id}`),
    );
    expect(unlisted).toEqual([]);
  });
});

describe('reading and keeping a list', () => {
  const stub = (name: string, body: string) =>
    stubCli(
      join(bin, name),
      `require('node:fs').appendFileSync(${JSON.stringify(calls)}, [${JSON.stringify(name)}, ...process.argv.slice(2)].join(' ') + '\\n');\n${body}`,
    );
  const out = (text: string) => `process.stdout.write(${JSON.stringify(text)});`;
  const spawned = () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []);
  const agy = RUNNERS.antigravity;
  const settings = (path: string) => ({ bin: path });
  const now = vi.spyOn(Date, 'now');

  let listed: string;
  let signedOut: string;

  beforeAll(() => {
    mkdirSync(bin, { recursive: true });
    listed = stub('agy', out('gemini-3.8-flash-high\tFlash\ngemini-3.1-pro-high\tPro\nother-model\tOther\n'));
    signedOut = stub(
      'agy-signed-out',
      `console.error('Fetching available models...'); console.error('Error: Please sign in to view available models.'); process.exit(1);`,
    );
  });

  beforeEach(() => {
    rmSync(store, { force: true });
    rmSync(calls, { force: true });
    now.mockReturnValue(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('with nothing read yet, the picker offers the curated list', () => {
    expect(modelsFor('antigravity')).toEqual({ ids: AGENTS.antigravity.models, from: 'catalog', error: undefined });
  });

  test("a clean read replaces it with the CLI's list, curated picks first", async () => {
    expect(await refreshModels(agy, settings(listed), '1.2.11')).toBe(true);
    expect(modelsFor('antigravity')).toEqual({
      ids: ['gemini-3.1-pro-high', 'gemini-3.8-flash-high', 'other-model'],
      from: 'cli',
      at: 1_000_000,
      error: undefined,
    });
  });

  test('a fresh list is not read again, until six hours on or until asked', async () => {
    await refreshModels(agy, settings(listed), '1.2.11');
    const again = await refreshModels(agy, settings(listed), '1.2.11');
    now.mockReturnValue(1_000_000 + 6 * 60 * 60_000);
    await refreshModels(agy, settings(listed), '1.2.11');
    await refreshModels(agy, settings(listed), '1.2.11', { force: true });
    expect([again, spawned().length]).toEqual([false, 3]);
  });

  test('a new CLI version, or another binary, reads the list again at once', async () => {
    await refreshModels(agy, settings(listed), '1.2.11');
    await refreshModels(agy, settings(listed), '1.2.12');
    await refreshModels(agy, settings(signedOut), '1.2.12');
    expect(spawned()).toEqual(['agy models', 'agy models', 'agy-signed-out models']);
  });

  test('a list that rests on more than the CLI, such as its sign-ins, is read again when that changes, and only then', async () => {
    let signIns = 'zen';
    const stamped: Runner = { ...agy, models: { ...(agy.models as CommandLister), stamp: () => signIns } };
    await refreshModels(stamped, settings(listed), '1.2.11');
    await refreshModels(stamped, settings(listed), '1.2.11');
    signIns = 'zen and anthropic';
    await refreshModels(stamped, settings(listed), '1.2.11');
    expect(spawned()).toEqual(['agy models', 'agy models']);
  });

  test("a lister's own environment reaches the listing, which runs in a folder of its own", async () => {
    const seen = join(bin, 'listed-in.json');
    const reporting = stub(
      'agy-env',
      `require('node:fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify([process.env.LISTED_IN, process.env.NO_COLOR]));\n${out('gemini-3.8-flash-high\tFlash\n')}`,
    );
    const withEnv: Runner = { ...agy, models: { ...(agy.models as CommandLister), env: (cwd) => ({ LISTED_IN: cwd }) } };
    await refreshModels(withEnv, settings(reporting), '1.2.11');
    expect(JSON.parse(readFileSync(seen, 'utf8'))).toEqual([join(stateDir, 'agents', 'antigravity', 'models'), '1']);
  });

  test('a runner that lists per version reads nothing for a version it has no lister for', async () => {
    const versioned: Runner = { ...agy, models: (version) => (version === '2' ? (agy.models as ModelLister) : undefined) };
    expect([await refreshModels(versioned, settings(listed), '1'), await refreshModels(versioned, settings(listed), '2')]).toEqual([false, true]);
    expect(spawned()).toEqual(['agy models']);
  });

  test('a failed read keeps the last good list, and says why', async () => {
    await refreshModels(agy, settings(listed), '1.2.11');
    expect(await refreshModels(agy, settings(signedOut), '1.2.11')).toBe(true);
    expect(modelsFor('antigravity')).toMatchObject({
      ids: ['gemini-3.1-pro-high', 'gemini-3.8-flash-high', 'other-model'],
      from: 'cli',
      at: 1_000_000,
      error: 'Please sign in to view available models.',
    });
  });

  test('a failure is not retried for ten minutes, and the curated list stands in meanwhile', async () => {
    await refreshModels(agy, settings(signedOut), '1.2.11');
    await refreshModels(agy, settings(signedOut), '1.2.11');
    now.mockReturnValue(1_000_000 + 10 * 60_000);
    await refreshModels(agy, settings(signedOut), '1.2.11');
    expect([spawned().length, modelsFor('antigravity').from]).toEqual([2, 'catalog']);
  });

  test('two asks at once share one read', async () => {
    const [first, second] = await Promise.all([refreshModels(agy, settings(listed), '1.2.11'), refreshModels(agy, settings(listed), '1.2.11')]);
    expect([first, second, spawned().length]).toEqual([true, true, 1]);
  });

  test('an id a CLI could read as a flag, or one with spaces, is dropped; a list of nothing else is a failure', async () => {
    const hostile = stub('agy-hostile', out('--yolo\tYolo\nrm -rf\tRm\n'));
    const mixed = stub('agy-mixed', out('--yolo\tYolo\ngemini-3.1-pro-high\tPro\n'));
    await refreshModels(agy, settings(hostile), '1');
    const hostileList = modelsFor('antigravity');
    await refreshModels(agy, settings(mixed), '2');
    expect([hostileList.from, modelsFor('antigravity').ids]).toEqual(['catalog', ['gemini-3.1-pro-high']]);
  });

  test('a parser that throws is a failed read, not a crash', async () => {
    const broken: Runner = { ...agy, models: { args: ['models'], parse: () => { throw new Error('bug'); } } };
    expect(await refreshModels(broken, settings(listed), '1.2.11')).toBe(true);
    expect(modelsFor('antigravity').error).toBe('It printed no model list Browsentic could read.');
  });

  test('a binary that is not there is a failed read', async () => {
    await refreshModels(agy, settings(join(bin, 'no-such-agy')), '1.2.11');
    expect(modelsFor('antigravity').error).toContain('ENOENT');
  });

  test('a CLI that floods its output is stopped at 512 KB', async () => {
    const flood = stub('agy-flood', out('gemini-3.8-flash-high\tFlash\n'.repeat(80_000)));
    await refreshModels(agy, settings(flood), '1.2.11');
    expect(modelsFor('antigravity')).toMatchObject({ from: 'catalog', error: '"agy-flood models" printed more than 512 KB.' });
  });

  test('a CLI that hangs is killed at ten seconds, with whatever it started', async () => {
    const started = join(bin, 'agy-hung.child');
    rmSync(started, { force: true });
    const hung = stub(
      'agy-hung',
      `const child = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 37_250)'], { stdio: 'ignore' });
require('node:fs').writeFileSync(${JSON.stringify(started)}, String(child.pid));
setTimeout(() => {}, 37_250);`,
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const reading = refreshModels(agy, settings(hung), '1.2.11');
    await vi.waitUntil(() => existsSync(started) && readFileSync(started, 'utf8') !== '', { interval: 10, timeout: 5_000 });
    vi.advanceTimersByTime(10_000);
    await reading;
    vi.useRealTimers();
    const child = Number(readFileSync(started, 'utf8'));
    await vi.waitUntil(() => !alive(child), { interval: 20, timeout: 2_000 });
    expect(modelsFor('antigravity').error).toBe('"agy-hung models" did not answer within 10 s.');
  });

  test('a corrupt cache reads as empty, and the next read writes a sound one', async () => {
    writeFileSync(store, '{"antigravity": {"bin": ');
    const before = modelsFor('antigravity').from;
    await refreshModels(agy, settings(listed), '1.2.11');
    expect([before, JSON.parse(readFileSync(store, 'utf8')).antigravity.ids.length]).toEqual(['catalog', 3]);
  });

  test('a hand-edited cache keeps only the ids that are safe to pass on', () => {
    writeFileSync(store, JSON.stringify({ antigravity: { bin: listed, triedAt: 1, ids: ['--yolo', 'gemini-3.1-pro-high'] }, nobody: { bin: 'x', triedAt: 1 } }));
    expect(modelsFor('antigravity').ids).toEqual(['gemini-3.1-pro-high']);
  });

  test("Codex's list is read from its cache file, spawning nothing", async () => {
    const codexHome = join(stateDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'models_cache.json'), codexCache());
    vi.stubEnv('CODEX_HOME', codexHome);
    await refreshModels(RUNNERS.codex, { bin: join(bin, 'no-such-codex') }, 'codex-cli 0.155.1');
    vi.unstubAllEnvs();
    expect(modelsFor('codex')).toMatchObject({ ids: ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'], from: 'cli' });
  });

  test('a Codex that has never run has no cache yet, and says so', async () => {
    vi.stubEnv('CODEX_HOME', join(stateDir, 'no-codex-home'));
    await refreshModels(RUNNERS.codex, { bin: 'codex' }, 'codex-cli 0.155.1');
    vi.unstubAllEnvs();
    expect(modelsFor('codex')).toMatchObject({ from: 'catalog', error: 'Codex has not written models_cache.json yet. It does the first time it runs.' });
  });

  test('an agent with no lister reads nothing', async () => {
    expect([await refreshModels(RUNNERS.claude, { bin: 'claude' }, '1'), modelsFor('claude').ids]).toEqual([false, AGENTS.claude.models]);
  });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
