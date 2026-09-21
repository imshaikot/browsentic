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
        instruction: 'what does this page cost',
        systemPrompt: 'You are Browsentic.',
        research,
        settings: settingsFor(kind),
        sessionId: null,
        workspace: stateDir,
        mcp: mcpServerFor('run-1'),
      })
    : RUNNERS[kind].json({ prompt: 'summarize this', settings: settingsFor(kind), workspace: stateDir, reads });

const without = (plan: Plan, arg: string): Plan => ({ ...plan, args: plan.args.filter((value) => value !== arg) });
const plus = (plan: Plan, ...args: string[]): Plan => ({ ...plan, args: [...plan.args, ...args] });
const swapped = (plan: Plan, from: string, to: string): Plan => ({ ...plan, args: plan.args.map((arg) => (arg === from ? to : arg)) });

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

  test('claude task that reads a file is still contained', () => {
    expect(vetPlan('claude', 'task', planOf('claude', 'task', { reads: true }), stateDir)).toEqual([]);
  });

  describe('a one-shot task cannot reach the browser at all', () => {
    test('claude task carries no mcp server', () => {
      expect(planOf('claude', 'task').args).toContain('{"mcpServers":{}}');
    });

    test('codex task carries no mcp server', () => {
      expect(planOf('codex', 'task').args).toContain('mcp_servers={}');
    });

    test('antigravity task writes an empty mcp config', () => {
      const config = planOf('antigravity', 'task').files?.find((file) => file.path === '.agents/mcp_config.json');
      expect(JSON.parse(config?.content ?? 'null')?.mcpServers).toEqual({});
    });
  });

  // Each of these is a plausible refactor that silently removes containment.
  describe('tampering', () => {
    const claudeRun = planOf('claude', 'run');
    const codexRun = planOf('codex', 'run');
    const agyRun = planOf('antigravity', 'run');

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

    test('losing the antigravity mcp config is caught', () => {
      expect(vetPlan('antigravity', 'run', { ...agyRun, files: [] }, stateDir)).toHaveLength(2);
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
    GOOGLE_APPLICATION_CREDENTIALS: '/creds.json',
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
