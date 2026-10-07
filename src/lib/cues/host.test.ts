import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { OVERLAY_ATTRIBUTE } from '@/lib/overlay';
import { CUE_CHANNEL, CUE_FADE_MS, CUE_LINGER_MS, type CueCommand, type CuePlan } from './events';
import { CUE_HOST_ID, exposeCues } from './host';

type Unsent<T> = T extends unknown ? Omit<T, 'channel'> : never;
type Trigger = (message: unknown, sender: unknown, respond: (value: unknown) => void) => unknown;

let root: ShadowRoot | null;
let watcher: MutationObserver;
let mutations: MutationRecord[];

/* The host answers through sendResponse once it has painted, which the fake's typing leaves out. */
function deliver(command: Unsent<CueCommand>): Promise<unknown> {
  return new Promise((resolve) => {
    void (fakeBrowser.runtime.onMessage.trigger as unknown as Trigger)({ channel: CUE_CHANNEL, ...command }, {}, resolve);
  });
}

async function show(id: string, plan: CuePlan): Promise<unknown> {
  const reply = deliver({ op: 'show', id, plan, theme: 'ember' });
  await vi.advanceTimersByTimeAsync(40);
  return reply;
}

const click = (selector: string): CuePlan => ({ kind: 'element', verb: 'Click', anchors: [{ target: { selector, nth: 0 } }] });

function laidOut<T extends Element>(element: T, box = { left: 100, top: 200, width: 80, height: 30 }): T {
  vi.spyOn(element as Element, 'getBoundingClientRect').mockReturnValue({
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => box,
  } as DOMRect);
  return element;
}

function onPage<T extends HTMLElement>(html: string): T {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const element = wrap.firstElementChild as T;
  document.body.append(element);
  return element;
}

const $ = <T extends Element = HTMLElement>(selector: string) => root!.querySelector(selector) as T;
const $$ = (selector: string) => [...root!.querySelectorAll<HTMLElement>(selector)];
const chip = () => $('.cue:not(.out) .chip').textContent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  fakeBrowser.reset();
  root = null;
  document.body.innerHTML = '';
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    root = attach.call(this, { ...init, mode: 'open' });
    return root;
  });
  mutations = [];
  watcher = new MutationObserver((records) => mutations.push(...records));
  watcher.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  exposeCues();
});

afterEach(() => {
  watcher.disconnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.getElementById(CUE_HOST_ID)?.remove();
});

