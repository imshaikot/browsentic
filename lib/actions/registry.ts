import { z } from 'zod';
import type { AnyAction } from './core';
import type { ToolDescriptor } from './manifest';
import { attachFile } from './page/attach-file';
import { awaitMonitor } from './page/await-monitor';
import { clickElement } from './page/click-element';
import { closeTab } from './page/close-tab';
import { extractText } from './page/extract-text';
import { fillInput } from './page/fill-input';
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
import { screenshot } from './page/screenshot';
import { scrollTo } from './page/scroll-to';
import { selectOption } from './page/select-option';
import { selectText } from './page/select-text';
import { startMonitor } from './page/start-monitor';
import { stopMonitor } from './page/stop-monitor';
import { submitForm } from './page/submit-form';
import { switchTab } from './page/switch-tab';
import { typeText } from './page/type-text';
import { waitForElement } from './page/wait-for-element';

export const actions: ReadonlyMap<string, AnyAction> = new Map(
  (
    [
      getPageInfo,
      scrollTo,
      clickElement,
      hoverElement,
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
