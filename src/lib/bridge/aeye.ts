import { browser } from 'wxt/browser';
import { pickElement } from '@/lib/actions/page/pick-element';
import { BRIDGE_CHANNEL, failure, type ActionResult, type FocusedElement } from '@/lib/actions/protocol';
import { readPhone } from './phone';
import { pickInTab, type PickShot } from './pick';

export type PickOutcome = { focus: FocusedElement } | { cancelled: true } | { error: string };

interface PickedElement {
  element: { tag: string; role?: string; selector: string; text?: string };
  content: string;
  truncated: boolean;
  url: string;
  title: string;
  shot?: PickShot;
}

/**
 * The panel drives A-Eye through the same action the agent calls, so both see one picker. On the
 * phone tab the pick happens on the phone, which only the background can reach.
 */
export async function pickFocus(): Promise<PickOutcome> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return { error: 'No active tab to point at' };
  if ((await readPhone())?.mirrorTabId === tab.id) return focusOf(await pickOnPhone());
  return pickFocusIn({ id: tab.id, windowId: tab.windowId });
}

async function pickOnPhone(): Promise<ActionResult> {
  const answer = (await browser.runtime
    .sendMessage({ channel: BRIDGE_CHANNEL, op: 'invoke', action: pickElement.name, input: {} })
    .catch(() => null)) as ActionResult | null;
  return answer ?? failure('BRIDGE_ERROR', 'The extension did not answer.');
}

export async function pickFocusIn(tab: { id: number; windowId?: number }): Promise<PickOutcome> {
  return focusOf(await pickInTab(tab));
}

function focusOf(result: ActionResult): PickOutcome {
  if (!result.ok) {
    return result.error.code === 'PICK_CANCELLED' ? { cancelled: true } : { error: result.error.message };
  }
  const { element, content, truncated, url, title, shot } = result.data as PickedElement;
  return {
    focus: {
      tag: element.tag,
      role: element.role,
      selector: element.selector,
      label: element.text,
      content,
      truncated,
      url,
      title,
      shot: shot?.dataUrl,
    },
  };
}
