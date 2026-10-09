/** The tools a phone run is offered. A tool not listed here stays off on the phone until someone makes it work there and adds it, with a test. */
export const PHONE_TOOLS: ReadonlySet<string> = new Set([
  'page.navigate',
  'page.searchSite',
  'page.findSearch',
  'page.getPageInfo',
  'page.extractText',
  'page.waitForElement',
  'page.findProgress',
  'page.clickElement',
  'page.trustedClick',
  'page.fillInput',
  'page.typeText',
  'page.pressKey',
  'page.focusInput',
  'page.selectOption',
  'page.selectText',
  'page.submitForm',
  'page.scrollTo',
  'page.dragElement',
  'page.screenshot',
  'page.highlightElement',
  'page.readTheme',
  'page.auditContrast',
  'page.applyTheme',
  'page.openTab',
  'page.switchTab',
  'page.closeTab',
  'page.switchFrame',
  'page.injectCode',
  'page.runCode',
  'page.startTimer',
  'page.timerStatus',
  'page.stopTimer',
]);

export const PHONE_RESERVED: ReadonlySet<string> = new Set();

/** Tools that touch no page and keep their state in the browser, so a phone run uses them exactly as a desktop one does. */
export const HOST_SIDE: ReadonlySet<string> = new Set(['page.startTimer', 'page.timerStatus', 'page.stopTimer']);

export const phoneOffers = (action: string): boolean => PHONE_TOOLS.has(action) || PHONE_RESERVED.has(action);

export const notOnPhone = (action: string): string => `${action} isn’t available on the phone. It works in desktop tabs.`;
