import { z } from 'zod';
import type { AnyAction } from './core';
import type { ToolDescriptor } from './manifest';
import { attachFile } from './page/attach-file';
import { clickElement } from './page/click-element';
import { extractText } from './page/extract-text';
import { fillInput } from './page/fill-input';
import { focusInput } from './page/focus-input';
import { getPageInfo } from './page/get-page-info';
import { highlightElement } from './page/highlight-element';
import { hoverElement } from './page/hover-element';
import { listFiles } from './page/list-files';
import { navigate } from './page/navigate';
import { pressKey } from './page/press-key';
import { screenshot } from './page/screenshot';
import { scrollTo } from './page/scroll-to';
import { selectOption } from './page/select-option';
import { selectText } from './page/select-text';
import { submitForm } from './page/submit-form';
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
      selectOption,
      selectText,
      extractText,
      pressKey,
      submitForm,
      waitForElement,
      highlightElement,
      navigate,
      screenshot,
      listFiles,
      attachFile,
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
