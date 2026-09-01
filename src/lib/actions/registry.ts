import { z } from 'zod';
import type { AnyAction } from './core';
import type { ToolDescriptor } from './manifest';
import { applyTheme } from './page/apply-theme';
import { attachFile } from './page/attach-file';
import { auditContrast } from './page/audit-contrast';
import { awaitMonitor } from './page/await-monitor';
import { captureDownload } from './page/capture-download';
import { clickElement } from './page/click-element';
import { closeTab } from './page/close-tab';
import { dragElement } from './page/drag-element';
import { extractText } from './page/extract-text';
import { fillInput } from './page/fill-input';
import { findCaptcha } from './page/find-captcha';
import { findProgress } from './page/find-progress';
import { findSearch } from './page/find-search';
import { focusInput } from './page/focus-input';
import { getPageInfo } from './page/get-page-info';
import { highlightElement } from './page/highlight-element';
import { hoverElement } from './page/hover-element';
import { injectCode } from './page/inject-code';
import { listDownloads } from './page/list-downloads';
import { listFiles } from './page/list-files';
import { listRecordings } from './page/list-recordings';
import { monitorStatus } from './page/monitor-status';
import { navigate } from './page/navigate';
import { openTab } from './page/open-tab';
import { pickElement } from './page/pick-element';
import { pressKey } from './page/press-key';
import { readConsole } from './page/read-console';
import { readNetwork } from './page/read-network';
import { readRecording } from './page/read-recording';
import { readTheme } from './page/read-theme';
import { runCode } from './page/run-code';
import { screenshot } from './page/screenshot';
import { scrollTo } from './page/scroll-to';
import { searchSite } from './page/search-site';
import { selectOption } from './page/select-option';
import { selectText } from './page/select-text';
import { solveCaptcha } from './page/solve-captcha';
import { startDiagnostics } from './page/start-diagnostics';
import { startMonitor } from './page/start-monitor';
import { startTimer } from './page/start-timer';
import { stopDiagnostics } from './page/stop-diagnostics';
import { stopMonitor } from './page/stop-monitor';
import { stopTimer } from './page/stop-timer';
import { submitForm } from './page/submit-form';
import { switchTab } from './page/switch-tab';
import { timerStatus } from './page/timer-status';
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
      pickElement,
      pressKey,
      submitForm,
      waitForElement,
      injectCode,
      runCode,
      findProgress,
      findSearch,
      readTheme,
      auditContrast,
      applyTheme,
      startDiagnostics,
      readConsole,
      readNetwork,
      stopDiagnostics,
      startMonitor,
      monitorStatus,
      awaitMonitor,
      stopMonitor,
      startTimer,
      timerStatus,
      stopTimer,
      highlightElement,
      searchSite,
      navigate,
      openTab,
      switchTab,
      closeTab,
      screenshot,
      listFiles,
      attachFile,
      captureDownload,
      listDownloads,
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
