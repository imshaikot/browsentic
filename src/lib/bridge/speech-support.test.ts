import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { capableOf, handsFreeAllowed, noteSpeechService, readSpeechService } from './speech-support';

const chrome = [{ brand: 'Chromium' }, { brand: 'Google Chrome' }, { brand: 'Not_A Brand' }];
const brave = [{ brand: 'Brave' }, { brand: 'Chromium' }, { brand: 'Not;A=Brand' }];
const able = { offscreen: true, recognizer: true, brands: chrome };

beforeEach(() => {
  fakeBrowser.reset();
});

describe('capableOf', () => {
  it('allows a Chromium with somewhere to listen from and something to listen with', () => {
    expect(capableOf(able)).toBe(true);
  });

  it('refuses a fork that ships the recognizer with no service behind it', () => {
    expect(capableOf({ ...able, brands: brave })).toBe(false);
  });

  it('refuses a browser with no offscreen document, or no recognizer', () => {
    expect(capableOf({ ...able, offscreen: false })).toBe(false);
    expect(capableOf({ ...able, recognizer: false })).toBe(false);
  });
});

describe('what the speech service has shown', () => {
  it('starts unknown, which still allows hands-free', async () => {
    expect(await readSpeechService()).toBeNull();
    expect(handsFreeAllowed(null, true)).toBe(true);
  });

  it('hides hands-free once the service fails before it ever worked', async () => {
    expect(await noteSpeechService('missing')).toBe('missing');
    expect(handsFreeAllowed(await readSpeechService(), true)).toBe(false);
  });

  it('keeps hands-free once the service has worked, whatever fails later', async () => {
    await noteSpeechService('works');
    expect(await noteSpeechService('missing')).toBe('works');
    expect(handsFreeAllowed(await readSpeechService(), true)).toBe(true);
  });

  it('brings hands-free back when a service thought missing answers after all', async () => {
    await noteSpeechService('missing');
    expect(await noteSpeechService('works')).toBe('works');
  });

  it('never allows it where the browser itself cannot listen', async () => {
    await noteSpeechService('works');
    expect(handsFreeAllowed(await readSpeechService(), false)).toBe(false);
  });
});
