import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { isVisible, resolveTarget, targetSchema } from './dom';

export const selectText = defineAction({
  name: 'page.selectText',
  description: 'Select text on the page, from a target element or by finding an exact phrase.',
  input: z.object({
    target: targetSchema.optional().describe('Element whose entire text content to select'),
    search: z.string().optional().describe('Exact text to find and select, case-insensitive'),
    occurrence: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe('Which match to select when the text appears multiple times'),
  }),
  execute({ target, search, occurrence }) {
    if (Boolean(target) === Boolean(search)) {
      throw new ActionError('Provide either "target" or "search"', 'INVALID_INPUT');
    }
    const range = document.createRange();
    if (target) {
      range.selectNodeContents(resolveTarget(target));
    } else if (search) {
      const segments = visibleTextSegments();
      const flat = segments.map((s) => s.node.data).join('');
      const needle = search.toLowerCase();
      let hit = -1;
      for (let from = 0, i = 0; i <= occurrence; i++) {
        hit = flat.toLowerCase().indexOf(needle, from);
        if (hit === -1) break;
        from = hit + 1;
      }
      if (hit === -1) {
        throw new ActionError(`Text "${search}" not found on the page`, 'TARGET_NOT_FOUND');
      }
      range.setStart(...pointAt(segments, hit));
      range.setEnd(...pointAt(segments, hit + search.length));
    }
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const anchor = range.startContainer;
    (anchor instanceof Element ? anchor : anchor.parentElement)?.scrollIntoView({ block: 'center' });
    return { selectedText: (selection?.toString() ?? '').slice(0, 500) };
  },
});

interface Segment {
  node: Text;
  start: number;
}

function visibleTextSegments(): Segment[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const segments: Segment[] = [];
  let offset = 0;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style') || !isVisible(parent)) continue;
    segments.push({ node, start: offset });
    offset += node.data.length;
  }
  return segments;
}

/** Map an offset in the concatenated text back to a (node, offset) DOM point. */
function pointAt(segments: Segment[], offset: number): [Text, number] {
  for (const seg of segments) {
    if (offset <= seg.start + seg.node.data.length) return [seg.node, offset - seg.start];
  }
  const last = segments[segments.length - 1];
  return [last.node, last.node.data.length];
}