describe('action cues on the page', () => {
  it('rings the element the action will hit, captioned with what a person would call it', async () => {
    laidOut(onPage('<button id="go">Sign in</button>'));
    expect(await show('a', click('#go'))).toEqual({ ok: true });

    const ring = $('.ring');
    expect(ring.classList.contains('hidden')).toBe(false);
    expect(ring.style.transform).toBe('translate(96px, 196px)');
    expect(ring.style.width).toBe('88px');
    expect(ring.style.height).toBe('38px');
    expect(chip()).toBe('Click · Sign in');
    expect($('.edge').classList.contains('hidden')).toBe(true);
  });

  it('adds one marked element to the page on its first cue and never touches the page again', async () => {
    laidOut(onPage('<button id="go">Sign in</button>'));
    await Promise.resolve();
    mutations = [];

    await show('a', click('#go'));
    await deliver({ op: 'settle', id: 'a', ok: true });
    await show('b', { kind: 'page', verb: 'Read page', anchors: [] });
    await vi.advanceTimersByTimeAsync(CUE_LINGER_MS + CUE_FADE_MS + 100);
    const quenched = deliver({ op: 'quench' });
    await vi.advanceTimersByTimeAsync(40);
    await quenched;

    const host = document.getElementById(CUE_HOST_ID)!;
    expect(host.hasAttribute(OVERLAY_ATTRIBUTE)).toBe(true);
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.style.pointerEvents).toBe('none');
    const records = [...mutations, ...watcher.takeRecords()];
    expect(records).toHaveLength(1);
    expect([...records[0].addedNodes]).toEqual([host]);
  });

  it('leaves focus and scroll where the page had them', async () => {
    const field = onPage<HTMLInputElement>('<input id="q" aria-label="Search">');
    field.focus();
    laidOut(onPage('<button id="go">Sign in</button>'));
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    onTestFinished(() => {
      Element.prototype.scrollIntoView = original;
    });

    await show('a', click('#go'));
    await vi.advanceTimersByTimeAsync(500);

    expect(document.activeElement).toBe(field);
    expect(focus).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(0);
  });

  it('never names a field by what has been typed into it', async () => {
    laidOut(onPage('<label>Password <input id="pw" type="password" value="hunter2"></label>').querySelector('input')!);
    await show('a', { kind: 'element', verb: 'Fill', anchors: [{ target: { selector: '#pw', nth: 0 } }] });
    expect(chip()).toBe('Fill · Password');

    laidOut(onPage('<div id="note" contenteditable="true" aria-label="Message">my secret plan</div>'));
    await show('b', { kind: 'element', verb: 'Type', anchors: [{ target: { selector: '#note', nth: 0 } }] });
    expect(chip()).toBe('Type · Message');
    expect(root!.textContent).not.toContain('secret');
    expect(root!.textContent).not.toContain('hunter2');
  });

  it('names a field inside its label by the label alone, and a wrapper by its text outside the editor', async () => {
    laidOut(onPage('<label>Notes <textarea id="notes">my private note</textarea></label>').querySelector('textarea')!);
    await show('a', { kind: 'element', verb: 'Fill', anchors: [{ target: { selector: '#notes', nth: 0 } }] });
    expect(chip()).toBe('Fill · Notes');

    laidOut(onPage('<div id="editor">Draft <div contenteditable="true">my private draft</div></div>'));
    await show('b', click('#editor'));
    expect(chip()).toBe('Click · Draft');
    expect(root!.textContent).not.toContain('private');
  });

  it('glows around the page when there is no element, or the element is not there', async () => {
    await show('a', { kind: 'page', verb: 'Go to', detail: 'example.com', anchors: [] });
    expect($('.edge').classList.contains('hidden')).toBe(false);
    expect(chip()).toBe('Go to example.com');

    await show('b', click('#missing'));
    expect($('.cue:not(.out) .edge').classList.contains('hidden')).toBe(false);
    expect($('.cue:not(.out) .ring').classList.contains('hidden')).toBe(true);
  });

  it('finds an element it is waiting for once the page adds it', async () => {
    await show('a', { kind: 'element', verb: 'Wait for', anchors: [{ target: { selector: '#late', nth: 0 } }] });
    expect($('.ring').classList.contains('hidden')).toBe(true);

    laidOut(onPage('<button id="late">Continue</button>'));
    await vi.advanceTimersByTimeAsync(400);
    expect($('.ring').classList.contains('hidden')).toBe(false);
    expect(chip()).toBe('Wait for · Continue');
  });

  it('lingers once the action is done, then fades and clears', async () => {
    laidOut(onPage('<button id="go">Sign in</button>'));
    await show('a', click('#go'));
    await deliver({ op: 'settle', id: 'a', ok: false });
    expect($('.cue').classList.contains('failed')).toBe(true);

    await vi.advanceTimersByTimeAsync(CUE_LINGER_MS);
    expect($('.cue').classList.contains('out')).toBe(true);
    await vi.advanceTimersByTimeAsync(CUE_FADE_MS);
    expect($$('.cue')).toHaveLength(0);
  });

  it('hands over to the next cue at once', async () => {
    laidOut(onPage('<button id="go">Sign in</button>'));
    await show('a', click('#go'));
    await show('b', { kind: 'page', verb: 'Read page', anchors: [] });
    expect($$('.cue')).toHaveLength(2);
    expect($$('.cue')[0].classList.contains('out')).toBe(true);
    expect($$('.cue')[1].classList.contains('out')).toBe(false);
  });

  it('clears every cue at once when asked to stay out of a capture', async () => {
    laidOut(onPage('<button id="go">Sign in</button>'));
    await show('a', click('#go'));
    const reply = deliver({ op: 'quench' });
    expect($$('.cue')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(40);
    expect(await reply).toEqual({ ok: true });
  });

  it('rings a point when the action names coordinates instead of an element', async () => {
    await show('a', { kind: 'element', verb: 'Click', anchors: [{ point: { x: 50, y: 60 } }] });
    const ring = $('.ring.point');
    expect(ring.classList.contains('hidden')).toBe(false);
    expect(ring.style.transform).toBe('translate(36px, 46px)');
  });
});
