import { browser } from 'wxt/browser';
import { accessibleText, resolveTarget, type Target } from '@/lib/actions/page/dom';
import { BRIDGE_CHANNEL } from '@/lib/actions/protocol';
import {
  BACKSTOP_INTERVAL_MS,
  EVAL_DEBOUNCE_MS,
  MAX_TEXT_SCAN_CHARS,
  MONITOR_CHANNEL,
  SAMPLE_MIN_INTERVAL_MS,
  type MonitorSample,
  type MonitorUntil,
} from './events';

export { MONITOR_CHANNEL };

interface MonitorCommand {
  channel: typeof MONITOR_CHANNEL;
  op: 'watch' | 'unwatch';
  monitorId: string;
  until?: MonitorUntil;
}

const PERCENT = /(\d{1,3}(?:\.\d+)?)\s?%/;
const MATCH_CLIP = 120;

export function exposeMonitor(): void {
  const watchers = new Map<string, () => void>();

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isMonitorCommand(message)) return;
    if (message.op === 'unwatch') {
      watchers.get(message.monitorId)?.();
      watchers.delete(message.monitorId);
      return;
    }
    if (!message.until || watchers.has(message.monitorId)) return;
    watchers.set(message.monitorId, startWatcher(message.monitorId, message.until));
  });

  void armed().then((monitors) => {
    for (const { monitorId, until } of monitors) {
      if (!watchers.has(monitorId)) watchers.set(monitorId, startWatcher(monitorId, until));
    }
  });
}

function startWatcher(monitorId: string, until: MonitorUntil): () => void {
  const regex = until.pattern ? compile(until.pattern) : null;
  let lastSentAt = 0;
  let lastPercent: number | undefined;
  let lastMatched: boolean | undefined;
  let lastText: string | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const evaluate = (): MonitorSample => {
    const t = Date.now();
    switch (until.kind) {
      case 'element-appears':
        return { t, matched: !!find(until.target) };
      case 'element-vanishes':
        return { t, matched: !find(until.target) };
      case 'progress-reaches': {
        const el = find(until.target);
        const percent = el ? readPercent(el) : undefined;
        return { t, percent, matched: percent != null && percent >= until.threshold };
      }
      case 'text-matches': {
        const el = until.target?.selector || until.target?.text ? find(until.target) : null;
        const scope = (el ? innerTextOf(el) : document.body?.innerText ?? '').slice(0, MAX_TEXT_SCAN_CHARS);
        const hit = regex?.exec(scope);
        return { t, matched: !!hit, text: hit?.[0]?.slice(0, MATCH_CLIP) };
      }
      case 'title-matches':
        return { t, matched: !!regex?.test(document.title), text: document.title.slice(0, MATCH_CLIP) };
    }
  };

  const check = () => {
    const sample = evaluate();
    const flipped = sample.matched !== lastMatched;
    const moved = sample.percent != null && (lastPercent == null || Math.abs(sample.percent - lastPercent) >= 1);
    const reworded = sample.text !== undefined && sample.text !== lastText;
    if (!flipped && !moved && !reworded) return;
    if (!sample.matched && sample.t - lastSentAt < SAMPLE_MIN_INTERVAL_MS) return;
    lastSentAt = sample.t;
    lastPercent = sample.percent ?? lastPercent;
    lastMatched = sample.matched;
    lastText = sample.text ?? lastText;
    void browser.runtime
      .sendMessage({ channel: BRIDGE_CHANNEL, op: 'monitorSample', monitorId, sample })
      .catch(() => undefined);
  };

  const schedule = () => {
    clearTimeout(debounce);
    debounce = setTimeout(check, EVAL_DEBOUNCE_MS);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const interval = setInterval(check, BACKSTOP_INTERVAL_MS);
  check();

  return () => {
    observer.disconnect();
    clearInterval(interval);
    clearTimeout(debounce);
  };
}

function find(target: Target | undefined): HTMLElement | null {
  if (!target) return null;
  try {
    return resolveTarget(target, { includeHidden: false });
  } catch {
    return null;
  }
}

function readPercent(el: HTMLElement): number | undefined {
  if (el instanceof HTMLProgressElement || el instanceof HTMLMeterElement) {
    return el.max > 0 ? clamp((el.value / el.max) * 100) : undefined;
  }
  const now = parseFloat(el.getAttribute('aria-valuenow') ?? '');
  if (Number.isFinite(now)) {
    const min = parseFloat(el.getAttribute('aria-valuemin') ?? '0') || 0;
    const max = parseFloat(el.getAttribute('aria-valuemax') ?? '100') || 100;
    return max > min ? clamp(((now - min) / (max - min)) * 100) : undefined;
  }
  const spoken = PERCENT.exec(el.getAttribute('aria-valuetext') ?? '') ?? PERCENT.exec(accessibleText(el));
  if (spoken) return clamp(parseFloat(spoken[1]));
  const width = PERCENT.exec(el.style.width) ?? PERCENT.exec((el.firstElementChild as HTMLElement | null)?.style.width ?? '');
  return width ? clamp(parseFloat(width[1])) : undefined;
}

function innerTextOf(el: HTMLElement): string {
  return el.innerText ?? el.textContent ?? '';
}

function clamp(percent: number): number {
  return Math.min(100, Math.max(0, percent));
}

function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

async function armed(): Promise<{ monitorId: string; until: MonitorUntil }[]> {
  try {
    const state = await browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'monitorState' });
    const data = (state as { ok?: boolean; data?: { monitors?: { monitorId: string; until: MonitorUntil }[] } })?.data;
    return Array.isArray(data?.monitors) ? data.monitors : [];
  } catch {
    return [];
  }
}

function isMonitorCommand(message: unknown): message is MonitorCommand {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as MonitorCommand).channel === MONITOR_CHANNEL &&
    typeof (message as MonitorCommand).monitorId === 'string'
  );
}
