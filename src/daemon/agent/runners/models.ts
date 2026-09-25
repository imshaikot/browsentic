import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { AGENTS, isModelId, type AgentKind, type ModelList } from '@/lib/agents/catalog';
import { stateDir } from '../../lockfile';
import { log } from '../../log';
import type { AgentSettings } from '../config';
import { childEnv } from './drive';
import type { Listing, ModelLister, Runner } from './types';

const FRESH_MS = 6 * 60 * 60_000;
const RETRY_MS = 10 * 60_000;
const LIST_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_MODELS = 500;

const storePath = join(stateDir, 'models.json');

interface Entry {
  bin: string;
  version?: string;
  /** The last list that read cleanly. A failed read never replaces it. */
  ids?: string[];
  at?: number;
  triedAt: number;
  error?: string;
}

type Store = Partial<Record<AgentKind, Entry>>;

type Outcome = { ids: string[] } | { error: string };

const inFlight = new Map<AgentKind, Promise<boolean>>();

/** What the picker offers for this agent right now. Reads the cache and nothing else, so it never waits. */
export function modelsFor(kind: AgentKind): ModelList {
  const entry = readStore()[kind];
  const curated = AGENTS[kind].models;
  if (entry?.ids?.length) return { ids: suggestedFirst(entry.ids, curated), from: 'cli', at: entry.at, error: entry.error };
  return { ids: curated, from: 'catalog', error: entry?.error };
}

/**
 * Reads the agent's own list when it is due, one read per agent at a time. Resolves to whether
 * what the picker shows changed, and never rejects.
 */
export function refreshModels(
  runner: Runner,
  settings: AgentSettings,
  version: string | undefined,
  { force = false } = {},
): Promise<boolean> {
  const lister = runner.models;
  if (!lister) return Promise.resolve(false);
  const running = inFlight.get(runner.kind);
  if (running) return running;
  if (!force && !due(readStore()[runner.kind], settings.bin, version, lister)) return Promise.resolve(false);

  const reading = read(runner.kind, settings.bin, lister)
    .catch((error: unknown): Outcome => ({ error: String(error) }))
    .then((outcome) => record(runner.kind, settings.bin, version, outcome))
    .catch((error: unknown) => {
      log(`could not keep ${AGENTS[runner.kind].label}'s model list: ${String(error)}`);
      return false;
    })
    .finally(() => inFlight.delete(runner.kind));
  inFlight.set(runner.kind, reading);
  return reading;
}

function due(entry: Entry | undefined, bin: string, version: string | undefined, lister: ModelLister): boolean {
  if (!entry || entry.bin !== bin || entry.version !== version) return true;
  const age = Date.now() - entry.triedAt;
  if (entry.error) return age >= RETRY_MS;
  return 'file' in lister || age >= FRESH_MS;
}

async function read(kind: AgentKind, bin: string, lister: ModelLister): Promise<Outcome> {
  if ('file' in lister) {
    const path = lister.file();
    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      return { error: `${AGENTS[kind].label} has not written ${basename(path)} yet. It does the first time it runs.` };
    }
    return accepted(() => lister.parse(content)) ?? { error: `${basename(path)} holds no model Browsentic could read.` };
  }

  const listing = await list(kind, bin, lister.args);
  if ('error' in listing) return listing;
  return accepted(() => lister.parse(listing)) ?? { error: reason(listing) };
}

/** A parser's answer, kept only if it is a usable list: ids a CLI cannot mistake for a flag, no repeats. */
function accepted(parse: () => string[] | null): { ids: string[] } | null {
  let parsed: string[] | null;
  try {
    parsed = parse();
  } catch {
    return null;
  }
  const ids = [...new Set((parsed ?? []).filter(isModelId))].slice(0, MAX_MODELS);
  return ids.length ? { ids } : null;
}

/** The line a person would read as the reason, e.g. "Please sign in to view available models." */
function reason({ stdout, stderr, code }: Listing): string {
  const lines = plain(`${stderr}\n${stdout}`)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const said = lines.find((line) => /error|sign in|log ?in|authenticat/i.test(line));
  if (said) return said.replace(/^error:\s*/i, '').slice(0, 200);
  return code === 0 ? 'It printed no model list Browsentic could read.' : `It exited with code ${code}.`;
}

function list(kind: AgentKind, bin: string, args: string[]): Promise<Listing | { error: string }> {
  const cwd = join(stateDir, 'agents', kind, 'models');
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const command = `"${[basename(bin), ...args].join(' ')}"`;
  const group = process.platform !== 'win32';

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let size = 0;
    let settled = false;
    const done = (result: Listing | { error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(bin, args, {
      cwd,
      env: { ...childEnv(kind), NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: group,
    });
    // The whole group, so a wrapper script's own children go with it.
    const stop = (error: string) => {
      try {
        if (group && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      done({ error });
    };
    const timer = setTimeout(() => stop(`${command} did not answer within ${LIST_TIMEOUT_MS / 1000} s.`), LIST_TIMEOUT_MS);
    timer.unref();

    const collect = (append: (text: string) => void) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) return stop(`${command} printed more than ${MAX_OUTPUT_BYTES / 1024} KB.`);
      append(chunk.toString());
    };
    child.stdout.on('data', collect((text) => (stdout += text)));
    child.stderr.on('data', collect((text) => (stderr += text)));
    child.on('error', (error) => done({ error: error.message }));
    child.on('close', (code) => done({ stdout, stderr, code }));
  });
}

function record(kind: AgentKind, bin: string, version: string | undefined, outcome: Outcome): boolean {
  const store = readStore();
  const before = store[kind];
  const now = Date.now();
  const entry: Entry =
    'ids' in outcome
      ? { bin, version, ids: outcome.ids, at: now, triedAt: now }
      : { bin, version, ids: before?.ids, at: before?.at, triedAt: now, error: outcome.error };
  if ('error' in outcome) log(`could not list ${AGENTS[kind].label}'s models: ${outcome.error}`);
  store[kind] = entry;
  writeStore(store);
  return JSON.stringify([before?.ids, before?.error]) !== JSON.stringify([entry.ids, entry.error]);
}

function readStore(): Store {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(storePath, 'utf8'));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const store: Store = {};
  for (const [kind, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = entryOf(value);
    if (entry && kind in AGENTS) store[kind as AgentKind] = entry;
  }
  return store;
}

function entryOf(value: unknown): Entry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.bin !== 'string' || typeof raw.triedAt !== 'number') return null;
  const ids = Array.isArray(raw.ids) ? raw.ids.filter(isModelId) : undefined;
  return {
    bin: raw.bin,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    ids: ids?.length ? ids : undefined,
    at: typeof raw.at === 'number' ? raw.at : undefined,
    triedAt: raw.triedAt,
    error: typeof raw.error === 'string' ? raw.error.slice(0, 200) : undefined,
  };
}

function writeStore(store: Store): void {
  const temporary = `${storePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, storePath);
}

function suggestedFirst(ids: string[], curated: string[]): string[] {
  return [...curated.filter((id) => ids.includes(id)), ...ids.filter((id) => !curated.includes(id))];
}

const plain = (text: string) => text.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
