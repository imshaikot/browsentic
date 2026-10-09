/**
 * Installing and calling an approved toolkit.
 *
 * The store is the extension's record of what the user actually approved: the code, the
 * tab, and the origin it was approved on. `page.injectCode` is gated by the daemon's
 * policy and `page.runCode` is not, so this file is what keeps the ungated half honest —
 * a call can only ever reach code that came from an approved install, on the same tab
 * and the same site. A page reload wipes the main world but not the record, so the first
 * call afterwards re-installs the same approved source rather than asking again.
 */

import { browser } from 'wxt/browser';
import { z } from 'zod';
import { invokeInTab } from '@/lib/actions/client';
import { injectCode } from '@/lib/actions/page/inject-code';
import { runCode } from '@/lib/actions/page/run-code';
import { installerSource, TOOLKIT_MISSING, type ToolkitEntry } from '@/lib/actions/page/toolkit';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { scopeOf, slugFromPurpose } from '@/lib/skills/saved-tool';
import { send, withDebugger } from './cdp';
import { mainWorldOf, type FrameContext } from './frame-context';
import { getSavedTool, scopeMatches } from './saved-tools';
import { refusalForTab } from './site-guard';

const TOOLKITS_KEY = 'browsentic/codeToolkits';

const FIREFOX_HINT =
  'Installing page code needs Chrome’s debugger, which Firefox does not expose — use the ordinary page tools instead.';

const MAX_ERROR_LENGTH = 600;

const FRAME_CONTEXT_HINT =
  'Chrome’s debugger found no script context for the frame in focus — call page.switchFrame with no arguments and inject from the top document, or enter the frame again once it has loaded.';

interface StoredToolkit {
  id: string;
  origin: string;
  purpose: string;
  code: string;
  entries: ToolkitEntry[];
  installedAt: number;
}

/**
 * What the panel is asked about a second after an install lands. Metadata only: the code
 * stays here, and the panel already has it from the approval it just answered.
 */
export interface ToolOffer {
  toolkitId: string;
  /** The zero-argument entry point a saved tool would call. */
  fn: string;
  purpose: string;
  suggestedSlug: string;
  host: string;
  segment: string;
  origin: string;
}

/** How long after an install the offer appears. Long enough to see the effect land first. */
const OFFER_DELAY_MS = 1_000;

const offerListeners = new Set<(offer: ToolOffer) => void>();

export function onToolOffer(listener: (offer: ToolOffer) => void): void {
  offerListeners.add(listener);
}

type ToolkitMap = Record<string, StoredToolkit>;

export interface EvaluateReply {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

/**
 * Where a toolkit lives: a desktop tab, or the tab in front on the phone. `key` names its record,
 * `evaluate` runs the installer in the page's main world through a debugger, and `call` runs
 * `page.runCode`'s page side, which reaches the toolkit by DOM events from its own world.
 */
export interface ToolkitPlace {
  key: string;
  evaluate(source: string): Promise<ActionResult<EvaluateReply>>;
  call(input: unknown): Promise<ActionResult>;
  /** The blocked-sites refusal for the page there now, if any. */
  refusal(): Promise<ActionResult | null>;
}

export const tabPlace = (tabId: number): ToolkitPlace => ({
  key: String(tabId),
  evaluate: (source) =>
    withDebugger(tabId, FIREFOX_HINT, async (session) => {
      const context = await mainWorldOf(session);
      return context ? success(await evaluate(context, source)) : failure('FRAME_UNREACHABLE', FRAME_CONTEXT_HINT);
    }) as Promise<ActionResult<EvaluateReply>>,
  call: (input) => invokeInTab(tabId, runCode.name, input),
  refusal: () => refusalForTab(tabId),
});

async function readToolkits(): Promise<ToolkitMap> {
  const stored = await browser.storage.session.get(TOOLKITS_KEY);
  return (stored[TOOLKITS_KEY] as ToolkitMap | undefined) ?? {};
}

async function writeToolkit(key: string, toolkit: StoredToolkit | null): Promise<void> {
  const map = await readToolkits();
  if (toolkit) map[key] = toolkit;
  else delete map[key];
  await browser.storage.session.set({ [TOOLKITS_KEY]: map });
}

async function forgetToolkit(key: string): Promise<void> {
  await writeToolkit(key, null);
}

export function serveCodeToolkits(): void {
  browser.tabs.onRemoved.addListener((tabId) => void forgetToolkit(String(tabId)));
}

export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

export async function installToolkit(place: ToolkitPlace, url: string | undefined, input: unknown): Promise<ActionResult> {
  const parsed = injectCode.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));

  const origin = originOf(url);
  if (!origin) {
    return failure('UNSUPPORTED', 'Page code can only be installed on an http(s) page.');
  }

  const { purpose, code, call } = parsed.data;
  const toolkit: StoredToolkit = {
    id: crypto.randomUUID(),
    origin,
    purpose,
    code,
    entries: [],
    installedAt: Date.now(),
  };

  const installed = await evaluateInstaller(place, toolkit);
  if (!installed.ok) return installed;

  toolkit.entries = installed.data as ToolkitEntry[];
  await writeToolkit(place.key, toolkit);

  const summary = {
    toolkitId: toolkit.id,
    origin,
    purpose,
    functions: toolkit.entries.map((entry) => entry.name),
  };

  const called = call ? await runToolkit(place, url, { function: call.function, args: call.args }) : null;
  offerToKeep(toolkit, url, call?.function);

  if (!called) return success(summary);
  return called.ok
    ? success({ ...summary, called: called.data })
    : success({ ...summary, callFailed: called.error });
}

