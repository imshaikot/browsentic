import { browser } from 'wxt/browser';
import { dispatch } from './dispatch';
import { isActionInvocation } from './protocol';

export function exposeActions() {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isActionInvocation(message)) return;
    void dispatch(message.action, message.input).then(sendResponse);
    return true;
  });
}
