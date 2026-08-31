import { browser } from 'wxt/browser';
import type { FocusedElement } from '@/lib/actions/protocol';
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

/** The panel drives A-Eye through the same action the agent calls, so both see one picker. */
export async function pickFocus(): Promise<PickOutcome> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return { error: 'No active tab to point at' };

  const result = await pickInTab({ id: tab.id, windowId: tab.windowId });
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

export const focusName = (focus: FocusedElement): string =>
  focus.label?.trim() || focus.role || focus.tag;
