import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { OVERLAY_ATTRIBUTE } from '@/lib/overlay';
import { AUTO_SEND_MS, HANDS_FREE_CHANNEL, type OrbCommand, type OrbView } from './events';
import { exposeHandsFree } from './host';

type Frame = { op: string } & Record<string, unknown>;
type Unsent<T> = T extends unknown ? Omit<T, 'channel'> : never;
type Trigger = (message: unknown, sender: unknown, respond: (value: unknown) => void) => Promise<unknown>;

const view = (patch: Partial<OrbView> = {}): OrbView => ({
  theme: 'ember',
  since: 0,
  position: null,
  link: 'live',
  run: 'idle',
  voice: 'listening',
  pushToTalk: false,
  ...patch,
});

/* A person pressing a key; a key event the page makes up is untrusted, and the orb ignores it. */
function key(type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}, trusted = true): void {
  const event = new KeyboardEvent(type, { code, bubbles: true, ...init });
  if (trusted) Object.defineProperty(event, 'isTrusted', { value: true });
  window.dispatchEvent(event);
}

function trustedClick(target: Element): void {
  const event = new MouseEvent('click', { bubbles: true });
  Object.defineProperty(event, 'isTrusted', { value: true });
  target.dispatchEvent(event);
}

let root: ShadowRoot | null;
let sent: Frame[];
const answers = new Map<string, unknown>();

/* The orb answers through sendResponse, which the fake's typing leaves out. */
async function deliver(command: Unsent<OrbCommand>): Promise<unknown> {
  let reply: unknown;
  await (fakeBrowser.runtime.onMessage.trigger as unknown as Trigger)({ channel: HANDS_FREE_CHANNEL, ...command }, {}, (value) => {
    reply = value;
  });
  return reply;
}

const show = (patch: Partial<OrbView> = {}) => deliver({ op: 'show', view: view(patch) });
const heard = (text: string, final: boolean) => deliver({ op: 'heard', text, final });
const $ = <T extends Element = HTMLElement>(selector: string) => root!.querySelector(selector) as T;
const requests = (op: string) => sent.filter((frame) => frame.op === op);
const shown = () => [...root!.querySelectorAll('.tok')].map((token) => token.textContent).join(' ');
const press = () => $('.orb').dispatchEvent(new MouseEvent('click', { bubbles: true }));

beforeEach(() => {
  vi.useFakeTimers();
  fakeBrowser.reset();
  sent = [];
  answers.clear();
  root = null;
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(async (message: unknown) => {
    const frame = message as Frame;
    sent.push(frame);
    return answers.get(frame.op) ?? { ok: true };
  });
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    root = attach.call(this, { ...init, mode: 'open' });
    return root;
  });
  if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => undefined;
  exposeHandsFree();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.getElementById('browsentic-hands-free')?.remove();
});

