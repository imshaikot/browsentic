import { browser } from 'wxt/browser';
import { dispatch } from './dispatch';
import { isActionInvocation } from './protocol';

/** Listen for action invocations in this page — the content-script side of the bridge. */
export function exposeActions() {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isActionInvocation(message)) return;
    void dispatch(message.action, message.input).then(sendResponse);
    return true;
  });
}
