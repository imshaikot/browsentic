import { z } from 'zod';
import { injectContentScript, invokeInTab } from '@/lib/actions/client';
import { switchFrame } from '@/lib/actions/page/switch-frame';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { describeFrame, framePath, setFramePath, TOP_FRAME, type FrameStep } from './frame-focus';

interface EnteredFrame {
  frameId: number;
  selector: string;
  src?: string;
  name?: string;
  sandbox?: string;
}

export async function switchFrameInTab(tabId: number, topUrl: string | undefined, input: unknown): Promise<ActionResult> {
  const parsed = switchFrame.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));

  const path = await framePath(tabId);
  if (!parsed.data.frame) {
    const left = parsed.data.to === 'top' ? [] : path.slice(0, -1);
    await setFramePath(tabId, left);
    return success(focusOf(left, topUrl));
  }

  const planned = await invokeInTab(tabId, switchFrame.name, parsed.data);
  if (!planned.ok) return planned;
  const entered = planned.data as EnteredFrame;

  const reached = await reachFrame(tabId, entered.frameId);
  if (!reached) {
    return failure(
      'FRAME_UNREACHABLE',
      `${entered.selector} cannot be entered — ${
        entered.sandbox && !entered.sandbox.includes('allow-scripts')
          ? 'its sandbox forbids scripts'
          : 'it is a browser-internal frame or has not loaded'
      }. page.screenshot still shows it and page.trustedClick with a "point" still reaches it.`,
    );
  }

  const next = [...path, { frameId: entered.frameId, url: reached.url, selector: entered.selector }];
  await setFramePath(tabId, next);
  return success({ entered: planned.data, ...focusOf(next, topUrl) });
}

async function reachFrame(tabId: number, frameId: number) {
  const described = await describeFrame(tabId, frameId);
  if (described) return described;
  if (!(await injectContentScript(tabId, frameId))) return null;
  return describeFrame(tabId, frameId);
}

export function focusOf(path: FrameStep[], topUrl: string | undefined) {
  const current = path.at(-1);
  return {
    frame: {
      depth: path.length,
      frameId: current?.frameId ?? TOP_FRAME,
      url: current?.url ?? topUrl,
      path: path.map(({ selector, url }) => ({ selector, url })),
    },
  };
}
