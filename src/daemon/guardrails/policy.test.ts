import { describe, expect, test } from 'vitest';
import { decide, type Decision } from './decide';
import { CONDITIONS, policyFrom, submitsForm, type Policy } from './policy';
import { ANYWHERE, scopeFor } from './scope';

const scope = scopeFor({ url: 'https://example.com/', tabId: 3, pinTab: true });
const agent = (action: string, input: unknown, policy?: Policy) => decide({ action, input, caller: 'agent', scope }, policy);
const external = (action: string, input: unknown, policy?: Policy) =>
  decide({ action, input, caller: 'external', scope: ANYWHERE }, policy);
const rules = (decision: Decision) => decision.matched.map((rule) => rule.id);
const padding = 'x'.repeat(600);

describe('submitsForm', () => {
  const SUBMITS: [action: string, input: object, want: boolean][] = [
    ['page.submitForm', {}, true],
    ['page.fillInput', { value: 'x', pressEnter: true }, true],
    ['page.fillInput', { value: 'x' }, false],
    ['page.pressKey', { key: 'Enter' }, true],
    ['page.pressKey', { key: 'Escape' }, false],
    ['page.clickElement', { target: { text: 'Place order' } }, false],
  ];
  for (const [action, input, want] of SUBMITS) {
    test(`submitsForm(${action}) with ${JSON.stringify(input)}`, () => {
      expect(submitsForm(action, input)).toBe(want);
    });
  }
});

