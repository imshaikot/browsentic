import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STOPPED_REPLY, answerNativeMessage, callerOf, decodeNativeMessage, encodeNativeMessage } from './native-messaging';

describe('the message frame', () => {
  it('round-trips a message and waits for a whole one', () => {
    const frame = encodeNativeMessage({ op: 'ensure' });
    expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
    expect(decodeNativeMessage(frame)).toEqual({ op: 'ensure' });
    expect(decodeNativeMessage(frame.subarray(0, frame.length - 1))).toBeUndefined();
  });
});

describe('callerOf', () => {
  const origin = 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/';

  it('reads the origin Chromium passes, wherever it sits, past --parent-window on Windows', () => {
    expect(callerOf([origin])).toEqual({ family: 'chromium', origin });
    expect(callerOf(['--parent-window=0', origin])).toEqual({ family: 'chromium', origin });
    expect(callerOf([origin.slice(0, -1)])).toEqual({ family: 'chromium', origin });
  });

  it('reads the add-on id Firefox passes after the manifest path', () => {
    expect(callerOf(['/Users/me/Library/Application Support/Mozilla/NativeMessagingHosts/x.json', 'browsentic@browsentic.com'])).toEqual({
      family: 'firefox',
      addonId: 'browsentic@browsentic.com',
    });
  });

  it('names nobody it cannot recognise', () => {
    expect(callerOf([])).toBeNull();
    expect(callerOf(['chrome-extension://not-an-id/'])).toBeNull();
    expect(callerOf(['someone@else.com'])).toBeNull();
  });
});

describe('answering ensure', () => {
  const ensure = vi.fn(async () => ({ port: 8765 }));
  const context = (held = false) => ({ ensure, held: () => held });

  beforeEach(() => ensure.mockClear());

  it('starts the daemon when asked, saying who asked', async () => {
    const caller = { family: 'firefox', addonId: 'browsentic@browsentic.com' } as const;
    expect(await answerNativeMessage({ op: 'ensure' }, context(), caller)).toEqual({ ok: true, port: 8765 });
    expect(ensure).toHaveBeenCalledWith(caller);
  });

  it('leaves a daemon stopped on purpose down', async () => {
    expect(await answerNativeMessage({ op: 'ensure' }, context(true))).toBe(STOPPED_REPLY);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('refuses anything it does not know, in the words shipped extensions read', async () => {
    expect(await answerNativeMessage({ op: 'spawn' }, context())).toEqual({ ok: false, error: 'Expected {"op":"ensure"}.' });
    expect(ensure).not.toHaveBeenCalled();
  });
});
