import { z } from 'zod';
import type { AnyAction } from './core';
import type { ToolDescriptor } from './manifest';
import { applyTheme } from './page/apply-theme';
import { attachFile } from './page/attach-file';
import { auditContrast } from './page/audit-contrast';
import { awaitMonitor } from './page/await-monitor';
import { clickElement } from './page/click-element';
import { closeTab } from './page/close-tab';
import { dragElement } from './page/drag-element';
import { extractText } from './page/extract-text';
import { fillInput } from './page/fill-input';
import { findCaptcha } from './page/find-captcha';
import { findProgress } from './page/find-progress';
import { focusInput } from './page/focus-input';
import { getPageInfo } from './page/get-page-info';
import { highlightElement } from './page/highlight-element';
import { hoverElement } from './page/hover-element';
import { listFiles } from './page/list-files';
import { listRecordings } from './page/list-recordings';
import { monitorStatus } from './page/monitor-status';
import { navigate } from './page/navigate';
import { openTab } from './page/open-tab';
import { pressKey } from './page/press-key';
import { readRecording } from './page/read-recording';
import { readTheme } from './page/read-theme';
import { screenshot } from './page/screenshot';
import { scrollTo } from './page/scroll-to';
import { selectOption } from './page/select-option';
import { selectText } from './page/select-text';
import { solveCaptcha } from './page/solve-captcha';
import { startMonitor } from './page/start-monitor';
import { stopMonitor } from './page/stop-monitor';
import { submitForm } from './page/submit-form';
import { switchTab } from './page/switch-tab';
import { trustedClick } from './page/trusted-click';
import { typeText } from './page/type-text';
import { waitForElement } from './page/wait-for-element';

export const actions: ReadonlyMap<string, AnyAction> = new Map(
  (
    [
      getPageInfo,
      scrollTo,
      clickElement,
      trustedClick,
      findCaptcha,
      solveCaptcha,
      hoverElement,
      dragElement,
      focusInput,
      fillInput,
      typeText,
      selectOption,
      selectText,
      extractText,
      pressKey,
      submitForm,
      waitForElement,
      findProgress,
      readTheme,
      auditContrast,
      applyTheme,
      startMonitor,
      monitorStatus,
      awaitMonitor,
      stopMonitor,
      highlightElement,
      navigate,
      openTab,
      switchTab,
      closeTab,
      screenshot,
      listFiles,
      attachFile,
      listRecordings,
      readRecording,
    ] as AnyAction[]
  ).map((action) => [action.name, action]),
);

export function describeActions(): ToolDescriptor[] {
  return [...actions.values()].map(({ name, description, input }) => ({
    name,
    description,
    inputSchema: z.toJSONSchema(input, { io: 'input' }),
  }));
}
