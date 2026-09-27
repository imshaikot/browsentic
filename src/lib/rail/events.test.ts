import { describe, expect, test } from 'vitest';
import { PANEL_TABS, RAIL_TABS, isPanelTab } from './events';

describe('the panel’s tabs', () => {
  test('a Settings tab stored before it moved to its own page is not one, so the panel opens on Chat', () => {
    expect([isPanelTab('settings'), isPanelTab(undefined), isPanelTab('tasks')]).toEqual([false, false, true]);
  });

  test('the rail on the page offers exactly the panel’s tabs, in the same order', () => {
    expect(RAIL_TABS.map(({ id }) => id)).toEqual([...PANEL_TABS]);
  });
});