describe('decisions for a watched run', () => {
  test('in-scope navigation allowed', () => {
    expect(agent('page.navigate', { url: 'https://app.example.com/x' }).effect).toBe('allow');
  });

  test('off-scope navigation confirms', () => {
    expect(agent('page.navigate', { url: 'https://evil.com/x' }).effect).toBe('confirm');
  });

  test('off-scope openTab confirms', () => {
    expect(agent('page.openTab', { url: 'https://evil.com/x' }).effect).toBe('confirm');
  });

  test('relative navigation is not a host decision', () => {
    expect(agent('page.navigate', { url: '/pricing' }).effect).toBe('allow');
  });

  // The page resolves what it is handed against the URL it is already on, so on example.com
  // `//evil.com/x` is the page's own resolver handing the run to evil.com. A path still names
  // no host, because where the tab actually is is not something scope knows.
  test('a protocol-relative navigation is a host decision', () => {
    expect(rules(agent('page.navigate', { url: '//evil.com/x' }))).toEqual(['off-scope-navigation']);
  });

  test('and so is a backslashed one', () => {
    expect(rules(agent('page.navigate', { url: '\\\\evil.com/x' }))).toEqual(['off-scope-navigation']);
  });

  test('and a half-backslashed one', () => {
    expect(agent('page.navigate', { url: '/\\evil.com/x' }).effect).toBe('confirm');
  });

  test('and one hidden behind a control character', () => {
    expect(agent('page.navigate', { url: '\t//evil.com/x' }).effect).toBe('confirm');
  });

  test('and one spliced with a tab mid-path', () => {
    expect(agent('page.navigate', { url: '/\t/evil.com' }).effect).toBe('confirm');
  });

  test('userinfo does not decide the host', () => {
    expect([agent('page.navigate', { url: '//evil.com@example.com/' }).effect, agent('page.navigate', { url: '//example.com@evil.com/' }).effect]).toEqual([
      'allow',
      'confirm',
    ]);
  });

  test('a single backslash is still a path', () => {
    expect(agent('page.navigate', { url: '\\evil.com/x' }).effect).toBe('allow');
  });

  test('the same reference in scope is not gated', () => {
    expect(agent('page.navigate', { url: '//app.example.com/x' }).effect).toBe('allow');
  });

  test('naming the probe buys nothing', () => {
    expect(agent('page.navigate', { url: '//one.probe.invalid/x' }).effect).toBe('confirm');
  });

  test('a relative openTab is judged the same way', () => {
    expect(rules(agent('page.openTab', { url: '//evil.com/x' }))).toEqual(['off-scope-navigation']);
  });

  test('a relative download url too', () => {
    expect(rules(agent('page.captureDownload', { url: '//evil.com/f.csv' }))).toEqual(['off-scope-navigation', 'file-download']);
  });

  test('and still when file-download is turned off', () => {
    expect(rules(agent('page.captureDownload', { url: '//evil.com/f.csv' }, policyFrom({ rules: { 'file-download': 'allow' } })))).toEqual([
      'off-scope-navigation',
    ]);
  });

  // What no parser settles is refused rather than skipped, so the next spelling nobody
  // thought of fails closed instead of silently.
  test('a url with no readable destination is denied', () => {
    expect(rules(agent('page.navigate', { url: '//evil.com%09/x' }))).toEqual(['unreadable-navigation']);
  });

  test('and nothing else has an opinion about it', () => {
    expect(rules(agent('page.navigate', { url: '//' }))).toEqual(['unreadable-navigation']);
  });

  // Bytes leaving the browser are counted whatever the URL's shape, because that rule is about
  // the payload and not about where it lands.
  test('a relative payload counts the same bytes', () => {
    expect(rules(agent('page.navigate', { url: `/pricing?d=${padding}` }))).toEqual(['url-payload']);
  });

  test('a fragment counts too', () => {
    expect(agent('page.navigate', { url: `#d=${padding}` }).effect).toBe('confirm');
  });

  test('a small relative query string is still fine', () => {
    expect(agent('page.navigate', { url: '/search?q=kettle' }).effect).toBe('allow');
  });

  test('an unattended caller cannot smuggle one out', () => {
    expect(external('page.navigate', { url: `//evil.com/log?d=${padding}` }).effect).toBe('deny');
  });

  test('which is what the absolute spelling already said', () => {
    expect(external('page.navigate', { url: `https://evil.com/log?d=${padding}` }).effect).toBe('deny');
  });

  test('history navigation is not a host decision', () => {
    expect(agent('page.navigate', { action: 'back' }).effect).toBe('allow');
  });

  test('javascript: navigation denied', () => {
    expect(agent('page.navigate', { url: 'javascript:alert(1)' }).effect).toBe('deny');
  });

  test('reserved action denied', () => {
    expect(agent('browsentic.saveSiteMap', {}).effect).toBe('deny');
  });

  test('in-scope exfil payload still confirms', () => {
    expect(agent('page.navigate', { url: `https://example.com/?d=${padding}` }).effect).toBe('confirm');
  });

  test('small query string is fine', () => {
    expect(agent('page.navigate', { url: 'https://example.com/?q=kettle' }).effect).toBe('allow');
  });

  test('form submission confirms', () => {
    expect(agent('page.submitForm', {}).effect).toBe('confirm');
  });

  test('enter-to-submit confirms', () => {
    expect(agent('page.fillInput', { value: 'x', pressEnter: true }).effect).toBe('confirm');
  });

  test('file upload confirms', () => {
    expect(agent('page.attachFile', { fileId: 'f1', target: {} }).effect).toBe('confirm');
  });

  test('file download confirms', () => {
    expect(agent('page.captureDownload', { target: { text: 'Export' } }).effect).toBe('confirm');
  });

  test('the download names its rule', () => {
    expect(rules(agent('page.captureDownload', { target: {} }))).toEqual(['file-download']);
  });

  test('an off-scope download url confirms too', () => {
    expect(rules(agent('page.captureDownload', { url: 'https://evil.com/f.csv' }))).toEqual(['off-scope-navigation', 'file-download']);
  });

  test('a signed download url is not a payload', () => {
    expect(rules(agent('page.captureDownload', { url: `https://example.com/f.csv?sig=${padding}` }))).toEqual(['file-download']);
  });

  test('a javascript: download is denied', () => {
    expect(agent('page.captureDownload', { url: 'javascript:alert(1)' }).effect).toBe('deny');
  });

  test('injecting code confirms', () => {
    expect(agent('page.injectCode', { purpose: 'p', code: 'tools.x = () => 1;' }).effect).toBe('confirm');
  });

  test('the injection names its rule', () => {
    expect(rules(agent('page.injectCode', { purpose: 'p', code: 'x' }))).toEqual(['code-injection']);
  });

  test('calling already-approved code is not re-gated', () => {
    expect(agent('page.runCode', { function: 'x', args: [] }).effect).toBe('allow');
  });

  test('switching to another tab confirms', () => {
    expect(agent('page.switchTab', { tabId: 9 }).effect).toBe('confirm');
  });

  test('switching back to the pinned tab is fine', () => {
    expect(agent('page.switchTab', { tabId: 3 }).effect).toBe('allow');
  });

  test('listing tabs is not a move', () => {
    expect(agent('page.switchTab', {}).effect).toBe('allow');
  });

  test('reading text is fine', () => {
    expect(agent('page.extractText', { format: 'text' }).effect).toBe('allow');
  });

  test('deny beats confirm', () => {
    expect(rules(agent('page.navigate', { url: 'javascript:void(0)' }))).toEqual(['non-http-navigation']);
  });

  test('off-scope names its rule', () => {
    expect(rules(agent('page.navigate', { url: 'https://evil.com/x' }))).toEqual(['off-scope-navigation']);
  });
});

