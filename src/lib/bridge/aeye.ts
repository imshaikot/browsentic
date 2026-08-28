import { invokeInActiveTab } from '@/lib/actions/client';
import { pickElement } from '@/lib/actions/page/pick-element';
import type { FocusedElement } from '@/lib/actions/protocol';

export type PickOutcome = { focus: FocusedElement } | { cancelled: true } | { error: string };

/** The panel drives A-Eye through the same action the agent calls, so both see one picker. */
export async function pickFocus(): Promise<PickOutcome> {
  const result = await invokeInActiveTab(pickElement);
  if (!result.ok) {
    return result.error.code === 'PICK_CANCELLED' ? { cancelled: true } : { error: result.error.message };
  }
  const { element, content, truncated, url, title } = result.data;
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
    },
  };
}

export const focusName = (focus: FocusedElement): string =>
  focus.label?.trim() || focus.role || focus.tag;
