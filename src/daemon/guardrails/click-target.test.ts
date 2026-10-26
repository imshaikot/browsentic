import { describe, expect, test } from 'vitest';
import { failure, success } from '@/lib/actions/protocol';
import { PROBE_ACTION, readClickTarget, UNREAD } from './click-target';

describe('reading the target of a click', () => {
  test('asks the page, and passes on only the target and the point', async () => {
    const asked: unknown[][] = [];
    const target = await readClickTarget(
      async (action, input) => {
        asked.push([action, input]);
        return success({ submits: true, text: 'Send' });
      },
      'page.trustedClick',
      { target: { text: 'Send' }, button: 'left', holdMs: 50 },
    );
    expect(target).toEqual({ submits: true, text: 'Send' });
    expect(asked).toEqual([[PROBE_ACTION, { target: { text: 'Send' }, point: undefined }]]);
  });

  test('leaves other actions alone and does not ask', async () => {
    let asked = 0;
    const probe = async () => (asked++, success({ submits: true }));
    expect(await readClickTarget(probe, 'page.hoverElement', {})).toBeUndefined();
    expect(asked).toBe(0);
  });

  test('a failed probe leaves the target unread', async () => {
    expect(await readClickTarget(async () => failure('UNKNOWN_ACTION', 'old extension'), 'page.clickElement', {})).toEqual(UNREAD);
  });

  test('a probe that throws leaves the target unread', async () => {
    expect(
      await readClickTarget(
        async () => {
          throw new Error('socket closed');
        },
        'page.clickElement',
        {},
      ),
    ).toEqual(UNREAD);
  });

  test('an answer of the wrong shape leaves the target unread', async () => {
    expect(await readClickTarget(async () => success({ text: 'Send' }), 'page.clickElement', {})).toEqual(UNREAD);
    expect(await readClickTarget(async () => success(null), 'page.clickElement', {})).toEqual(UNREAD);
  });
});
