import { browser } from 'wxt/browser';
import type { FocusedElement } from '@/lib/actions/protocol';
import { MAX_STORED_FILE_BYTES } from '@/lib/files/report';
import { OVERLAY_ATTRIBUTE } from '@/lib/overlay';
import { RAIL_PALETTES, RAIL_TONES } from '@/lib/rail/events';
import { readingMs, sharedWords, wordsOf } from './caption';
import {
  AUTO_SEND_MS,
  HANDS_FREE_CHANNEL,
  HOLD_KEY_CODE,
  ORB_ICONS,
  isOrbCommand,
  type CaptionTone,
  type OrbIcon,
  type OrbRequest,
  type OrbView,
} from './events';
import {
  MENU_ITEM,
  arcSlots,
  clearOfMenu,
  menuRadius,
  outwardFrom,
  placeBeside,
  placeOrb,
  sidesFacing,
  toPosition,
  type Point,
  type Slot,
} from './geometry';
import { STYLES } from './styles';

const HOST_ID = 'browsentic-hands-free';
const HOVER_OPEN_MS = 1000;
const HOVER_CLOSE_MS = 380;
const LONG_PRESS_MS = 380;
const DRAG_SLOP_PX = 8;
const SPEAKING_MS = 700;
const SENT_MS = 1400;
const HINT_MS = 2800;
const LEAVE_MS = 220;
const FRESH_MS = 4000;
const GLIDE_MS = 400;
const SPEECH_IDLE_MS = 8000;
const TIP_ROOM_PX = 26;
const HOLD_MS = 250;
const SETTLE_MS = 2500;
const SPEECH_STAGGER_MS = 45;
const REPLY_STAGGER_MS = 32;

type MenuId = 'file' | 'code' | 'focus' | 'talk' | 'panel';
type CaptionKind = 'speech' | 'sent' | 'reply' | 'error' | 'ask' | 'hint';
type Unsent<T> = T extends unknown ? Omit<T, 'channel'> : never;

const onMac = (): boolean => {
  const agent = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac/i.test(agent.userAgentData?.platform ?? navigator.platform ?? '');
};

/** What the hold key is called on the keyboard in front of the user; only the label differs. */
const HOLD_KEY = onMac() ? { name: 'control', cap: '⌃' } : { name: 'Ctrl', cap: 'ctrl' };

const MENU: { id: MenuId; icon: OrbIcon; label: string }[] = [
  { id: 'file', icon: 'file', label: 'Attach a file' },
  { id: 'code', icon: 'code', label: 'Live code' },
  { id: 'focus', icon: 'focus', label: 'Focus point (A-Eye)' },
  { id: 'talk', icon: 'keyboard', label: `Hold ${HOLD_KEY.name} to talk` },
  { id: 'panel', icon: 'panel', label: 'Open the side panel' },
];

const LABELS: Record<CaptionKind, string> = {
  speech: 'Listening',
  sent: 'Sent',
  reply: 'Browsentic',
  error: 'Heads up',
  ask: 'Needs your OK',
  hint: '',
};

const TONE_KIND: Record<CaptionTone, CaptionKind> = { reply: 'reply', error: 'error', ask: 'ask' };

const VOICE_HINTS: Partial<Record<OrbView['voice'], string>> = {
  'needs-mic': 'Browsentic needs the microphone — tap the mic to allow it.',
  blocked: 'The microphone is blocked for Browsentic — tap the mic to fix it.',
  'no-mic': 'No microphone was found — tap the mic to try again.',
  'no-service': 'No speech service answered — tap the mic to try again.',
  yielded: 'Another page took the microphone — tap the mic to listen here.',
};

