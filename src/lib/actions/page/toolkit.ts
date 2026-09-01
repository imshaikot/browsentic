/**
 * The bridge between an approved toolkit and the calls that use it.
 *
 * The toolkit itself has to live in the page's main world, where the page's own globals
 * are — the content script's isolated world cannot see them. Getting it there means
 * Chrome's debugger: `Runtime.evaluate` is not subject to the page's CSP, while `eval`
 * and `new Function` inside the page are, so a site with `script-src 'self'` would
 * otherwise refuse the toolkit outright. That is why the source is embedded textually
 * here rather than compiled in the page.
 *
 * Calls do not go back through the debugger. Attaching per call would flash the
 * debugging bar on every one of twenty iterations, which is the opposite of what batch
 * work is for, so the installer leaves an event listener behind and later calls are
 * ordinary DOM events from the content script. Their payloads cross as JSON strings:
 * an object built in one world and read in the other is a wrapped foreign object, and a
 * string is just a string.
 */

import { ActionError } from '../core';

export const TOOLKIT_ATTRIBUTE = 'data-browsentic-toolkit';
export const TOOLKIT_CALL_EVENT = 'browsentic:toolkit:call';
export const TOOLKIT_RESULT_EVENT = 'browsentic:toolkit:result';
export const TOOLKIT_GLOBAL = '__browsenticToolkit';

export const TOOLKIT_MISSING = 'TOOLKIT_MISSING';
export const CODE_ERROR = 'CODE_ERROR';

interface ToolkitReply {
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * What the installer reports back. Arity comes from `Function.length`, which is what
 * decides whether a function can become a saved tool: `/` invocation passes no arguments,
 * so only a zero-argument entry point can be offered for saving.
 */
export interface ToolkitEntry {
  name: string;
  arity: number;
}

export function installerSource(toolkitId: string, code: string): string {
  const key = JSON.stringify(TOOLKIT_GLOBAL);
  const attribute = JSON.stringify(TOOLKIT_ATTRIBUTE);
  const callEvent = JSON.stringify(TOOLKIT_CALL_EVENT);
  const resultEvent = JSON.stringify(TOOLKIT_RESULT_EVENT);

  return `(() => {
  const tools = {};
  (function (tools) {
${code}
  })(tools);

  const entries = Object.keys(tools)
    .filter((name) => typeof tools[name] === 'function')
    .map((name) => ({ name: name, arity: tools[name].length }));
  if (!entries.length) {
    throw new Error('The code defined no functions on "tools" — assign each entry point, e.g. tools.addTag = (name) => {…}.');
  }

  let store = globalThis[${key}];
  if (!store) {
    store = globalThis[${key}] = { tools };
    window.addEventListener(${callEvent}, (event) => {
      let request;
      try {
        request = JSON.parse(event.detail);
      } catch {
        return;
      }
      const reply = (payload) => {
        let detail;
        try {
          detail = JSON.stringify({ id: request.id, ...payload });
        } catch {
          detail = JSON.stringify({
            id: request.id,
            ok: false,
            error: 'That function returned something that is not JSON — return plain data instead.',
          });
        }
        window.dispatchEvent(new CustomEvent(${resultEvent}, { detail }));
      };
      const fn = store.tools[request.fn];
      if (typeof fn !== 'function') {
        return reply({ ok: false, error: 'This toolkit has no function named "' + request.fn + '".' });
      }
      Promise.resolve()
        .then(() => fn.apply(undefined, request.args || []))
        .then(
          (value) => reply({ ok: true, value: value === undefined ? null : value }),
          (error) => reply({ ok: false, error: String((error && error.message) || error) }),
        );
    });
  }

  store.tools = tools;
  store.id = ${JSON.stringify(toolkitId)};
  document.documentElement.setAttribute(${attribute}, ${JSON.stringify(toolkitId)});
  return entries;
})()`;
}

export function callToolkit(fn: string, args: readonly unknown[], timeoutMs: number): Promise<unknown> {
  if (!document.documentElement.hasAttribute(TOOLKIT_ATTRIBUTE)) {
    throw new ActionError('No toolkit is installed in this page.', TOOLKIT_MISSING);
  }

  const callId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const onResult = (event: Event) => {
      const reply = parseReply((event as CustomEvent).detail);
      if (reply?.id !== callId) return;
      stop();
      if (reply.ok) resolve(reply.value ?? null);
      else reject(new ActionError(reply.error ?? 'The function threw.', CODE_ERROR));
    };

    const timer = setTimeout(() => {
      stop();
      reject(new ActionError(`“${fn}” did not finish within ${timeoutMs}ms.`, 'TIMEOUT'));
    }, timeoutMs);

    function stop() {
      clearTimeout(timer);
      window.removeEventListener(TOOLKIT_RESULT_EVENT, onResult);
    }

    window.addEventListener(TOOLKIT_RESULT_EVENT, onResult);
    window.dispatchEvent(
      new CustomEvent(TOOLKIT_CALL_EVENT, { detail: JSON.stringify({ id: callId, fn, args }) }),
    );
  });
}

function parseReply(detail: unknown): ToolkitReply | null {
  if (typeof detail !== 'string') return null;
  try {
    return JSON.parse(detail) as ToolkitReply;
  } catch {
    return null;
  }
}