// An unscoped external caller cannot be off-scope, but consequential actions still route
// through `unattended`.
describe('decisions for an external caller', () => {
  test('external submit denied by default', () => {
    expect(external('page.submitForm', {}).effect).toBe('deny');
  });

  test('the refusal names its rule', () => {
    expect(rules(external('page.submitForm', {}))).toEqual(['form-submission']);
  });

  test('external upload denied by default', () => {
    expect(external('page.attachFile', { fileId: 'f' }).effect).toBe('deny');
  });

  test('external reads are untouched', () => {
    expect(external('page.extractText', { format: 'text' }).effect).toBe('allow');
  });

  test('external submit waived when unattended=allow', () => {
    expect(external('page.submitForm', {}, policyFrom({ unattended: 'allow' })).effect).toBe('allow');
  });

  test('the waiver is still recorded', () => {
    expect(rules(external('page.submitForm', {}, policyFrom({ unattended: 'allow' })))).toEqual(['form-submission']);
  });

  test('external reserved action denied regardless', () => {
    expect(external('browsentic.saveSiteMap', {}).effect).toBe('deny');
  });

  test('external never returns confirm', () => {
    expect(external('page.attachFile', { fileId: 'f' }, policyFrom({ unattended: 'deny' })).effect).toBe('deny');
  });

  test('external download denied by default', () => {
    expect(external('page.captureDownload', { url: 'https://example.com/f.csv' }).effect).toBe('deny');
  });

  // Nobody to show the code to, so nobody can approve it — and a toolkit a person approved in
  // the panel is not thereby available to an MCP client.
  describe('code', () => {
    test('external code injection denied outright', () => {
      expect(external('page.injectCode', { purpose: 'p', code: 'x' }).effect).toBe('deny');
    });

    test('the injection refusal names its rule', () => {
      expect(rules(external('page.injectCode', { purpose: 'p', code: 'x' }))).toEqual(['external-code-injection']);
    });

    test('external code execution denied outright', () => {
      expect(external('page.runCode', { function: 'x' }).effect).toBe('deny');
    });

    test('the refusal names its rule', () => {
      expect(rules(external('page.runCode', { function: 'x' }))).toEqual(['external-code-execution']);
    });

    test('unattended=allow does not open it', () => {
      expect(external('page.runCode', { function: 'x' }, policyFrom({ unattended: 'allow' })).effect).toBe('deny');
    });

    // `code-injection` only confirms and `unattended: allow` waives a confirm, so installing was
    // once reachable from an MCP client with one line of config — and `call` on
    // page.injectCode made an allowed install an execution too.
    test('unattended=allow does not open injection either', () => {
      expect(external('page.injectCode', { purpose: 'p', code: 'x' }, policyFrom({ unattended: 'allow' })).effect).toBe('deny');
    });

    test('nor does it open an install that calls straight through', () => {
      expect(
        external('page.injectCode', { purpose: 'p', code: 'x', call: { function: 'x', args: [] } }, policyFrom({ unattended: 'allow' })).effect,
      ).toBe('deny');
    });

    test('the panel is unaffected by those rules', () => {
      expect(rules(agent('page.runCode', { function: 'x' }))).toEqual([]);
    });

    test('the panel still only confirms an install', () => {
      expect(rules(agent('page.injectCode', { purpose: 'p', code: 'x' }))).toEqual(['code-injection']);
    });
  });
});