function icon(name: OrbIcon): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ORB_ICONS[name].map((d) => `<path d="${d}"/>`).join('')}</svg>`;
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const spoken = (action: string): string =>
  action.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const focusName = (focus: FocusedElement): string => focus.label?.trim() || focus.role || focus.tag;

const request = <T = unknown>(message: Unsent<OrbRequest>): Promise<T | undefined> =>
  browser.runtime.sendMessage({ channel: HANDS_FREE_CHANNEL, ...message }).catch(() => undefined) as Promise<T | undefined>;

/**
 * Hands-free mode's face on the page: one microphone orb, drawn in a closed shadow root
 * like the rail and the toast, and marked as an overlay so A-Eye never lands on it. The
 * background decides what it shows; the orb owns only what lives and dies with the page —
 * where it is being dragged, what has been said since the last send, and what rides along.
 */
export function exposeHandsFree(): void {
  let orb: Orb | null = null;

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isOrbCommand(message)) return;
    if (message.op === 'hide') {
      orb?.leave();
      orb = null;
    } else if (message.op === 'show') {
      if (!orb?.alive()) orb = mountOrb(message.view);
      else orb.update(message.view);
    } else if (message.op === 'heard') {
      orb?.heard(message.text, message.final);
    } else {
      orb?.say(message.text, message.tone);
    }
    sendResponse({ ok: orb?.alive() ?? message.op === 'hide' });
  });

  document.getElementById(HOST_ID)?.remove();
  resync();
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    orb?.remove();
    orb = null;
    resync();
  });

  function resync(): void {
    void request({ op: 'sync' });
  }
}

interface Orb {
  alive: () => boolean;
  update: (view: OrbView) => void;
  heard: (text: string, final: boolean) => void;
  say: (text: string, tone: CaptionTone) => void;
  leave: () => void;
  remove: () => void;
}

function mountOrb(first: OrbView): Orb | null {
  if (!document.documentElement) return null;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute(OVERLAY_ATTRIBUTE, '');
  host.style.cssText = 'all: initial; position: static;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${STYLES}</style>
    <div class="layer" role="region" aria-label="Browsentic hands-free">
      <div class="caption" hidden><span class="label"></span><p class="words" aria-live="polite"></p><div class="chips"></div></div>
      <div class="pop" role="dialog" aria-label="The agent is asking to act" hidden></div>
      <div class="wrap">
        <span class="halo"></span>
        ${MENU.map(
          ({ id, icon: name, label }, index) =>
            `<button type="button" class="item" data-item="${id}" style="--i:${index};--r:${MENU.length - 1 - index}" aria-label="${escape(label)}">${icon(name)}<span class="tip">${escape(label)}</span>${id === 'file' ? '<b class="badge"></b>' : ''}</button>`,
        ).join('')}
        <svg class="ring" viewBox="0 0 72 72" aria-hidden="true"><circle class="track" cx="36" cy="36" r="33"/><circle class="count" cx="36" cy="36" r="33"/></svg>
        <span class="ping"></span><span class="ping2"></span>
        <span class="spin"></span>
        <button type="button" class="orb">
          <span class="face mic">${icon('mic')}</span>
          <span class="face off">${icon('micOff')}</span>
          <span class="face shield">${icon('shield')}</span>
          <span class="face dots"><i></i><i></i><i></i></span>
          <span class="face stop">${icon('stop')}</span>
          <span class="status"></span>
          <span class="keycap" aria-hidden="true">${escape(HOLD_KEY.cap)}</span>
        </button>
      </div>
      <input type="file" hidden />
    </div>`;
  document.documentElement.append(host);

  const $ = <T extends Element>(selector: string) => root.querySelector(selector) as T;
  const layer = $<HTMLElement>('.layer');
  const wrap = $<HTMLElement>('.wrap');
  const button = $<HTMLButtonElement>('.orb');
  const halo = $<HTMLElement>('.halo');
  const caption = $<HTMLElement>('.caption');
  const label = $<HTMLElement>('.label');
  const words = $<HTMLElement>('.words');
  const chips = $<HTMLElement>('.chips');
  const pop = $<HTMLElement>('.pop');
  const picker = $<HTMLInputElement>('input[type="file"]');
  const items = new Map<MenuId, HTMLButtonElement>(
    [...root.querySelectorAll<HTMLButtonElement>('.item')].map((item) => [item.dataset.item as MenuId, item]),
  );

  let view = first;
  let alive = true;
  let center: Point = placeOrb(view.position, viewport());
  let menuOpen = false;
  let popOpen = false;
  let picking = false;

  let committed = '';
  let interim = '';
  let shown: string[] = [];
  let kind: CaptionKind | null = null;
  let heldSay: { text: string; tone: CaptionTone } | null = null;

  let liveTools = false;
  let focus: FocusedElement | null = null;
  const files: { id: string; name: string }[] = [];

  let hold: 'idle' | 'pending' | 'talking' = 'idle';
  let settling = false;
  let muffled = false;

  let pointer: { id: number; start: Point; grab: Point; moved: boolean } | null = null;
  let lifted = false;
  let swallowClick = false;

  const timers = {
    hover: 0,
    close: 0,
    press: 0,
    count: 0,
    speaking: 0,
    caption: 0,
    glide: 0,
    idle: 0,
    hold: 0,
    settle: 0,
  };
  const stop = (name: keyof typeof timers) => {
    clearTimeout(timers[name]);
    timers[name] = 0;
  };

  paintTheme();
  paintState(null);
  applyPosition();
  const fresh = Date.now() - view.since < FRESH_MS && document.visibilityState === 'visible';
  wrap.classList.add(fresh ? 'entering' : 'arriving');
  wrap.addEventListener('animationend', (event) => {
    if (event.target === wrap) wrap.classList.remove('entering', 'arriving');
  });
  if (fresh) hint('Hands-free is on — just speak. Hover the mic for more.');
  else voiceHint(null);

  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('contextmenu', (event) => event.preventDefault());
  button.addEventListener('pointerdown', onPointerDown);
  button.addEventListener('pointermove', onPointerMove);
  button.addEventListener('pointerup', onPointerUp);
  button.addEventListener('pointercancel', onPointerUp);
  button.addEventListener('click', () => {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    press();
  });
  button.addEventListener('focus', () => {
    if (button.matches(':focus-visible')) openMenu();
  });

  wrap.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    stop('close');
    if (!menuOpen && !lifted && !popOpen && !picking) timers.hover = window.setTimeout(openMenu, HOVER_OPEN_MS);
  });
  wrap.addEventListener('pointerleave', () => {
    stop('hover');
    if (menuOpen && !lifted) timers.close = window.setTimeout(closeMenu, HOVER_CLOSE_MS);
  });
  wrap.addEventListener('focusout', (event) => {
    if (!wrap.contains(event.relatedTarget as Node | null) && !wrap.matches(':hover')) closeMenu();
  });
  layer.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeMenu();
    closePop();
  });

  for (const [id, item] of items) {
    item.addEventListener('mousedown', (event) => event.preventDefault());
    item.addEventListener('click', () => choose(id));
  }
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (file) void attach(file);
  });

  /* The page widens the moment the panel it was detached from closes; the orb glides to the
     new middle rather than jumping there. */
  const onResize = () => {
    if (!lifted) center = placeOrb(view.position, viewport());
    wrap.classList.add('gliding');
    stop('glide');
    timers.glide = window.setTimeout(() => wrap.classList.remove('gliding'), GLIDE_MS);
    applyPosition();
  };
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || !heldSay) return;
    const held = heldSay;
    heldSay = null;
    say(held.text, held.tone);
  };
  /* Hold-to-talk's key, heard from the page itself. A key the page made up is never a person
     holding one, so only trusted events count — anything else could open the microphone. */
  const detached = () => {
    if (host.isConnected) return false;
    remove();
    return true;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.isTrusted || detached()) return;
    if (event.code !== HOLD_KEY_CODE) holdCancel();
    else if (!event.repeat && !event.shiftKey && !event.altKey && !event.metaKey) holdDown();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.isTrusted && !detached() && event.code === HOLD_KEY_CODE) holdUp();
  };
  const onInterrupt = (event: Event) => {
    if (event.isTrusted && !detached()) holdCancel();
  };
  const onHidden = () => {
    if (document.visibilityState !== 'visible') holdCancel();
  };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('pointerdown', onInterrupt, true);
  window.addEventListener('wheel', onInterrupt, { capture: true, passive: true });
  window.addEventListener('blur', holdCancel);
  document.addEventListener('visibilitychange', onHidden);

  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('visibilitychange', onVisible);

  function viewport() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function paintTheme(): void {
    const palette = RAIL_PALETTES[view.theme];
    const tones = RAIL_TONES[view.theme];
    for (const [key, value] of Object.entries(palette)) layer.style.setProperty(`--${key}`, value);
    layer.style.setProperty('--magenta', tones.listening);
    layer.style.setProperty('--ember', tones.warn);
    layer.style.setProperty('--amber', tones.pending);
    layer.style.setProperty('--lime', tones.live);
    layer.toggleAttribute('data-light', view.theme === 'daylight');
  }

  function listening(): boolean {
    return view.run === 'idle' && (view.voice === 'listening' || view.voice === 'starting');
  }

  function drafting(): boolean {
    return Boolean(committed || interim || timers.count);
  }

  function paintState(before: OrbView | null): void {
    const { run, voice, link } = view;
    const face =
      run === 'approval'
        ? 'shield'
        : run === 'working'
          ? 'dots'
          : listening() || voice === 'paused' || voice === 'held'
            ? 'mic'
            : 'off';
    const tone =
      run === 'approval'
        ? 'ask'
        : run === 'working'
          ? 'work'
          : listening() || hold === 'talking'
            ? 'listen'
            : voice in VOICE_HINTS
              ? 'trouble'
              : 'quiet';
    wrap.dataset.face = face;
    wrap.dataset.tone = tone;
    wrap.dataset.link = link;
    wrap.classList.toggle('push-to-talk', view.pushToTalk);
    const talkItem = items.get('talk');
    talkItem?.classList.toggle('on', view.pushToTalk);
    const talkTip = talkItem?.querySelector('.tip');
    if (talkTip) talkTip.textContent = view.pushToTalk ? `Hold to talk is on — ${HOLD_KEY.name}` : `Hold ${HOLD_KEY.name} to talk`;
    button.setAttribute('aria-label', pressLabel());
    if (!before) return;

    if (hold !== 'idle' && !holdable()) holdCancel();
    if (voice === 'held') muffled = false;

    if (before.run !== 'approval' && run === 'approval' && view.approval) {
      const { action, site } = view.approval;
      show('ask', `The agent wants to ${spoken(action)}${site ? ` on ${site}` : ''} — tap the mic to review it.`, 0);
    }
    if (run !== 'approval') {
      closePop();
      if (kind === 'ask') fadeCaption();
    }
    if (settling && voice === 'held') flush();
    else if (!listening() && drafting() && hold !== 'talking' && !settling) {
      discardDraft();
      if (kind === 'speech') fadeCaption();
    }
    if (voice !== before.voice && voice !== 'held' && before.voice !== 'held') voiceHint(before);
  }

  function voiceHint(before: OrbView | null): void {
    if (document.visibilityState !== 'visible' || view.run !== 'idle') return;
    const trouble = VOICE_HINTS[view.voice];
    if (trouble) hint(trouble);
    else if (view.voice === 'muted' && before) hint('Muted — tap the mic to listen again.');
    else if (listening() && before && (before.voice === 'muted' || before.voice in VOICE_HINTS)) hint('Listening…');
  }

  function pressLabel(): string {
    if (view.run === 'approval') return 'Review what the agent is asking to do';
    if (view.run === 'working') return 'Stop the agent';
    if (drafting()) return 'Discard what you said';
    if (view.voice === 'held') return `Hold ${HOLD_KEY.name} to talk`;
    if (view.voice === 'needs-mic' || view.voice === 'blocked') return 'Allow the microphone';
    if (view.link === 'off') return 'Open the side panel to pair';
    if (listening()) return 'Mute the microphone';
    return 'Listen';
  }

  function press(): void {
    stop('hover');
    if (view.run === 'approval') {
      togglePop();
      return;
    }
    closeMenu();
    if (view.run === 'working') {
      void request({ op: 'cancel' });
      hint('Stopping the agent…');
      return;
    }
    if (drafting()) {
      discardDraft();
      show('hint', 'Cleared — say it again.', HINT_MS);
      return;
    }
    if (view.voice === 'needs-mic' || view.voice === 'blocked') {
      void request({ op: 'grantMic' });
      return;
    }
    if (view.link === 'off') {
      void request({ op: 'openPanel' });
      return;
    }
    if (view.link === 'pending') {
      hint('Reconnecting to the Browsentic daemon…');
      return;
    }
    if (view.voice === 'held') {
      hint(`Hold ${HOLD_KEY.name} to talk — let go to send.`);
      return;
    }
    void request({ op: 'listen', on: !listening() });
  }

  function heard(text: string, final: boolean): void {
    if (picking || muffled || !(listening() || hold === 'talking' || settling)) return;
    if (final) {
      committed = committed ? `${committed} ${text}` : text;
      interim = '';
      if (!view.pushToTalk) startCountdown();
    } else {
      interim = text;
      stopCountdown();
    }
    stop('idle');
    if (!view.pushToTalk) {
      timers.idle = window.setTimeout(() => {
        if (timers.count) return;
        discardDraft();
        fadeCaption();
      }, SPEECH_IDLE_MS);
    }
    wrap.classList.add('speaking');
    stop('speaking');
    timers.speaking = window.setTimeout(() => wrap.classList.remove('speaking'), SPEAKING_MS);
    stream('speech', [committed, interim].filter(Boolean).join(' '), SPEECH_STAGGER_MS, wordsOf(committed).length);
    button.setAttribute('aria-label', pressLabel());
  }

  function discardDraft(): void {
    stopCountdown();
    stop('idle');
    committed = '';
    interim = '';
  }

  function startCountdown(): void {
    stop('count');
    wrap.classList.remove('counting');
    void wrap.offsetWidth;
    wrap.classList.add('counting');
    timers.count = window.setTimeout(submit, AUTO_SEND_MS);
  }

  function stopCountdown(): void {
    stop('count');
    wrap.classList.remove('counting');
  }

  function holdable(): boolean {
    return view.pushToTalk && view.run === 'idle' && view.link === 'live' && !picking && !popOpen && !lifted;
  }

  function holdDown(): void {
    if (hold !== 'idle' || settling || !holdable() || view.voice !== 'held') return;
    hold = 'pending';
    timers.hold = window.setTimeout(() => {
      hold = 'talking';
      muffled = false;
      discardDraft();
      closeMenu();
      wrap.classList.add('holding');
      void request({ op: 'talk', on: true });
      show('speech', '', 0);
    }, HOLD_MS);
  }

  function holdUp(): void {
    if (hold === 'pending') {
      stop('hold');
      hold = 'idle';
      return;
    }
    if (hold !== 'talking') return;
    hold = 'idle';
    wrap.classList.remove('holding');
    void request({ op: 'talk', on: false });
    settling = true;
    stop('settle');
    timers.settle = window.setTimeout(flush, SETTLE_MS);
  }

  /** A shortcut, a click or a scroll while the key was down: it was never meant as speech. */
  function holdCancel(): void {
    stop('hold');
    if (hold !== 'talking') {
      hold = 'idle';
      return;
    }
    hold = 'idle';
    muffled = true;
    wrap.classList.remove('holding');
    void request({ op: 'talk', on: false });
    discardDraft();
    if (kind === 'speech') fadeCaption();
  }

  /** The key is up and the recognizer has finished the last words: send what was said, straight away. */
  function flush(): void {
    stop('settle');
    if (!settling) return;
    settling = false;
    committed = [committed, interim].filter(Boolean).join(' ');
    interim = '';
    if (committed.trim()) submit();
    else {
      discardDraft();
      if (kind === 'speech') fadeCaption();
    }
  }

  function submit(): void {
    stopCountdown();
    stop('idle');
    const text = committed.trim();
    committed = '';
    interim = '';
    if (!text) return;
    void request({ op: 'submit', text, focus: focus ?? undefined, liveTools });
    focus = null;
    files.length = 0;
    paintChips();
    items.get('focus')?.classList.remove('on');
    kind = 'sent';
    caption.dataset.kind = 'sent';
    label.textContent = LABELS.sent;
    for (const token of words.children) token.classList.remove('interim');
    armCaption(SENT_MS);
  }

  function say(text: string, tone: CaptionTone): void {
    if (document.visibilityState !== 'visible') {
      heldSay = { text, tone };
      return;
    }
    if (drafting()) return;
    show(TONE_KIND[tone], text, readingMs(text));
  }

  function hint(text: string): void {
    if (kind === 'speech' || kind === 'ask') return;
    show('hint', text, HINT_MS);
  }

  function show(next: CaptionKind, text: string, lingerMs: number): void {
    stream(next, text, next === 'hint' ? 0 : REPLY_STAGGER_MS);
    if (lingerMs > 0) armCaption(lingerMs);
    else stop('caption');
  }

  /** New words blur in one after another; words a revised reading kept stay exactly where they were. */
  function stream(next: CaptionKind, text: string, staggerMs: number, settled = Infinity): void {
    const incoming = wordsOf(text);
    const keep = kind === next ? sharedWords(shown, incoming) : 0;
    if (kind !== next) {
      kind = next;
      caption.dataset.kind = next;
      label.textContent = LABELS[next];
    }
    stop('caption');
    caption.classList.remove('leaving');
    caption.hidden = false;

    while (words.children.length > keep) words.lastElementChild?.remove();
    incoming.slice(keep).forEach((word, index) => {
      const token = document.createElement('span');
      token.className = 'tok';
      token.textContent = word;
      token.style.animationDelay = `${index * staggerMs}ms`;
      words.append(token);
    });
    [...words.children].forEach((token, index) => token.classList.toggle('interim', index >= settled));
    shown = incoming;
    placeCaption();
    words.classList.toggle('overflow', overflowing());
  }

  /* Measured from the tokens' own boxes: they are still rising into place when this runs, and
     a bottom-aligned box that overflows does so at its top, which scrollHeight never counts. */
  function overflowing(): boolean {
    const first = words.firstElementChild as HTMLElement | null;
    const last = words.lastElementChild as HTMLElement | null;
    if (!first || !last) return false;
    return last.offsetTop + last.offsetHeight - first.offsetTop > words.clientHeight + 1;
  }

  function armCaption(ms: number): void {
    stop('caption');
    timers.caption = window.setTimeout(fadeCaption, ms);
  }

  function fadeCaption(): void {
    stop('caption');
    kind = null;
    shown = [];
    caption.classList.add('leaving');
    timers.caption = window.setTimeout(() => {
      words.replaceChildren();
      label.textContent = '';
      caption.classList.remove('leaving');
      caption.removeAttribute('data-kind');
      caption.hidden = chips.childElementCount === 0;
      placeCaption();
    }, 200);
  }

  function paintChips(): void {
    const chip = (name: OrbIcon, text: string, onClear: () => void) => {
      const element = document.createElement('span');
      element.className = 'chip';
      element.innerHTML = `${icon(name)}<span>${escape(text)}</span><button type="button" aria-label="Remove">${icon('close')}</button>`;
      element.querySelector('button')!.addEventListener('click', () => {
        onClear();
        paintChips();
      });
      return element;
    };
    const next: HTMLElement[] = [];
    if (focus) {
      next.push(
        chip('focus', `A-Eye · ${focusName(focus)}`, () => {
          focus = null;
          items.get('focus')?.classList.remove('on');
        }),
      );
    }
    if (liveTools) {
      next.push(
        chip('code', 'Live code', () => {
          liveTools = false;
          items.get('code')?.classList.remove('on');
        }),
      );
    }
    for (const file of files) {
      next.push(
        chip('file', file.name, () => {
          files.splice(files.indexOf(file), 1);
          void request({ op: 'detach', fileId: file.id });
        }),
      );
    }
    chips.replaceChildren(...next);
    const badge = items.get('file')?.querySelector('.badge');
    if (badge) {
      badge.textContent = files.length ? String(files.length) : '';
      badge.classList.toggle('shown', files.length > 0);
    }
    if (next.length) caption.hidden = false;
    else if (!kind) caption.hidden = true;
    placeCaption();
  }

  function choose(id: MenuId): void {
    if (id === 'file') {
      closeMenu();
      picker.click();
    } else if (id === 'code') {
      liveTools = !liveTools;
      items.get('code')?.classList.toggle('on', liveTools);
      paintChips();
      hint(
        liveTools
          ? 'Live code on — the agent may write a script for this page. You approve it before it runs.'
          : 'Live code off.',
      );
    } else if (id === 'focus') {
      closeMenu();
      void pickFocus();
    } else if (id === 'talk') {
      const on = !view.pushToTalk;
      void request({ op: 'pushToTalk', on });
      hint(on ? `Hold to talk — hold ${HOLD_KEY.name} and speak, let go to send.` : 'Listening all the time again.');
    } else {
      void request({ op: 'openPanel' });
    }
  }

  async function pickFocus(): Promise<void> {
    if (picking) return;
    picking = true;
    stopCountdown();
    wrap.classList.add('picking');
    caption.hidden = true;
    const outcome = await request<{ focus?: FocusedElement; error?: string }>({ op: 'pick' });
    picking = false;
    wrap.classList.remove('picking');
    if (outcome?.focus) {
      focus = outcome.focus;
      items.get('focus')?.classList.add('on');
      paintChips();
      hint(`A-Eye has ${focusName(focus)} — say what to do with it.`);
    } else {
      paintChips();
      if (outcome?.error) show('error', `A-Eye couldn’t read that element: ${outcome.error}`, HINT_MS);
    }
  }

  async function attach(file: File): Promise<void> {
    const content = file.size <= MAX_STORED_FILE_BYTES ? await readAsBase64(file).catch(() => undefined) : undefined;
    const outcome = await request<{ ok: boolean; fileId?: string; error?: string }>({
      op: 'attach',
      file: { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, content },
    });
    if (!outcome?.ok || !outcome.fileId) {
      show('error', `Couldn’t attach “${file.name}”${outcome?.error ? `: ${outcome.error}` : ''}.`, HINT_MS);
      return;
    }
    files.push({ id: outcome.fileId, name: file.name });
    paintChips();
    hint(`Attached ${file.name} — say what to do with it.`);
  }

  function openMenu(): void {
    stop('hover');
    stop('close');
    if (menuOpen || lifted || popOpen || picking) return;
    menuOpen = true;
    layoutMenu();
    wrap.classList.add('open');
    placeCaption();
  }

  function closeMenu(): void {
    stop('hover');
    stop('close');
    if (!menuOpen) return;
    menuOpen = false;
    wrap.classList.remove('open');
    placeCaption();
  }

  function layoutMenu(): void {
    const outward = outwardFrom(center, viewport());
    const slots = arcSlots(MENU.length, outward);
    MENU.forEach(({ id }, index) => {
      const item = items.get(id);
      const slot = slots[index];
      if (!item || !slot) return;
      item.style.setProperty('--x', `${slot.x}px`);
      item.style.setProperty('--y', `${slot.y}px`);
      item.dataset.tip = tipSide(slot);
    });
    halo.style.setProperty('--halo', `${menuRadius(outward) + MENU_ITEM / 2 + 14}px`);
  }

  function togglePop(): void {
    if (popOpen) closePop();
    else openPop();
  }

  function openPop(): void {
    const ask = view.approval;
    if (!ask) return;
    closeMenu();
    popOpen = true;
    const always = ask.site && !ask.code;
    pop.innerHTML = `
      <div class="pop-head">${icon('shield')}<span class="pop-title">${escape(ask.code ? 'Allow this code to run?' : `Allow ${spoken(ask.action)}?`)}</span></div>
      ${ask.site ? `<p class="pop-site">on ${escape(ask.site)}</p>` : ''}
      ${ask.code ? `<p class="pop-purpose">${escape(ask.purpose ?? 'No purpose given.')}</p><pre class="pop-code">${escape(ask.code)}</pre>` : ''}
      ${!ask.code && ask.detail ? `<p class="pop-detail">${escape(ask.detail)}</p>` : ''}
      <div class="pop-actions">
        <button type="button" class="btn" data-decide="deny">Deny</button>
        ${always ? `<button type="button" class="btn" data-decide="always" title="Stop asking for ${escape(ask.action)} on ${escape(ask.site!)}">Always on ${escape(ask.site!)}</button>` : ''}
        <button type="button" class="btn primary" data-decide="allow">Allow</button>
      </div>
      <span class="arrow"></span>`;
    for (const choice of pop.querySelectorAll<HTMLButtonElement>('[data-decide]')) {
      /* The one click here that must come from a person: it lets the agent act. */
      choice.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        const decision = choice.dataset.decide;
        void request({ op: 'decide', toolId: ask.toolId, allow: decision !== 'deny', remember: decision === 'always' });
        closePop();
        hint(decision === 'deny' ? 'Denied.' : 'Allowed — carrying on.');
      });
    }
    pop.hidden = false;
    if (kind === 'ask') {
      kind = null;
      caption.hidden = chips.childElementCount === 0;
    }
    placePop();
    pop.querySelector<HTMLButtonElement>('[data-decide="deny"]')?.focus({ preventScroll: true });
  }

  function closePop(): void {
    if (!popOpen) return;
    popOpen = false;
    pop.hidden = true;
    pop.replaceChildren();
    placeCaption();
  }

  function applyPosition(): void {
    wrap.style.left = `${center.x}px`;
    wrap.style.top = `${center.y}px`;
    if (menuOpen) layoutMenu();
    placeCaption();
    placePop();
  }

  function placeCaption(): void {
    if (caption.hidden) return;
    const outward = outwardFrom(center, viewport());
    const gap = menuOpen ? clearOfMenu(outward) + TIP_ROOM_PX : 12;
    const placed = placeBeside(
      { width: caption.offsetWidth, height: caption.offsetHeight },
      center,
      gap,
      viewport(),
      sidesFacing(outward),
    );
    caption.dataset.side = placed.side;
    caption.style.left = `${placed.left}px`;
    caption.style.top = `${placed.top}px`;
  }

  function placePop(): void {
    if (!popOpen) return;
    const placed = placeBeside(
      { width: pop.offsetWidth, height: pop.offsetHeight },
      center,
      16,
      viewport(),
      sidesFacing(outwardFrom(center, viewport())),
    );
    const along = placed.side === 'top' || placed.side === 'bottom' ? pop.offsetWidth : pop.offsetHeight;
    pop.dataset.side = placed.side;
    pop.style.left = `${placed.left}px`;
    pop.style.top = `${placed.top}px`;
    pop.style.setProperty('--arrow', `${Math.min(along - 18, Math.max(18, placed.arrow))}px`);
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) return;
    stop('hover');
    const start = { x: event.clientX, y: event.clientY };
    pointer = { id: event.pointerId, start, grab: { x: start.x - center.x, y: start.y - center.y }, moved: false };
    timers.press = window.setTimeout(() => {
      if (!pointer) return;
      lifted = true;
      closeMenu();
      closePop();
      wrap.classList.add('lifted');
      caption.classList.add('dragged');
      button.setPointerCapture(pointer.id);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (!lifted) {
      if (Math.hypot(event.clientX - pointer.start.x, event.clientY - pointer.start.y) > DRAG_SLOP_PX) {
        stop('press');
        pointer.moved = true;
      }
      return;
    }
    const room = viewport();
    center = placeOrb(toPosition({ x: event.clientX - pointer.grab.x, y: event.clientY - pointer.grab.y }, room), room);
    applyPosition();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!pointer || event.pointerId !== pointer.id) return;
    stop('press');
    const dragged = lifted || pointer.moved;
    pointer = null;
    if (lifted) {
      lifted = false;
      wrap.classList.remove('lifted');
      caption.classList.remove('dragged');
      void request({ op: 'move', position: toPosition(center, viewport()) });
    }
    if (!dragged) return;
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 0);
  }

  function update(next: OrbView): void {
    const before = view;
    view = next;
    if (next.theme !== before.theme) paintTheme();
    if (!lifted && (next.position?.x !== before.position?.x || next.position?.y !== before.position?.y)) {
      center = placeOrb(next.position, viewport());
      applyPosition();
    }
    paintState(before);
    if (popOpen && next.approval?.toolId !== before.approval?.toolId) {
      closePop();
      if (next.approval) openPop();
    }
  }

  function remove(): void {
    alive = false;
    for (const name of Object.keys(timers) as (keyof typeof timers)[]) stop(name);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('pointerdown', onInterrupt, true);
    window.removeEventListener('wheel', onInterrupt, true);
    window.removeEventListener('blur', holdCancel);
    document.removeEventListener('visibilitychange', onHidden);
    host.remove();
  }

  function leave(): void {
    if (!alive) return;
    holdCancel();
    alive = false;
    closeMenu();
    closePop();
    fadeCaption();
    wrap.classList.add('leaving');
    window.setTimeout(remove, LEAVE_MS);
  }

  return { alive: () => alive && host.isConnected, update, heard, say, leave, remove };
}

function tipSide(slot: Slot): 'top' | 'bottom' | 'left' | 'right' {
  if (Math.abs(slot.x) > Math.abs(slot.y)) return slot.x > 0 ? 'right' : 'left';
  return slot.y > 0 ? 'bottom' : 'top';
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(typeof result === 'string' ? result.slice(result.indexOf(',') + 1) : '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
