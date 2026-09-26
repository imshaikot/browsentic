import { describe, expect, it } from 'vitest';
import { captionOf, readingMs, replyOf, sharedWords, wordsOf } from './caption';

describe('sharedWords', () => {
  it('keeps the words a revised reading did not change', () => {
    expect(sharedWords(wordsOf('open the first'), wordsOf('open the first result'))).toBe(3);
    expect(sharedWords(wordsOf('open the fist'), wordsOf('open the first result'))).toBe(2);
    expect(sharedWords([], wordsOf('hello'))).toBe(0);
  });
});

describe('captionOf', () => {
  it('reads markdown as plain text', () => {
    expect(captionOf('## Done\n\n- **Saved** the [draft](https://x.test) as `v2`')).toBe('Done Saved the draft as v2');
  });

  it('drops code blocks entirely', () => {
    expect(captionOf('Ran it:\n```js\nconsole.log(1)\n```\nAll good.')).toBe('Ran it: All good.');
  });

  it('cuts a long reply at a word, with an ellipsis', () => {
    const caption = captionOf('word '.repeat(100), 40);
    expect(caption.endsWith('word…')).toBe(true);
    expect(caption.length).toBeLessThanOrEqual(41);
  });
});

describe('replyOf', () => {
  const user = (text: string) => ({ kind: 'user' as const, id: text, text });
  const said = (text: string) => ({ kind: 'assistant' as const, id: text, text });
  const failed = (text: string) => ({ kind: 'notice' as const, id: text, tone: 'error' as const, text });
  const tool = { kind: 'tool' as const, id: 't', action: 'page.clickElement', input: {}, ok: true };

  it('reads the latest reply of the turn', () => {
    expect(replyOf([user('go'), said('Opening it'), tool, said('**Done** — signed in.')])).toEqual({
      text: 'Done — signed in.',
      tone: 'reply',
    });
  });

  it('reads an error without its code', () => {
    expect(replyOf([user('go'), said('Trying'), failed('CANCELLED: The tab was closed, so that run is over.')])).toEqual({
      text: 'The tab was closed, so that run is over.',
      tone: 'error',
    });
  });

  it('never reaches back into an earlier turn', () => {
    expect(replyOf([user('one'), said('First answer'), user('two'), tool])).toBeNull();
  });
});

describe('readingMs', () => {
  it('stays between a glance and a paragraph', () => {
    expect(readingMs('ok')).toBe(4_000);
    expect(readingMs('word '.repeat(200))).toBe(16_000);
  });
});