describe('the hands-free orb', () => {
  it('asks the background what to show as soon as the page loads', () => {
    expect(requests('sync')).toHaveLength(1);
  });

  it('mounts as a marked overlay A-Eye will skip, and says so to the background', async () => {
    expect(await show()).toEqual({ ok: true });
    expect(document.getElementById('browsentic-hands-free')?.hasAttribute(OVERLAY_ATTRIBUTE)).toBe(true);
    expect($('.wrap').dataset.tone).toBe('listen');
  });

  it('streams what is said, counts down after a pause, then sends it', async () => {
    await show();
    await heard('open the', false);
    await heard('open the second result', false);
    expect(shown()).toBe('open the second result');
    expect($('.wrap').classList.contains('counting')).toBe(false);

    await heard('open the second result', true);
    expect($('.wrap').classList.contains('counting')).toBe(true);
    expect(requests('submit')).toHaveLength(0);

    vi.advanceTimersByTime(AUTO_SEND_MS);
    expect(requests('submit')).toEqual([
      expect.objectContaining({ text: 'open the second result', liveTools: false }),
    ]);
    expect($('.caption').dataset.kind).toBe('sent');
  });

  it('keeps words that did not change, and only streams in the new ones', async () => {
    await show();
    await heard('scroll down', false);
    const first = root!.querySelector('.tok');
    await heard('scroll down a bit', false);
    expect(root!.querySelector('.tok')).toBe(first);
    expect(shown()).toBe('scroll down a bit');
  });

  it('throws the sentence away when pressed during the countdown', async () => {
    await show();
    await heard('delete my account', true);
    press();
    expect(shown()).toBe('Cleared — say it again.');
    vi.advanceTimersByTime(AUTO_SEND_MS * 2);
    expect(requests('submit')).toHaveLength(0);
  });

  it('waits for the next pause when speech resumes during the countdown', async () => {
    await show();
    await heard('open settings', true);
    vi.advanceTimersByTime(AUTO_SEND_MS - 200);
    await heard('and then', false);
    vi.advanceTimersByTime(AUTO_SEND_MS);
    expect(requests('submit')).toHaveLength(0);
    await heard('and then privacy', true);
    vi.advanceTimersByTime(AUTO_SEND_MS);
    expect(requests('submit')[0]).toMatchObject({ text: 'open settings and then privacy' });
  });

  it('ignores speech while the agent works, and a press stops the run', async () => {
    await show({ run: 'working', voice: 'paused' });
    await heard('click buy', true);
    vi.advanceTimersByTime(AUTO_SEND_MS);
    expect(requests('submit')).toHaveLength(0);
    expect($('.wrap').dataset.face).toBe('dots');
    press();
    expect(requests('cancel')).toHaveLength(1);
  });

  it('mutes, listens, asks for the microphone, or opens the panel, by what it is showing', async () => {
    await show();
    press();
    expect(requests('listen').at(-1)).toMatchObject({ on: false });

    await show({ voice: 'muted' });
    press();
    expect(requests('listen').at(-1)).toMatchObject({ on: true });

    await show({ voice: 'needs-mic' });
    press();
    expect(requests('grantMic')).toHaveLength(1);

    await show({ voice: 'paused', link: 'off' });
    press();
    expect(requests('openPanel')).toHaveLength(1);
  });

  it('turns ember for an approval and opens the request on a press, which a forged click cannot answer', async () => {
    await show();
    await show({
      run: 'approval',
      voice: 'paused',
      approval: { toolId: 't1', action: 'clickElement', site: 'shop.test', detail: 'selector: #buy' },
    });
    expect($('.wrap').dataset.tone).toBe('ask');
    expect($('.caption').dataset.kind).toBe('ask');

    press();
    expect($('.pop').hidden).toBe(false);
    expect($('.pop-title').textContent).toBe('Allow click element?');
    expect($('.pop-detail').textContent).toBe('selector: #buy');
    expect(root!.querySelector('[data-decide="always"]')?.textContent).toBe('Always on shop.test');

    $('[data-decide="allow"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(requests('decide')).toHaveLength(0);
    trustedClick($('[data-decide="always"]'));
    expect(requests('decide')).toEqual([expect.objectContaining({ toolId: 't1', allow: true, remember: true })]);

    await show({ run: 'working', voice: 'paused' });
    expect($('.pop').hidden).toBe(true);
  });

  it('shows the code the agent wrote, and never offers “always” for it', async () => {
    await show({
      run: 'approval',
      voice: 'paused',
      approval: { toolId: 't2', action: 'injectCode', site: 'shop.test', purpose: 'Total the cart', code: 'return 1 + 1;' },
    });
    press();
    expect($('.pop-code').textContent).toBe('return 1 + 1;');
    expect($('.pop-purpose').textContent).toBe('Total the cart');
    expect(root!.querySelector('[data-decide="always"]')).toBeNull();
  });

  it('opens the arc menu after a second of hover, and not before', async () => {
    await show();
    $('.wrap').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    vi.advanceTimersByTime(900);
    expect($('.wrap').classList.contains('open')).toBe(false);
    vi.advanceTimersByTime(100);
    expect($('.wrap').classList.contains('open')).toBe(true);
    const slots = [...root!.querySelectorAll<HTMLElement>('.item')].map((item) => Number.parseFloat(item.style.getPropertyValue('--x')));
    expect(slots).toEqual([...slots].sort((a, b) => a - b));
  });

  it('rides live code and an A-Eye pick along with the next instruction, then lets them go', async () => {
    await show();
    $('[data-item="code"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    answers.set('pick', { focus: { tag: 'button', label: 'Buy now', selector: '#buy' } });
    $('[data-item="focus"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(root!.querySelectorAll('.chip')).toHaveLength(2));
    expect(root!.querySelector('.chips')?.textContent).toContain('A-Eye · Buy now');

    await heard('buy it', true);
    vi.advanceTimersByTime(AUTO_SEND_MS);
    expect(requests('submit')[0]).toMatchObject({ text: 'buy it', liveTools: true, focus: { label: 'Buy now' } });
    expect(root!.querySelectorAll('.chip')).toHaveLength(1);
  });

  it('holds a reply for a tab nobody is looking at, and reads it once they are', async () => {
    await show();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await deliver({ op: 'say', text: 'Done — **three** results.', tone: 'reply' });
    expect(shown()).not.toContain('results.');

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect($('.caption').dataset.kind).toBe('reply');
    expect(shown()).toBe('Done — **three** results.');
  });

  it('drags on a long press and remembers where it was dropped', async () => {
    await show();
    const orb = $('.orb');
    const at = (type: string, x: number, y: number) =>
      orb.dispatchEvent(new PointerEvent(type, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true }));
    const start = { x: Number.parseFloat($('.wrap').style.left), y: Number.parseFloat($('.wrap').style.top) };
    at('pointerdown', start.x, start.y);
    vi.advanceTimersByTime(400);
    expect($('.wrap').classList.contains('lifted')).toBe(true);
    at('pointermove', start.x - 200, start.y - 150);
    at('pointerup', start.x - 200, start.y - 150);
    expect(requests('move')).toHaveLength(1);
    press();
    expect(requests('listen')).toHaveLength(0);
  });

  describe('hold to talk', () => {
    const held = { pushToTalk: true, voice: 'held' as const };

    it('toggles from the menu, and wears the key on the orb', async () => {
      await show();
      $('[data-item="talk"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(requests('pushToTalk')).toEqual([expect.objectContaining({ on: true })]);
      await show(held);
      expect($('.wrap').classList.contains('push-to-talk')).toBe(true);
      expect($('[data-item="talk"]').classList.contains('on')).toBe(true);
    });

    it('talks while left Control is held, and sends the moment the words are in', async () => {
      await show(held);
      key('keydown', 'ControlLeft');
      vi.advanceTimersByTime(250);
      expect(requests('talk')).toEqual([expect.objectContaining({ on: true })]);
      expect($('.wrap').classList.contains('holding')).toBe(true);

      await show({ ...held, voice: 'listening' });
      await heard('scroll to the', false);
      await heard('scroll to the reviews', true);
      vi.advanceTimersByTime(AUTO_SEND_MS * 2);
      expect(requests('submit')).toHaveLength(0);

      key('keyup', 'ControlLeft');
      expect(requests('talk').at(-1)).toMatchObject({ on: false });
      await show(held);
      expect(requests('submit')).toEqual([expect.objectContaining({ text: 'scroll to the reviews' })]);
    });

    it('sends what was still being heard when the key came up', async () => {
      await show(held);
      key('keydown', 'ControlLeft');
      vi.advanceTimersByTime(250);
      await show({ ...held, voice: 'listening' });
      await heard('go back', false);
      key('keyup', 'ControlLeft');
      vi.advanceTimersByTime(2500);
      expect(requests('submit')[0]).toMatchObject({ text: 'go back' });
    });

    it('never opens the mic for a tap, a shortcut, a click or a scroll', async () => {
      await show(held);
      key('keydown', 'ControlLeft');
      key('keyup', 'ControlLeft');
      vi.advanceTimersByTime(500);

      key('keydown', 'ControlLeft');
      key('keydown', 'KeyC', { ctrlKey: true });
      vi.advanceTimersByTime(500);

      key('keydown', 'ControlLeft', { shiftKey: true });
      vi.advanceTimersByTime(500);

      key('keydown', 'ControlLeft');
      const click = new PointerEvent('pointerdown', { bubbles: true });
      Object.defineProperty(click, 'isTrusted', { value: true });
      window.dispatchEvent(click);
      vi.advanceTimersByTime(500);

      expect(requests('talk')).toHaveLength(0);
    });

    it('throws the words away when a shortcut lands mid-hold', async () => {
      await show(held);
      key('keydown', 'ControlLeft');
      vi.advanceTimersByTime(250);
      await show({ ...held, voice: 'listening' });
      await heard('select all', false);
      key('keydown', 'KeyA', { ctrlKey: true });
      expect(requests('talk').at(-1)).toMatchObject({ on: false });
      await heard('select all', true);
      await show(held);
      vi.advanceTimersByTime(3000);
      expect(requests('submit')).toHaveLength(0);
    });

    it('ignores a Control press the page made up', async () => {
      await show(held);
      key('keydown', 'ControlLeft', {}, false);
      vi.advanceTimersByTime(500);
      expect(requests('talk')).toHaveLength(0);
    });

    it('stays quiet where it is not the tab being listened for', async () => {
      await show({ pushToTalk: true, voice: 'paused' });
      key('keydown', 'ControlLeft');
      vi.advanceTimersByTime(500);
      expect(requests('talk')).toHaveLength(0);
    });
  });

  it('leaves when hands-free ends', async () => {
    await show();
    await deliver({ op: 'hide' });
    vi.advanceTimersByTime(400);
    expect(document.getElementById('browsentic-hands-free')).toBeNull();
  });
});