/**
 * Ask, once, whether this is worth keeping. Only a zero-argument entry point can be
 * offered, because `/` invocation passes nothing: prefer the one just called, since that
 * is the effect the user watched happen, and otherwise take a lone zero-argument function.
 * Anything else stays a one-off, which is the honest answer for a toolkit that needs input.
 */
function offerToKeep(toolkit: StoredToolkit, url: string | undefined, called: string | undefined): void {
  const zeroArg = toolkit.entries.filter((entry) => entry.arity === 0);
  const entry = zeroArg.find((candidate) => candidate.name === called) ?? (zeroArg.length === 1 ? zeroArg[0] : null);
  const scope = url ? scopeOf(url) : null;
  if (!entry || !scope) return;

  setTimeout(() => {
    const offer: ToolOffer = {
      toolkitId: toolkit.id,
      fn: entry.name,
      purpose: toolkit.purpose,
      suggestedSlug: slugFromPurpose(toolkit.purpose, entry.name),
      host: scope.host,
      segment: scope.segment,
      origin: toolkit.origin,
    };
    for (const listener of offerListeners) listener(offer);
  }, OFFER_DELAY_MS);
}

/**
 * The `/` path. No guardrail runs here and none should: this code was read and approved
 * when it was saved, the user asked for it by name just now, and the daemon is not in the
 * loop at all — which is also what keeps it out of reach of an MCP client. Blocked sites
 * are the exception: they bind the user's own tools too.
 */
export async function runSavedTool(place: ToolkitPlace, url: string | undefined, toolId: string): Promise<ActionResult> {
  const refused = await place.refusal();
  if (refused) return refused;
  const tool = await getSavedTool(toolId);
  if (!tool) return failure('UNKNOWN_TOOL', 'That tool is no longer saved.');
  if (!scopeMatches(tool, url)) {
    return failure(
      'TOOLKIT_SCOPE',
      `“${tool.name}” was saved for ${tool.origin}/${tool.scope.segment}, and this tab is somewhere else.`,
    );
  }

  const staged: StoredToolkit = {
    id: tool.id,
    origin: tool.origin,
    purpose: tool.description,
    code: tool.code,
    entries: [],
    installedAt: Date.now(),
  };
  const installed = await evaluateInstaller(place, staged);
  if (!installed.ok) return installed;

  staged.entries = installed.data as ToolkitEntry[];
  await writeToolkit(place.key, staged);
  return place.call({ function: tool.fn, args: [], timeoutMs: 10_000 });
}

/**
 * The approved source for a toolkit still installed in this tab, by the id the offer
 * carried. Saving reads it from here rather than from the panel, so the code makes one
 * fewer hop and the panel never has to hold it to hand it back.
 */
export async function toolkitCode(place: Pick<ToolkitPlace, 'key'>, toolkitId: string): Promise<string | null> {
  const toolkit = (await readToolkits())[place.key];
  return toolkit && toolkit.id === toolkitId ? toolkit.code : null;
}

export async function runToolkit(place: ToolkitPlace, url: string | undefined, input: unknown): Promise<ActionResult> {
  const parsed = runCode.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));

  const toolkit = (await readToolkits())[place.key];
  if (!toolkit) {
    return failure(
      TOOLKIT_MISSING,
      'No toolkit is installed in this tab. Call page.injectCode first, and the user will be asked to approve the code.',
    );
  }

  const origin = originOf(url);
  if (origin !== toolkit.origin) {
    await forgetToolkit(place.key);
    return failure(
      'TOOLKIT_SCOPE',
      `That toolkit was approved for ${toolkit.origin}, but this tab is on ${origin ?? 'another page'}. Install it again here if the job continues.`,
    );
  }

  if (!toolkit.entries.some((entry) => entry.name === parsed.data.function)) {
    return failure(
      'UNKNOWN_FUNCTION',
      `This toolkit has no function named “${parsed.data.function}”. It defines: ${toolkit.entries.map((entry) => entry.name).join(', ')}.`,
    );
  }

  const called = await place.call(parsed.data);
  if (called.ok || called.error.code !== TOOLKIT_MISSING) return called;

  const reinstalled = await evaluateInstaller(place, toolkit);
  if (!reinstalled.ok) return reinstalled;
  return place.call(parsed.data);
}

async function evaluateInstaller(place: ToolkitPlace, toolkit: StoredToolkit): Promise<ActionResult> {
  const evaluated = await place.evaluate(installerSource(toolkit.id, toolkit.code));
  if (!evaluated.ok) return evaluated;
  const thrown = evaluated.data.exceptionDetails;
  if (thrown) {
    return failure('CODE_ERROR', `The code failed while installing: ${describeThrow(thrown)}`);
  }
  const entries = evaluated.data.result?.value;
  if (!Array.isArray(entries)) {
    return failure('CODE_ERROR', 'The code installed but reported no functions.');
  }
  return success(entries as ToolkitEntry[]);
}

function evaluate({ session, contextId }: FrameContext, expression: string): Promise<EvaluateReply> {
  return send<EvaluateReply>(session, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    ...(contextId == null ? {} : { contextId }),
  });
}

function describeThrow(thrown: NonNullable<EvaluateReply['exceptionDetails']>): string {
  const detail = thrown.exception?.description ?? thrown.text ?? 'unknown error';
  return detail.length > MAX_ERROR_LENGTH ? `${detail.slice(0, MAX_ERROR_LENGTH)}…` : detail;
}