describe('policy overrides', () => {
  const strict = policyFrom({ rules: { 'raw-html-read': 'deny', 'off-scope-navigation': 'deny' } });

  test('raw html denied by default', () => {
    expect(agent('page.extractText', { format: 'html' }).effect).toBe('deny');
  });

  test('raw html denial names its rule', () => {
    expect(rules(agent('page.extractText', { format: 'html' }))).toEqual(['raw-html-read']);
  });

  test('raw html denied for external callers too', () => {
    expect(external('page.extractText', { format: 'html' }).effect).toBe('deny');
  });

  test('rendered text is still the way in', () => {
    expect(agent('page.extractText', { format: 'text' }).effect).toBe('allow');
  });

  test('raw html re-allowable by config', () => {
    expect(agent('page.extractText', { format: 'html' }, policyFrom({ rules: { 'raw-html-read': 'allow' } })).effect).toBe('allow');
  });

  test('raw html stays denied under the strict policy', () => {
    expect(agent('page.extractText', { format: 'html' }, strict).effect).toBe('deny');
  });

  test('off-scope escalates to deny by config', () => {
    expect(agent('page.navigate', { url: 'https://evil.com' }, strict).effect).toBe('deny');
  });

  test('response bodies denied by default', () => {
    expect(agent('page.readNetwork', { includeBodies: true }).effect).toBe('deny');
  });

  test('the body denial names its rule', () => {
    expect(rules(agent('page.readNetwork', { includeBodies: true }))).toEqual(['network-body-read']);
  });

  test('response bodies denied for external callers too', () => {
    expect(external('page.readNetwork', { includeBodies: true }).effect).toBe('deny');
  });

  test('request metadata is still readable', () => {
    expect(agent('page.readNetwork', { includeBodies: false }).effect).toBe('allow');
  });

  test('headers are readable without the body rule firing', () => {
    expect(agent('page.readNetwork', { includeHeaders: true }).effect).toBe('allow');
  });

  test('reading the console is not a network read', () => {
    expect(agent('page.readConsole', {}).effect).toBe('allow');
  });

  test('response bodies re-allowable by config', () => {
    expect(agent('page.readNetwork', { includeBodies: true }, policyFrom({ rules: { 'network-body-read': 'allow' } })).effect).toBe('allow');
  });

  test('legacy requireApproval:[] still ungates forms', () => {
    expect(agent('page.submitForm', {}, policyFrom({}, [])).effect).toBe('allow');
  });

  test('legacy requireApproval gates a listed action', () => {
    expect(agent('page.clickElement', {}, policyFrom({}, ['page.clickElement'])).effect).toBe('confirm');
  });

  test('every rule names a real condition', () => {
    expect(policyFrom().rules.every((rule) => rule.when in CONDITIONS)).toBe(true);
  });

  test('rule ids are unique', () => {
    expect(new Set(policyFrom().rules.map((rule) => rule.id)).size).toBe(policyFrom().rules.length);
  });
});

describe('releasing a secret', () => {
  const TAG = 'a1b2c3d4';
  const real = `⟦password:1@ex.com#${TAG}⟧`;
  const withSecret = { target: { selector: '#pw' }, value: real };

  test('releasing a secret confirms for a watched run', () => {
    expect(agent('page.fillInput', withSecret).effect).toBe('confirm');
  });

  test('and names its rule', () => {
    expect(rules(agent('page.fillInput', withSecret))).toContain('secret-release');
  });

  test('a secret from another site says so', () => {
    expect(rules(agent('page.fillInput', { value: `⟦password:1@mail.other.com#${TAG}⟧` }))).toContain('secret-off-scope');
  });

  test('a secret from the run’s own site does not', () => {
    expect(rules(agent('page.fillInput', { value: `⟦password:1@example.com#${TAG}⟧` }))).not.toContain('secret-off-scope');
  });

  test('a secret in a url is denied outright', () => {
    expect(agent('page.navigate', { url: `https://example.com/?p=${real}` }).effect).toBe('deny');
  });

  test('even on the run’s own site', () => {
    expect(rules(agent('page.navigate', { url: `https://example.com/?p=${real}` }))).toEqual(['secret-in-url']);
  });

  test('however the url is spelled', () => {
    expect([agent('page.navigate', { url: `//evil.com/?p=${real}` }).effect, agent('page.navigate', { url: `/x?p=${real}` }).effect]).toEqual([
      'deny',
      'deny',
    ]);
  });

  test('and it is secret-in-url that says so', () => {
    expect(rules(agent('page.navigate', { url: `/x?p=${real}` }))).toEqual(['secret-in-url']);
  });

  test('an unattended caller cannot release at all', () => {
    expect(external('page.fillInput', withSecret).effect).toBe('deny');
  });

  test('an ordinary fill is untouched', () => {
    expect(agent('page.fillInput', { value: 'kettles' }).effect).toBe('allow');
  });
});
