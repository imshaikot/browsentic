import { applyTheme } from '@/lib/actions/page/apply-theme';
import { attachFile } from '@/lib/actions/page/attach-file';
import { auditContrast } from '@/lib/actions/page/audit-contrast';
import { awaitMonitor } from '@/lib/actions/page/await-monitor';
import { callSiteTool } from '@/lib/actions/page/call-site-tool';
import { captureDownload } from '@/lib/actions/page/capture-download';
import { clickElement } from '@/lib/actions/page/click-element';
import { closeTab } from '@/lib/actions/page/close-tab';
import { targetSchema } from '@/lib/actions/page/dom';
import { dragElement } from '@/lib/actions/page/drag-element';
import { extractText } from '@/lib/actions/page/extract-text';
import { fillInput } from '@/lib/actions/page/fill-input';
import { findCaptcha } from '@/lib/actions/page/find-captcha';
import { findProgress } from '@/lib/actions/page/find-progress';
import { findSearch } from '@/lib/actions/page/find-search';
import { focusInput } from '@/lib/actions/page/focus-input';
import { getPageInfo } from '@/lib/actions/page/get-page-info';
import { highlightElement } from '@/lib/actions/page/highlight-element';
import { hoverElement } from '@/lib/actions/page/hover-element';
import { injectCode } from '@/lib/actions/page/inject-code';
import { listDownloads } from '@/lib/actions/page/list-downloads';
import { listFiles } from '@/lib/actions/page/list-files';
import { listRecordings } from '@/lib/actions/page/list-recordings';
import { listSiteTools } from '@/lib/actions/page/list-site-tools';
import { monitorStatus } from '@/lib/actions/page/monitor-status';
import { navigate } from '@/lib/actions/page/navigate';
import { openTab } from '@/lib/actions/page/open-tab';
import { pickElement } from '@/lib/actions/page/pick-element';
import { pointSchema } from '@/lib/actions/page/pointer';
import { pressKey } from '@/lib/actions/page/press-key';
import { readConsole } from '@/lib/actions/page/read-console';
import { readNetwork } from '@/lib/actions/page/read-network';
import { readRecording } from '@/lib/actions/page/read-recording';
import { readTheme } from '@/lib/actions/page/read-theme';
import { runCode } from '@/lib/actions/page/run-code';
import { screenshot } from '@/lib/actions/page/screenshot';
import { scrollTo } from '@/lib/actions/page/scroll-to';
import { searchSite } from '@/lib/actions/page/search-site';
import { selectOption } from '@/lib/actions/page/select-option';
import { selectText } from '@/lib/actions/page/select-text';
import { solveCaptcha } from '@/lib/actions/page/solve-captcha';
import { startDiagnostics } from '@/lib/actions/page/start-diagnostics';
import { startMonitor } from '@/lib/actions/page/start-monitor';
import { startTimer } from '@/lib/actions/page/start-timer';
import { stopDiagnostics } from '@/lib/actions/page/stop-diagnostics';
import { stopMonitor } from '@/lib/actions/page/stop-monitor';
import { stopTimer } from '@/lib/actions/page/stop-timer';
import { submitForm } from '@/lib/actions/page/submit-form';
import { switchFrame } from '@/lib/actions/page/switch-frame';
import { switchTab } from '@/lib/actions/page/switch-tab';
import { timerStatus } from '@/lib/actions/page/timer-status';
import { trustedClick } from '@/lib/actions/page/trusted-click';
import { typeText } from '@/lib/actions/page/type-text';
import { waitForElement } from '@/lib/actions/page/wait-for-element';
import type { CueAnchor, CuePlan, CuePoint, CueTarget } from './events';

type Input = Record<string, unknown>;
type Rule = (input: Input) => CuePlan;

interface Slot {
  target?: string;
  point?: string;
}

interface ElementOptions {
  slots?: Slot[];
  focusedByDefault?: boolean;
  includeHidden?: boolean;
  detail?: (input: Input) => string | undefined;
}

export const NO_CUE: CuePlan = { kind: 'none', verb: '', anchors: [] };

const QUENCH: CuePlan = { ...NO_CUE, quench: true };

const none: Rule = () => NO_CUE;

const quench: Rule = () => QUENCH;

const page =
  (verb: string, detail?: (input: Input) => string | undefined): Rule =>
  (input) =>
    withDetail({ kind: 'page', verb, anchors: [] }, detail?.(input));

