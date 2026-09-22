import { describe, expect, test } from 'vitest';
import { AGENT_KINDS, AGENTS, type AgentKind } from '@/lib/agents/catalog';
import { mcpServerFor, RUNNERS } from '../agent/runners';
import type { Plan } from '../agent/runners/types';
import { stateDir } from '../lockfile';
import { CONTAINMENT, sealEnv, sealedAway, vetPlan } from './spawn';

const settingsFor = (kind: AgentKind) => ({ bin: AGENTS[kind].bin });

const planOf = (kind: AgentKind, mode: 'run' | 'task', { research = false, reads = false } = {}): Plan =>
  mode === 'run'
    ? RUNNERS[kind].stream({
        runId: 'run-1',
        conversation: 'conversation-1',
        instruction: 'what does this page cost',
        systemPrompt: 'You are Browsentic.',
        research,
        settings: settingsFor(kind),
        sessionId: null,
        workspace: stateDir,
        mcp: mcpServerFor('run-1'),
        mcpTools: ['page_getPageInfo', 'page_clickElement', 'browsentic_status'],
      })
    : RUNNERS[kind].json({ prompt: 'summarize this', settings: settingsFor(kind), workspace: stateDir, reads });

const without = (plan: Plan, arg: string): Plan => ({ ...plan, args: plan.args.filter((value) => value !== arg) });
const plus = (plan: Plan, ...args: string[]): Plan => ({ ...plan, args: [...plan.args, ...args] });
const swapped = (plan: Plan, from: string, to: string): Plan => ({ ...plan, args: plan.args.map((arg) => (arg === from ? to : arg)) });
const vibeConfig = (mode: 'run' | 'task', opts?: { research?: boolean; reads?: boolean }) =>
  planOf('vibe', mode, opts).files?.find((file) => file.path === '.vibe/config.toml')?.content ?? '';

