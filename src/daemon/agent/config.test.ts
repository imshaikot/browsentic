import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  activeAgent,
  configPath,
  maxConcurrentRuns,
  readAgentConfig,
  rememberExtensionDir,
  siteMapSettings,
  writeActiveAgent,
  writeAgentModel,
  writeGuardrailSetting,
  type AgentConfig,
} from './config';

const store = (value: unknown) => {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, typeof value === 'string' ? value : JSON.stringify(value));
};
const stored = () => JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;

beforeEach(() => {
  rmSync(configPath, { force: true });
});

const DEFAULTS: AgentConfig = {
  agent: 'claude',
  agents: { claude: { bin: 'claude', model: 'claude-sonnet-5' }, codex: { bin: 'codex' }, antigravity: { bin: 'agy' }, vibe: { bin: 'vibe' } },
  requireApproval: ['page.submitForm'],
};

describe('reading config.json', () => {
  test('with no file, Claude Code runs on its default model and form submissions need approval', () => {
    expect(readAgentConfig()).toEqual(DEFAULTS);
  });

  test('a corrupt file reads as the defaults rather than stopping the daemon', () => {
    store('{"agent": "codex",');
    expect(readAgentConfig()).toEqual(DEFAULTS);
  });

  test('a file that is not an object reads as the defaults', () => {
    store('null');
    expect(readAgentConfig()).toEqual(DEFAULTS);
  });

  test('an agent the daemon does not know falls back to the default', () => {
    store({ agent: 'gpt-desktop' });
    expect(readAgentConfig().agent).toBe('claude');
  });

  test("each agent's settings are read, trimmed, with blanks ignored", () => {
    store({ agent: 'codex', agents: { codex: { bin: ' /opt/bin/codex ', model: 'gpt-5.4', effort: '  ' } } });
    expect(activeAgent(readAgentConfig())).toEqual({ kind: 'codex', bin: '/opt/bin/codex', model: 'gpt-5.4', effort: undefined });
  });

  test("the pre-0.2 top-level keys are still read as Claude Code's settings", () => {
    store({ claudeBin: '/usr/local/bin/claude', model: 'claude-opus-5', effort: 'high' });
    expect(readAgentConfig().agents.claude).toEqual({ bin: '/usr/local/bin/claude', model: 'claude-opus-5', effort: 'high' });
  });

  test('the per-agent spelling wins over the old one', () => {
    store({ model: 'claude-opus-5', agents: { claude: { model: 'claude-haiku-4-5' } } });
    expect(readAgentConfig().agents.claude.model).toBe('claude-haiku-4-5');
  });

  test('keys the daemon does not model are carried through', () => {
    store({ screenshotDir: '~/Pictures', downloadTtlDays: 3, requireApproval: [] });
    expect(readAgentConfig()).toMatchObject({ screenshotDir: '~/Pictures', downloadTtlDays: 3, requireApproval: [] });
  });
});

describe('limits', () => {
  const config = (extra: Partial<AgentConfig>): AgentConfig => ({ ...readAgentConfig(), ...extra });

  test('three tab sessions may run at once unless configured, and never more than eight', () => {
    expect([undefined, 0, -2, Number.NaN, 5, 5.9, 50].map((value) => maxConcurrentRuns(config({ maxConcurrentRuns: value })))).toEqual([3, 3, 3, 3, 5, 5, 8]);
  });

  test('a mapping run researches, does not click, and keeps to its budgets by default', () => {
    expect(siteMapSettings(config({}))).toEqual({ research: true, allowClicks: false, maxPages: 15, maxScreenshots: 10, timeoutMs: 600_000 });
  });

  test("a mapping run's settings are taken, and its budgets capped", () => {
    expect(siteMapSettings(config({ siteMap: { research: false, allowClicks: true, maxPages: 100, maxScreenshots: 4, timeoutMs: 3_600_000 } }))).toEqual({
      research: false,
      allowClicks: true,
      maxPages: 40,
      maxScreenshots: 4,
      timeoutMs: 1_800_000,
    });
  });
});

describe('writing config.json', () => {
  test('switching agents changes that one key and leaves everything else as it was written', () => {
    store({ agents: { claude: { bin: 'claude' } }, custom: { keep: true } });
    writeActiveAgent('antigravity');
    expect(stored()).toEqual({ agents: { claude: { bin: 'claude' } }, custom: { keep: true }, agent: 'antigravity' });
  });

  test('the file is written readable only by the user', () => {
    writeActiveAgent('codex');
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  test("setting a model writes only that agent's model", () => {
    store({ agents: { codex: { bin: '/opt/codex' } } });
    writeAgentModel('codex', ' gpt-5.4 ');
    expect(stored()).toEqual({ agents: { codex: { bin: '/opt/codex', model: 'gpt-5.4' } } });
  });

  test('clearing the only setting an agent had removes its entry, and an empty agents key with it', () => {
    store({ agents: { codex: { model: 'gpt-5.4' } }, agent: 'codex' });
    writeAgentModel('codex', null);
    expect(stored()).toEqual({ agent: 'codex' });
  });

  test("clearing Claude Code's model also removes the pre-0.2 spelling, so it cannot come back", () => {
    store({ model: 'claude-opus-5', agents: { claude: { model: 'claude-opus-5' } } });
    writeAgentModel('claude', '');
    expect([stored(), readAgentConfig().agents.claude.model]).toEqual([{}, 'claude-sonnet-5']);
  });

  describe('guardrail overrides', () => {
    test('the fence can be turned off and back to the default', () => {
      writeGuardrailSetting('fence', false);
      const off = stored();
      writeGuardrailSetting('fence', null);
      expect([off, stored()]).toEqual([{ guardrails: { fence: false } }, {}]);
    });

    test('unattended confirms can be allowed, and anything else denies', () => {
      writeGuardrailSetting('unattended', 'allow');
      const allowed = stored();
      writeGuardrailSetting('unattended', 'sometimes' as never);
      expect([allowed, stored()]).toEqual([{ guardrails: { unattended: 'allow' } }, { guardrails: { unattended: 'deny' } }]);
    });

    test('a rule override is written under its id, and removing the last one removes the section', () => {
      writeGuardrailSetting('form-submission', 'allow');
      writeGuardrailSetting('file-upload', 'deny');
      const both = stored();
      writeGuardrailSetting('form-submission', null);
      writeGuardrailSetting('file-upload', null);
      expect([both, stored()]).toEqual([{ guardrails: { rules: { 'form-submission': 'allow', 'file-upload': 'deny' } } }, {}]);
    });
  });

  test('where setup --dir put the extension is remembered, and forgotten when it goes back to the default', () => {
    rememberExtensionDir('/var/flatpak/browsentic');
    const remembered = stored();
    rememberExtensionDir(undefined);
    expect([remembered, stored()]).toEqual([{ extensionDir: '/var/flatpak/browsentic' }, {}]);
  });
});
