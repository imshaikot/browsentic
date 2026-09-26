import { describe, expect, it } from 'vitest';
import { captionOf, readingMs, replyOf, sharedWords, spoken, wordsOf } from './caption';

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

  it('leaves identifiers, file names and arithmetic as they were written', () => {
    expect(captionOf('Set `max_retry_count` in config_file_name.json, then 2*3*4 = 24')).toBe(
      'Set max_retry_count in config_file_name.json, then 2*3*4 = 24',
    );
    expect(captionOf('It is _really_ *done* — ~~maybe~~ __surely__.')).toBe('It is really done — maybe surely.');
  });

  it('keeps a year that opens a line, and still drops a numbered list’s markers', () => {
    expect(captionOf('2023. That was the year.')).toBe('2023. That was the year.');
    expect(captionOf('1. Open it\n2) Save it')).toBe('Open it Save it');
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

describe('spoken', () => {
  it('reads an action name the way a person would say it mid-sentence', () => {
    expect(spoken('page.clickElement')).toBe('click element');
    expect(spoken('injectCode')).toBe('inject code');
  });
});

describe('readingMs', () => {
  it('stays between a glance and a paragraph', () => {
    expect(readingMs('ok')).toBe(4_000);
    expect(readingMs('word '.repeat(200))).toBe(16_000);
  });
});
