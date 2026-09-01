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
import { send, withDebugger, type DebuggerSession } from './cdp';
import { getSavedTool, scopeMatches } from './saved-tools';

const TOOLKITS_KEY = 'browsentic/codeToolkits';

const FIREFOX_HINT =
  'Installing page code needs Chrome’s debugger, which Firefox does not expose — use the ordinary page tools instead.';

const MAX_ERROR_LENGTH = 600;

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

interface EvaluateReply {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

async function readToolkits(): Promise<ToolkitMap> {
  const stored = await browser.storage.session.get(TOOLKITS_KEY);
  return (stored[TOOLKITS_KEY] as ToolkitMap | undefined) ?? {};
}

async function writeToolkit(tabId: number, toolkit: StoredToolkit | null): Promise<void> {
  const map = await readToolkits();
  if (toolkit) map[String(tabId)] = toolkit;
  else delete map[String(tabId)];
  await browser.storage.session.set({ [TOOLKITS_KEY]: map });
}

async function forgetToolkit(tabId: number): Promise<void> {
  await writeToolkit(tabId, null);
}

export function serveCodeToolkits(): void {
  browser.tabs.onRemoved.addListener((tabId) => void forgetToolkit(tabId));
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

export async function installToolkit(tabId: number, url: string | undefined, input: unknown): Promise<ActionResult> {
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

  const installed = await evaluateInstaller(tabId, toolkit);
  if (!installed.ok) return installed;

  toolkit.entries = installed.data as ToolkitEntry[];
  await writeToolkit(tabId, toolkit);

  const summary = {
    toolkitId: toolkit.id,
    origin,
    purpose,
    functions: toolkit.entries.map((entry) => entry.name),
  };

  const called = call ? await runToolkit(tabId, url, { function: call.function, args: call.args }) : null;
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
 * loop at all — which is also what keeps it out of reach of an MCP client.
 */
export async function runSavedTool(tabId: number, url: string | undefined, toolId: string): Promise<ActionResult> {
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
  const installed = await evaluateInstaller(tabId, staged);
  if (!installed.ok) return installed;

  staged.entries = installed.data as ToolkitEntry[];
  await writeToolkit(tabId, staged);
  return invokeInTab(tabId, runCode.name, { function: tool.fn, args: [], timeoutMs: 10_000 });
}

/**
 * The approved source for a toolkit still installed in this tab, by the id the offer
 * carried. Saving reads it from here rather than from the panel, so the code makes one
 * fewer hop and the panel never has to hold it to hand it back.
 */
export async function toolkitCode(tabId: number, toolkitId: string): Promise<string | null> {
  const toolkit = (await readToolkits())[String(tabId)];
  return toolkit && toolkit.id === toolkitId ? toolkit.code : null;
}

export async function runToolkit(tabId: number, url: string | undefined, input: unknown): Promise<ActionResult> {
  const parsed = runCode.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));

  const toolkit = (await readToolkits())[String(tabId)];
  if (!toolkit) {
    return failure(
      TOOLKIT_MISSING,
      'No toolkit is installed in this tab. Call page.injectCode first, and the user will be asked to approve the code.',
    );
  }

  const origin = originOf(url);
  if (origin !== toolkit.origin) {
    await forgetToolkit(tabId);
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

  const called = await invokeInTab(tabId, runCode.name, parsed.data);
  if (called.ok || called.error.code !== TOOLKIT_MISSING) return called;

  const reinstalled = await evaluateInstaller(tabId, toolkit);
  if (!reinstalled.ok) return reinstalled;
  return invokeInTab(tabId, runCode.name, parsed.data);
}

function evaluateInstaller(tabId: number, toolkit: StoredToolkit): Promise<ActionResult> {
  return withDebugger(tabId, FIREFOX_HINT, async (session) => {
    const reply = await evaluate(session, installerSource(toolkit.id, toolkit.code));
    const thrown = reply.exceptionDetails;
    if (thrown) {
      return failure('CODE_ERROR', `The code failed while installing: ${describeThrow(thrown)}`);
    }
    const entries = reply.result?.value;
    if (!Array.isArray(entries)) {
      return failure('CODE_ERROR', 'The code installed but reported no functions.');
    }
    return success(entries as ToolkitEntry[]);
  });
}

function evaluate(session: DebuggerSession, expression: string): Promise<EvaluateReply> {
  return send<EvaluateReply>(session, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
}

function describeThrow(thrown: NonNullable<EvaluateReply['exceptionDetails']>): string {
  const detail = thrown.exception?.description ?? thrown.text ?? 'unknown error';
  return detail.length > MAX_ERROR_LENGTH ? `${detail.slice(0, MAX_ERROR_LENGTH)}…` : detail;
}
