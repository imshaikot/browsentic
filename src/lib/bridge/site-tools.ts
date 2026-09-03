/**
 * Reading and calling the tools a site registers through WebMCP.
 *
 * `document.modelContext` (and its older `navigator.modelContext` alias) lives in the
 * page's main world — a native implementation is visible from the isolated world, but a
 * polyfilled one is not, so both paths go through `scripting.executeScript` with
 * `world: 'MAIN'`. The injected functions are serialized, which is why each one is
 * self-contained, never throws, and hands back plain JSON either way.
 */

import { browser } from 'wxt/browser';
import { z } from 'zod';
import { invokeInTab } from '@/lib/actions/client';
import { callSiteTool } from '@/lib/actions/page/call-site-tool';
import { getPageInfo } from '@/lib/actions/page/get-page-info';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { originOf } from './code-toolkit';

const TIMEOUT_MARKER = '⟪browsentic:site-tool-timeout⟫';

interface SiteToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
}

type ReadReply =
  | { ok: true; api: string | null; tools: SiteToolDescriptor[] }
  | { ok: false; error: string };

type CallReply =
  | { ok: true; value: unknown }
  | { ok: false; code: string; error: string; tools?: string[] };

async function readRegisteredTools(withSchemas: boolean): Promise<ReadReply> {
  try {
    const fromDocument = (document as { modelContext?: Record<string, unknown> }).modelContext;
    const fromNavigator = (navigator as { modelContext?: Record<string, unknown> }).modelContext;
    const host = fromDocument ?? fromNavigator;
    if (!host) return { ok: true, api: null, tools: [] };

    const api = fromDocument ? 'document.modelContext' : 'navigator.modelContext';
    const enumerate = host.getTools ?? host.listTools;
    if (typeof enumerate !== 'function') return { ok: true, api, tools: [] };

    const raw = await Promise.resolve((enumerate as () => unknown).call(host));
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { tools?: unknown } | null)?.tools)
        ? ((raw as { tools: unknown[] }).tools)
        : [];

    const safe = (value: unknown) => {
      try {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
      } catch {
        return undefined;
      }
    };

    const tools = list
      .filter((tool): tool is Record<string, unknown> => !!tool && typeof (tool as { name?: unknown }).name === 'string')
      .map((tool) => ({
        name: String(tool.name),
        description:
          typeof tool.description === 'string' ? tool.description.slice(0, withSchemas ? 500 : 140) : undefined,
        ...(withSchemas
          ? {
              inputSchema: safe(tool.inputSchema ?? tool.input_schema ?? tool.parameters),
              annotations: safe(tool.annotations),
            }
          : {}),
      }));
    return { ok: true, api, tools };
  } catch (error) {
    return { ok: false, error: String((error as { message?: unknown } | null)?.message ?? error) };
  }
}

async function callRegisteredTool(
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  timeoutMarker: string,
): Promise<CallReply> {
  try {
    const fromDocument = (document as { modelContext?: Record<string, unknown> }).modelContext;
    const fromNavigator = (navigator as { modelContext?: Record<string, unknown> }).modelContext;
    const host = fromDocument ?? fromNavigator;
    if (!host) return { ok: false, code: 'NO_SITE_TOOLS', error: 'This site registers no WebMCP tools.' };

    const enumerate = host.getTools ?? host.listTools;
    if (typeof enumerate === 'function') {
      const raw = await Promise.resolve((enumerate as () => unknown).call(host));
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { tools?: unknown } | null)?.tools)
          ? ((raw as { tools: unknown[] }).tools)
          : [];
      const names = list
        .map((tool) => (tool as { name?: unknown } | null)?.name)
        .filter((candidate): candidate is string => typeof candidate === 'string');
      if (names.length && !names.includes(name)) {
        return {
          ok: false,
          code: 'SITE_TOOL_NOT_FOUND',
          error: `This site registers no tool named “${name}”.`,
          tools: names,
        };
      }
    }

    const invoke = host.executeTool ?? host.callTool;
    if (typeof invoke !== 'function') {
      return { ok: false, code: 'NO_SITE_TOOLS', error: 'This site’s model context offers no way to execute a tool.' };
    }

    const outcome = await Promise.race([
      Promise.resolve((invoke as (tool: string, input: unknown) => unknown).call(host, name, args)),
      new Promise((resolve) => setTimeout(() => resolve(timeoutMarker), timeoutMs)),
    ]);
    if (outcome === timeoutMarker) {
      return { ok: false, code: 'TIMEOUT', error: `“${name}” did not finish within ${timeoutMs}ms.` };
    }

    try {
      return { ok: true, value: outcome === undefined ? null : JSON.parse(JSON.stringify(outcome)) };
    } catch {
      return { ok: false, code: 'SITE_TOOL_FAILED', error: 'The tool returned something that is not JSON.' };
    }
  } catch (error) {
    return {
      ok: false,
      code: 'SITE_TOOL_FAILED',
      error: String((error as { message?: unknown } | null)?.message ?? error),
    };
  }
}

async function inMainWorld<T>(tabId: number, func: (...args: never[]) => Promise<T>, args: unknown[]): Promise<T | null> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: func as () => Promise<T>,
      args: args as [],
    });
    return (results[0]?.result as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function probeSiteTools(tabId: number) {
  const read = await inMainWorld<ReadReply>(tabId, readRegisteredTools, [false]);
  if (!read?.ok || !read.tools.length) return null;
  return { api: read.api, count: read.tools.length, tools: read.tools };
}

export async function pageInfoWithSiteTools(tabId: number, input: unknown): Promise<ActionResult> {
  const [info, siteTools] = await Promise.all([invokeInTab(tabId, getPageInfo.name, input), probeSiteTools(tabId)]);
  if (!info.ok || !siteTools) return info;
  return success({ ...(info.data as object), siteTools });
}

export async function listSiteToolsInTab(tabId: number, url: string | undefined): Promise<ActionResult> {
  if (!originOf(url)) return failure('UNSUPPORTED', 'Site tools can only be read on an http(s) page.');

  const read = await inMainWorld<ReadReply>(tabId, readRegisteredTools, [true]);
  if (!read) {
    return failure('UNSUPPORTED', 'Reading site tools needs main-world scripting, which this browser does not allow here.');
  }
  if (!read.ok) return failure('ACTION_FAILED', `The site’s model context failed while listing its tools: ${read.error}`);
  if (!read.tools.length) {
    return failure('NO_SITE_TOOLS', 'This site registers no WebMCP tools — the ordinary page tools are the way to work here.');
  }
  return success({ api: read.api, count: read.tools.length, tools: read.tools });
}

export async function callSiteToolInTab(tabId: number, url: string | undefined, input: unknown): Promise<ActionResult> {
  const parsed = callSiteTool.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  if (!originOf(url)) return failure('UNSUPPORTED', 'Site tools can only be called on an http(s) page.');

  const { tool, args, timeoutMs } = parsed.data;
  const called = await inMainWorld<CallReply>(tabId, callRegisteredTool, [tool, args, timeoutMs, TIMEOUT_MARKER]);
  if (!called) {
    return failure('UNSUPPORTED', 'Calling site tools needs main-world scripting, which this browser does not allow here.');
  }
  if (!called.ok) {
    const listed = called.tools?.length ? ` It defines: ${called.tools.join(', ')}.` : '';
    return failure(called.code, `${called.error}${listed}`);
  }
  return success({ tool, returned: called.value });
}