// The page policy governs what a run may do to a page. Containment governs what the CLI the
// daemon spawns may do to the machine, which no `page.*` decision ever sees.
describe('spawn containment', () => {
  for (const kind of AGENT_KINDS) {
    for (const mode of ['run', 'task'] as const) {
      test(`${kind} ${mode} plan is contained`, () => {
        expect(vetPlan(kind, mode, planOf(kind, mode), stateDir)).toEqual([]);
      });
    }
  }

  test('claude run with web tools is still contained', () => {
    expect(vetPlan('claude', 'run', planOf('claude', 'run', { research: true }), stateDir)).toEqual([]);
  });

  test('codex run with web tools is still contained', () => {
    expect(vetPlan('codex', 'run', planOf('codex', 'run', { research: true }), stateDir)).toEqual([]);
  });

  test('vibe run with web tools is still contained', () => {
    expect(vetPlan('vibe', 'run', planOf('vibe', 'run', { research: true }), stateDir)).toEqual([]);
  });

  test('claude task that reads a file is still contained', () => {
    expect(vetPlan('claude', 'task', planOf('claude', 'task', { reads: true }), stateDir)).toEqual([]);
  });

  test('vibe task that reads a file is still contained', () => {
    expect(vetPlan('vibe', 'task', planOf('vibe', 'task', { reads: true }), stateDir)).toEqual([]);
  });

  test('grok run with web tools is still contained', () => {
    expect(vetPlan('grok', 'run', planOf('grok', 'run', { research: true }), stateDir)).toEqual([]);
  });

  test('grok task that reads a file is still contained', () => {
    expect(vetPlan('grok', 'task', planOf('grok', 'task', { reads: true }), stateDir)).toEqual([]);
  });

  describe('a one-shot task cannot reach the browser at all', () => {
    test('claude task carries no mcp server', () => {
      expect(planOf('claude', 'task').args).toContain('{"mcpServers":{}}');
    });

    test('codex task carries no mcp server', () => {
      expect(planOf('codex', 'task').args).toContain('mcp_servers={}');
    });

    test('grok task refuses every MCP call, whichever server the user configured', () => {
      const args = planOf('grok', 'task').args;
      expect(args.flatMap((arg, at) => (arg === '--deny' ? [args[at + 1]] : []))).toContain('MCPTool');
    });

    test('antigravity task writes an empty mcp config', () => {
      const config = planOf('antigravity', 'task').files?.find((file) => file.path === '.agents/mcp_config.json');
      expect(JSON.parse(config?.content ?? 'null')?.mcpServers).toEqual({});
    });

    test('vibe task carries no mcp server', () => {
      expect(vibeConfig('task')).not.toContain('mcp_servers');
    });

    test('vibe task grants no browser tool', () => {
      expect(vibeConfig('task', { reads: true })).not.toContain('browsentic_');
    });
  });

  // Vibe looks a permission up by exact tool name, and headless turns an unanswered ask into a refusal.
  describe('the vibe config grants each browser tool by name', () => {
    test('every mcp tool is granted', () => {
      expect(vibeConfig('run')).toContain('[tools."browsentic_page_clickElement"]');
    });

    test('the run id reaches the mcp server itself', () => {
      expect(vibeConfig('run')).toContain('BROWSENTIC_AGENT_RUN = "run-1"');
    });

    test('a local tool is never granted', () => {
      expect(vibeConfig('run', { research: true })).not.toMatch(/tools\."(bash|read_file|write_file|edit|grep)/);
    });
  });

  // Each of these is a plausible refactor that silently removes containment.
  describe('tampering', () => {
    const claudeRun = planOf('claude', 'run');
    const codexRun = planOf('codex', 'run');
    const agyRun = planOf('antigravity', 'run');
    const grokRun = planOf('grok', 'run');
    const grokTask = planOf('grok', 'task');
    const withEnv = (plan: Plan, name: string, value?: string): Plan => {
      const env = { ...plan.env };
      if (value === undefined) delete env[name];
      else env[name] = value;
      return { ...plan, env };
    };

    test('dropping --strict-mcp-config is caught', () => {
      expect(vetPlan('claude', 'run', without(claudeRun, '--strict-mcp-config'), stateDir)).toHaveLength(1);
    });

    test('dropping --allowedTools is caught', () => {
      expect(vetPlan('claude', 'run', without(claudeRun, '--allowedTools'), stateDir)).toHaveLength(1);
    });

    test('un-denying Bash is caught', () => {
      expect(vetPlan('claude', 'run', without(claudeRun, 'Bash'), stateDir)).toHaveLength(1);
    });

    test('un-denying Read on a browser run is caught', () => {
      expect(vetPlan('claude', 'run', without(claudeRun, 'Read'), stateDir)).toHaveLength(1);
    });

    test('--dangerously-skip-permissions is caught', () => {
      expect(vetPlan('claude', 'run', plus(claudeRun, '--dangerously-skip-permissions'), stateDir)).toHaveLength(1);
    });

    test('losing the codex sandbox is caught', () => {
      expect(vetPlan('codex', 'run', swapped(codexRun, 'sandbox_mode="read-only"', 'sandbox_mode="danger-full-access"'), stateDir)).toHaveLength(2);
    });

    test('--full-auto is caught', () => {
      expect(vetPlan('codex', 'run', plus(codexRun, '--full-auto'), stateDir)).toHaveLength(1);
    });

    test('a writable codex sandbox is caught', () => {
      expect(vetPlan('codex', 'run', swapped(codexRun, 'sandbox_mode="read-only"', 'sandbox_mode="workspace-write"'), stateDir)).toHaveLength(2);
    });

    test('approval prompts turning back on is caught', () => {
      expect(vetPlan('codex', 'run', swapped(codexRun, 'approval_policy="never"', 'approval_policy="on-request"'), stateDir)).toHaveLength(2);
    });

    test('a later override of the codex sandbox is caught', () => {
      expect(vetPlan('codex', 'run', plus(codexRun, '-c', 'sandbox_mode="workspace-write"'), stateDir)).toHaveLength(1);
    });

    const vibeRun = planOf('vibe', 'run');
    const enabling = (plan: Plan, tool: string): Plan => plus(plan, '--enabled-tools', tool);
    const notEnabling: Plan = { ...vibeRun, args: vibeRun.args.filter((arg, at, all) => arg !== '--enabled-tools' && all[at - 1] !== '--enabled-tools') };

    test('switching on the vibe shell is caught', () => {
      expect(vetPlan('vibe', 'run', enabling(vibeRun, 'bash'), stateDir)).toHaveLength(1);
    });

    test('switching on every vibe tool is caught', () => {
      expect(vetPlan('vibe', 'run', enabling(vibeRun, '*'), stateDir)).toHaveLength(1);
    });

    test('dropping the vibe allowlist is caught', () => {
      expect(vetPlan('vibe', 'run', notEnabling, stateDir)).toHaveLength(1);
    });

    test('a vibe task reaching the browser is caught', () => {
      expect(vetPlan('vibe', 'task', enabling(planOf('vibe', 'task'), 'browsentic_*'), stateDir)).toHaveLength(1);
    });

    test('--auto-approve is caught', () => {
      expect(vetPlan('vibe', 'run', plus(vibeRun, '--auto-approve'), stateDir)).toHaveLength(1);
    });

    test('--yolo is caught', () => {
      expect(vetPlan('vibe', 'run', plus(vibeRun, '--yolo'), stateDir)).toHaveLength(1);
    });

    test('another vibe approval profile is caught', () => {
      expect(vetPlan('vibe', 'run', swapped(vibeRun, 'ask', 'auto-approve'), stateDir)).toHaveLength(1);
    });

    test('losing the vibe config is caught', () => {
      expect(vetPlan('vibe', 'run', { ...vibeRun, files: [] }, stateDir)).toHaveLength(2);
    });

    test('losing the antigravity mcp config is caught', () => {
      expect(vetPlan('antigravity', 'run', { ...agyRun, files: [] }, stateDir)).toHaveLength(2);
    });

    test('dropping the grok sandbox is caught', () => {
      expect(vetPlan('grok', 'run', without(without(grokRun, '--sandbox'), 'workspace'), stateDir)).toHaveLength(1);
    });

    test('turning the grok sandbox off with a later flag is caught', () => {
      expect(vetPlan('grok', 'run', plus(grokRun, '--sandbox', 'off'), stateDir)).toHaveLength(1);
    });

    test('--sandbox=off is caught', () => {
      expect(vetPlan('grok', 'run', plus(grokRun, '--sandbox=off'), stateDir)).toHaveLength(1);
    });

    test('approving everything with a later permission mode is caught', () => {
      expect(vetPlan('grok', 'run', plus(grokRun, '--permission-mode', 'bypassPermissions'), stateDir)).toHaveLength(1);
    });

    test('--always-approve is caught', () => {
      expect(vetPlan('grok', 'run', plus(grokRun, '--always-approve'), stateDir)).toHaveLength(1);
    });

    test('dropping the grok tool list is caught', () => {
      expect(vetPlan('grok', 'run', without(without(grokRun, '--tools'), 'todo_write'), stateDir)).toHaveLength(1);
    });

    // An empty list is how Grok spells every tool, the shell and file editing among them.
    test('an empty grok tool list is caught', () => {
      expect(vetPlan('grok', 'run', swapped(grokRun, 'todo_write', ''), stateDir)).toHaveLength(1);
    });

    test('switching the shell on through the grok tool list is caught', () => {
      expect(vetPlan('grok', 'run', swapped(grokRun, 'todo_write', 'todo_write,run_terminal_command'), stateDir)).toHaveLength(1);
    });

    test('un-denying Read on a grok run is caught', () => {
      expect(vetPlan('grok', 'run', without(grokRun, 'Read'), stateDir)).toHaveLength(1);
    });

    test("letting Grok load Claude Code's MCP servers is caught", () => {
      expect(vetPlan('grok', 'run', withEnv(grokRun, 'GROK_CLAUDE_MCPS_ENABLED', 'true'), stateDir)).toHaveLength(1);
    });

    test("leaving Grok's memory on is caught", () => {
      expect(vetPlan('grok', 'run', withEnv(grokRun, 'GROK_MEMORY'), stateDir)).toHaveLength(1);
    });

    test('losing the grok mcp config is caught', () => {
      expect(vetPlan('grok', 'run', { ...grokRun, files: [] }, stateDir)).toHaveLength(1);
    });

    test('a grok task that could reach an MCP server is caught', () => {
      expect(vetPlan('grok', 'task', without(grokTask, 'MCPTool'), stateDir)).toHaveLength(1);
    });

    test('running outside the state dir is caught', () => {
      expect(vetPlan('antigravity', 'run', { ...agyRun, cwd: '/tmp/anywhere' }, stateDir)).toHaveLength(1);
    });

    test('the state dir itself is inside itself', () => {
      expect(vetPlan('claude', 'run', { ...claudeRun, cwd: stateDir }, stateDir)).toEqual([]);
    });

    test('a sibling path is not inside the state dir', () => {
      expect(vetPlan('claude', 'run', { ...claudeRun, cwd: `${stateDir}-evil` }, stateDir)).toHaveLength(1);
    });
  });

  describe('every agent the catalog knows about declares containment', () => {
    for (const kind of AGENT_KINDS) {
      test(`${kind} declares containment`, () => {
        expect(typeof CONTAINMENT[kind]?.localTools).toBe('string');
      });

      test(`${kind} declares how it authenticates`, () => {
        expect(CONTAINMENT[kind].keepsEnv.length).toBeGreaterThan(0);
      });
    }
  });
});

describe('environment sealing', () => {
  const DIRTY: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    LANG: 'en_US.UTF-8',
    SESSIONS_DIR: '/var/sessions',
    AWS_SECRET_ACCESS_KEY: 'aws',
    AWS_PROFILE: 'default',
    GITHUB_TOKEN: 'ghp_x',
    NPM_TOKEN: 'npm_x',
    DATABASE_URL: 'postgres://user:pw@host/db',
    STRIPE_SECRET_KEY: 'sk_x',
    SSH_AUTH_SOCK: '/tmp/ssh',
    MY_APP_PASSWORD: 'hunter2',
    SIGNING_KEY: 'k',
    ANTHROPIC_API_KEY: 'sk-ant',
    OPENAI_API_KEY: 'sk-oai',
    GEMINI_API_KEY: 'sk-gem',
    MISTRAL_API_KEY: 'sk-mis',
    GOOGLE_APPLICATION_CREDENTIALS: '/creds.json',
    XAI_API_KEY: 'xai-key',
  };
  const sealedFor = (kind: AgentKind) => sealEnv(kind, DIRTY);

  const DROPPED: [name: string, label: string][] = [
    ['AWS_SECRET_ACCESS_KEY', 'the AWS key'],
    ['AWS_PROFILE', 'the AWS profile'],
    ['GITHUB_TOKEN', 'the GitHub token'],
    ['NPM_TOKEN', 'the npm token'],
    ['DATABASE_URL', 'the database url'],
    ['STRIPE_SECRET_KEY', 'the stripe key'],
    ['SSH_AUTH_SOCK', 'the ssh agent'],
    ['MY_APP_PASSWORD', 'an app password'],
    ['SIGNING_KEY', 'a signing key'],
  ];

  for (const kind of AGENT_KINDS) {
    describe(kind, () => {
      for (const name of ['PATH', 'HOME', 'LANG']) {
        test(`${kind} keeps ${name}`, () => {
          expect(sealedFor(kind)[name]).toBe(DIRTY[name]);
        });
      }
      for (const [name, label] of DROPPED) {
        test(`${kind} loses ${label}`, () => {
          expect(sealedFor(kind)).not.toHaveProperty(name);
        });
      }
      test(`${kind} keeps a name that only looks secret`, () => {
        expect(sealedFor(kind).SESSIONS_DIR).toBe('/var/sessions');
      });
    });
  }

  describe('each agent keeps its own credentials and loses everyone else’s', () => {
    test('claude keeps its own key', () => {
      expect(sealedFor('claude').ANTHROPIC_API_KEY).toBe('sk-ant');
    });

    test('claude loses the openai key', () => {
      expect(sealedFor('claude')).not.toHaveProperty('OPENAI_API_KEY');
    });

    test('claude loses the gemini key', () => {
      expect(sealedFor('claude')).not.toHaveProperty('GEMINI_API_KEY');
    });

    test('codex keeps its own key', () => {
      expect(sealedFor('codex').OPENAI_API_KEY).toBe('sk-oai');
    });

    test('codex loses the anthropic key', () => {
      expect(sealedFor('codex')).not.toHaveProperty('ANTHROPIC_API_KEY');
    });

    test('antigravity keeps its own key', () => {
      expect(sealedFor('antigravity').GEMINI_API_KEY).toBe('sk-gem');
    });

    test('antigravity keeps its google credentials', () => {
      expect(sealedFor('antigravity').GOOGLE_APPLICATION_CREDENTIALS).toBe('/creds.json');
    });

    test('vibe keeps its own key', () => {
      expect(sealedFor('vibe').MISTRAL_API_KEY).toBe('sk-mis');
    });

    test('vibe loses the anthropic key', () => {
      expect(sealedFor('vibe')).not.toHaveProperty('ANTHROPIC_API_KEY');
    });

    test('claude loses the mistral key', () => {
      expect(sealedFor('claude')).not.toHaveProperty('MISTRAL_API_KEY');
    });

    test('grok keeps its own key', () => {
      expect(sealedFor('grok').XAI_API_KEY).toBe('xai-key');
    });

    test('claude loses the xai key', () => {
      expect(sealedFor('claude')).not.toHaveProperty('XAI_API_KEY');
    });

    test('grok loses the anthropic key', () => {
      expect(sealedFor('grok')).not.toHaveProperty('ANTHROPIC_API_KEY');
    });

    test('claude loses those google credentials', () => {
      expect(sealedFor('claude')).not.toHaveProperty('GOOGLE_APPLICATION_CREDENTIALS');
    });

    test('sealing reports what it dropped', () => {
      expect(sealedAway('claude', DIRTY)).toContain('AWS_SECRET_ACCESS_KEY');
    });

    test('sealing leaves a clean environment alone', () => {
      expect(sealEnv('claude', { PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
    });
  });

  // A federated backend is the agent's own credential, not a stray one. Sealing Bedrock's keys
  // would read as a login failure rather than a policy decision.
  describe('federated backends', () => {
    const bedrock = { ...DIRTY, CLAUDE_CODE_USE_BEDROCK: '1' };
    const vertex = { ...DIRTY, CLAUDE_CODE_USE_VERTEX: 'true', GCLOUD_PROJECT: 'p' };

    test('claude on bedrock keeps its aws credentials', () => {
      expect(sealEnv('claude', bedrock).AWS_SECRET_ACCESS_KEY).toBe('aws');
    });

    test('claude on bedrock still loses the github token', () => {
      expect(sealEnv('claude', bedrock)).not.toHaveProperty('GITHUB_TOKEN');
    });

    test('claude off bedrock loses them again', () => {
      expect(sealEnv('claude', DIRTY)).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    });

    test('the flag has to be truthy', () => {
      expect(sealEnv('claude', { ...DIRTY, CLAUDE_CODE_USE_BEDROCK: '0' })).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    });

    test('an empty flag does not widen', () => {
      expect(sealEnv('claude', { ...DIRTY, CLAUDE_CODE_USE_BEDROCK: '' })).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    });

    test('claude on vertex keeps its google credentials', () => {
      expect(sealEnv('claude', vertex).GOOGLE_APPLICATION_CREDENTIALS).toBe('/creds.json');
    });

    test('claude on vertex keeps the gcloud project', () => {
      expect(sealEnv('claude', vertex).GCLOUD_PROJECT).toBe('p');
    });

    test('another agent does not inherit the claude flag', () => {
      expect(sealEnv('codex', bedrock)).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    });

    test('codex keeps its azure credentials', () => {
      expect(sealEnv('codex', { ...DIRTY, AZURE_OPENAI_API_KEY: 'az' }).AZURE_OPENAI_API_KEY).toBe('az');
    });

    test('claude does not keep azure openai', () => {
      expect(sealEnv('claude', { ...DIRTY, AZURE_OPENAI_API_KEY: 'az' })).not.toHaveProperty('AZURE_OPENAI_API_KEY');
    });
  });
});
