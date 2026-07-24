import { z } from 'zod';
import { ActionError, defineAction } from '../core';

const input = z.object({
  url: z.string().optional().describe('Absolute or relative URL to open (http/https only)'),
  action: z
    .enum(['back', 'forward', 'reload'])
    .optional()
    .describe('History navigation instead of opening a URL'),
});

export type NavigateInput = z.output<typeof input>;

export type Navigation =
  | { kind: 'url'; href: string }
  | { kind: 'history'; action: 'back' | 'forward' | 'reload' };

/**
 * Validate a navigate request. Shared so the in-page action and the background worker's
 * tab-level path agree on what is allowed; `base` resolves relative URLs and is only
 * available in the page, so callers without one must pass an absolute URL.
 */
export function resolveNavigation({ url, action }: NavigateInput, base?: string): Navigation {
  if (!url === !action) {
    throw new ActionError('Provide either "url" or "action"', 'INVALID_INPUT');
  }
  if (action) return { kind: 'history', action };

  let destination: URL;
  try {
    destination = new URL(url!, base);
  } catch {
    throw new ActionError(
      base ? `Invalid URL: "${url}"` : `Invalid URL: "${url}" — pass an absolute http(s) URL`,
      'INVALID_INPUT',
    );
  }
  if (destination.protocol !== 'http:' && destination.protocol !== 'https:') {
    throw new ActionError(
      `Only http(s) URLs are supported, got "${destination.protocol}"`,
      'UNSUPPORTED',
    );
  }
  return { kind: 'url', href: destination.href };
}

export const navigate = defineAction({
  name: 'page.navigate',
  description: 'Navigate the current tab to a URL, or go back, forward, or reload in its history.',
  input,
  execute(request) {
    const plan = resolveNavigation(request, location.href);
    if (plan.kind === 'url') {
      // The page unloads on navigation, so the caller may never receive this response.
      location.assign(plan.href);
      return { navigatingTo: plan.href };
    }
    if (plan.action === 'back') history.back();
    else if (plan.action === 'forward') history.forward();
    else location.reload();
    return { performed: plan.action };
  },
});
