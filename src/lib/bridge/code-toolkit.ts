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
import { installerSource, TOOLKIT_MISSING } from '@/lib/actions/page/toolkit';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { send, withDebugger, type DebuggerSession } from './cdp';

const TOOLKITS_KEY = 'browsentic/codeToolkits';

const FIREFOX_HINT =
  'Installing page code needs Chrome’s debugger, which Firefox does not expose — use the ordinary page tools instead.';

const MAX_ERROR_LENGTH = 600;

interface StoredToolkit {
  id: string;
  origin: string;
  purpose: string;
  code: string;
  functions: string[];
  installedAt: number;
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
    functions: [],
    installedAt: Date.now(),
  };

  const installed = await evaluateInstaller(tabId, toolkit);
  if (!installed.ok) return installed;

  toolkit.functions = installed.data as string[];
  await writeToolkit(tabId, toolkit);

  const summary = {
    toolkitId: toolkit.id,
    origin,
    purpose,
    functions: toolkit.functions,
  };
  if (!call) return success(summary);

  const called = await runToolkit(tabId, url, { function: call.function, args: call.args });
  return called.ok
    ? success({ ...summary, called: called.data })
    : success({ ...summary, callFailed: called.error });
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

  if (!toolkit.functions.includes(parsed.data.function)) {
    return failure(
      'UNKNOWN_FUNCTION',
      `This toolkit has no function named “${parsed.data.function}”. It defines: ${toolkit.functions.join(', ')}.`,
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
    const names = reply.result?.value;
    if (!Array.isArray(names)) {
      return failure('CODE_ERROR', 'The code installed but reported no functions.');
    }
    return success(names as string[]);
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