const element =
  (verb: string, options: ElementOptions = {}): Rule =>
  (input) => {
    const slots = options.slots ?? [{ target: 'target' }];
    const anchors = slots.flatMap((slot) => anchorFor(input, slot, options.includeHidden));
    const detail = options.detail?.(input);
    if (anchors.length) return withDetail({ kind: 'element', verb, anchors }, detail);
    if (options.focusedByDefault) return withDetail({ kind: 'element', verb, anchors: [{ focused: true }] }, detail);
    return withDetail({ kind: 'page', verb, anchors: [] }, detail);
  };

function withDetail(plan: CuePlan, detail: string | undefined): CuePlan {
  return detail ? { ...plan, detail } : plan;
}

function anchorFor(input: Input, slot: Slot, includeHidden?: boolean): CueAnchor[] {
  const target = slot.target ? targetOf(input[slot.target]) : null;
  if (target) return [includeHidden ? { target, includeHidden } : { target }];
  const point = slot.point ? pointOf(input[slot.point]) : null;
  return point ? [{ point }] : [];
}

function targetOf(value: unknown): CueTarget | null {
  const parsed = targetSchema.safeParse(value);
  if (!parsed.success) return null;
  const { selector, text, role, nth } = parsed.data;
  if (!selector && !text) return null;
  return { selector, text, role, nth };
}

function pointOf(value: unknown): CuePoint | null {
  const parsed = pointSchema.safeParse(value);
  return parsed.success ? { x: parsed.data.x, y: parsed.data.y } : null;
}

const namedKey = (input: Input) =>
  typeof input.key === 'string' && input.key.length > 1 ? input.key : undefined;

const HISTORY_VERBS: Record<string, string> = { back: 'Go back', forward: 'Go forward', reload: 'Reload' };

const navigation: Rule = (input) => {
  const history = typeof input.action === 'string' ? HISTORY_VERBS[input.action] : undefined;
  if (history) return { kind: 'page', verb: history, anchors: [] };
  return withDetail({ kind: 'page', verb: 'Go to', anchors: [] }, hostOf(input.url));
};

function hostOf(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

const RULES = new Map<string, Rule>([
  [clickElement.name, element('Click')],
  [trustedClick.name, element('Click', { slots: [{ target: 'target', point: 'point' }] })],
  [hoverElement.name, element('Hover')],
  [
    dragElement.name,
    element('Drag', {
      slots: [
        { target: 'from', point: 'fromPoint' },
        { target: 'to', point: 'toPoint' },
      ],
    }),
  ],
  [focusInput.name, element('Focus')],
  [fillInput.name, element('Fill')],
  [typeText.name, element('Type', { focusedByDefault: true })],
  [pressKey.name, element('Press', { focusedByDefault: true, detail: namedKey })],
  [selectOption.name, element('Choose')],
  [selectText.name, element('Select')],
  [submitForm.name, element('Submit')],
  [waitForElement.name, element('Wait for')],
  [scrollTo.name, element('Scroll')],
  [extractText.name, element('Read')],
  [attachFile.name, element('Attach', { includeHidden: true })],
  [captureDownload.name, element('Download')],
  [searchSite.name, element('Search')],

  [getPageInfo.name, page('Read page')],
  [navigate.name, navigation],
  [runCode.name, page('Run script')],
  [injectCode.name, page('Add script')],
  [listSiteTools.name, page('Read site tools')],
  [callSiteTool.name, page('Use site tool')],
  [findProgress.name, page('Read page')],
  [findSearch.name, page('Read page')],
  [readTheme.name, page('Inspect styles')],
  [auditContrast.name, page('Inspect styles')],
  [applyTheme.name, page('Restyle page')],

  [screenshot.name, quench],
  [findCaptcha.name, quench],
  [solveCaptcha.name, quench],
  [pickElement.name, quench],

  [highlightElement.name, none],
  [openTab.name, none],
  [switchTab.name, none],
  [closeTab.name, none],
  [switchFrame.name, none],
  [startDiagnostics.name, none],
  [readConsole.name, none],
  [readNetwork.name, none],
  [stopDiagnostics.name, none],
  [startMonitor.name, none],
  [monitorStatus.name, none],
  [awaitMonitor.name, none],
  [stopMonitor.name, none],
  [startTimer.name, none],
  [timerStatus.name, none],
  [stopTimer.name, none],
  [listFiles.name, none],
  [listRecordings.name, none],
  [readRecording.name, none],
  [listDownloads.name, none],
]);

export const hasCueRule = (action: string): boolean => RULES.has(action);

/** Built from the sealed input: only where the action lands is copied, never what it types. */
export function cueFor(action: string, input: unknown): CuePlan {
  const rule = RULES.get(action);
  if (!rule) return NO_CUE;
  return rule(typeof input === 'object' && input !== null ? (input as Input) : {});
}
