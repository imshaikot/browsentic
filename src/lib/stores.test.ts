import { describe, expect, test } from 'vitest';
import { sourceOf } from './stores';

describe('sourceOf', () => {
  test('names each store copy by its ID, a Firefox copy by its scheme, and any other Chromium copy unpacked', () => {
    expect(
      [
        'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp',
        'chrome-extension://cbkjhkgjcpihokphhdkbahilpcjojpdc/',
        'moz-extension://0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
        'chrome-extension://pplbfkdfiimmogofmehpibbmldcefgpc',
      ].map(sourceOf),
    ).toEqual(['chrome-web-store', 'edge-add-ons', 'firefox', 'unpacked']);
  });
});
