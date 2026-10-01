import { browser } from 'wxt/browser';

export const TAB_REPLY_MS = 1_500;

/**
 * Sends a message whose reply nothing depends on. A tab Chrome has frozen, or one held by an
 * `alert()`, never answers until the user wakes it, and the run queue must not wait that long.
 */
export function tellTab(tabId: number, message: unknown): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unanswered = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, TAB_REPLY_MS);
  });
  const answered = browser.tabs.sendMessage(tabId, message).then(
    () => undefined,
    () => undefined,
  );
  return Promise.race([answered, unanswered]).finally(() => clearTimeout(timer));
}
