import { browser } from 'wxt/browser';
import { refusalFor } from '@/lib/bridge/site-guard';
import { dispatch } from './dispatch';
import { isActionInvocation, type ActionInvocation, type ActionResult } from './protocol';

export function exposeActions() {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isActionInvocation(message)) return;
    void answer(message).then(sendResponse);
    return true;
  });
}

/** The page's own word on where it is, checked again whatever the background already decided. */
async function answer({ action, input }: ActionInvocation): Promise<ActionResult> {
  return (await refusalFor(location.href)) ?? dispatch(action, input);
}
