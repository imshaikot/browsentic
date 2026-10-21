import { join, posix, win32 } from 'node:path';
import { describe, expect, test } from 'vitest';
import { AGENT_KINDS, AGENTS, type AgentKind } from '@/lib/agents/catalog';
import { mcpServerFor, RUNNERS } from '../agent/runners';
import type { Plan, StreamContext } from '../agent/runners/types';
import { stateDir } from '../lockfile';
import { CONTAINMENT, sealEnv, sealedAway, vetPlan, within, type SpawnMode } from './spawn';

const settingsFor = (kind: AgentKind) => ({ bin: AGENTS[kind].bin });

const contextFor = (kind: AgentKind, research: boolean, version?: string): StreamContext => ({
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
  tools: () => Promise.reject(new Error('no browser tools in a containment test')),
  toolsListed: () => Promise.resolve(),
  version,
});

const planOf = (kind: AgentKind, mode: SpawnMode, { research = false, reads = false, version = undefined as string | undefined } = {}): Plan => {
  if (mode === 'task') return RUNNERS[kind].json({ prompt: 'summarize this', settings: settingsFor(kind), version, workspace: stateDir, reads });
  const context = contextFor(kind, research, version);
  if (mode === 'run') return RUNNERS[kind].stream(context);
  const conversation = RUNNERS[kind].converse?.(context);
  if (!conversation) throw new Error(`${kind} holds no conversation`);
  return conversation.plan;
};

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

    // Measured against 0.155.1: `mcp_servers={}` merges into config.toml and clears nothing.
    test('codex task leaves the user config, and every mcp server in it, out', () => {
      expect(planOf('codex', 'task').args).toContain('--ignore-user-config');
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
    const cursorRun = planOf('cursor', 'run');
    const cursorTask = planOf('cursor', 'task');
    const qwenRun = planOf('qwen', 'run');
    const qwenTask = planOf('qwen', 'task');
    const rewriting = (plan: Plan, path: string, edit: (content: string) => string): Plan => ({
      ...plan,
      files: plan.files?.map((file) => (file.path === path ? { ...file, content: edit(file.content) } : file)),
    });
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

    test("a codex run that reads the user's config.toml is caught, and so is a profile layering one back on", () => {
      const reading: Plan = { ...codexRun, args: codexRun.args.filter((arg) => arg !== '--ignore-user-config') };
      expect([vetPlan('codex', 'run', reading, stateDir), vetPlan('codex', 'run', plus(codexRun, '--profile', 'work'), stateDir)].map((problems) => problems.length)).toEqual([1, 1]);
    });

    // Held over stdin, Codex takes its tools in-process; the argv is what can still be vetted.
    test('a codex conversation is contained, and one without its switches, or from any other agent, is refused', () => {
      const held = planOf('codex', 'conversation');
      const shell = { ...held, args: held.args.filter((arg) => arg !== 'features.shell_tool=false') };
      expect({
        held: vetPlan('codex', 'conversation', held, stateDir),
        shell: vetPlan('codex', 'conversation', shell, stateDir).length,
        enabled: vetPlan('codex', 'conversation', plus(held, '--enable', 'shell_tool'), stateDir).length,
        claude: vetPlan('claude', 'conversation', planOf('claude', 'run'), stateDir),
      }).toEqual({ held: [], shell: 1, enabled: 1, claude: ['Claude Code (conversation) has no containment written for it.'] });
    });

    test('the codex shell or image viewer switched back on is caught, however it is spelled', () => {
      expect(
        [
          plus(codexRun, '-c', 'features.shell_tool=true'),
          plus(codexRun, '--enable', 'shell_tool'),
          plus(codexRun, '-c', 'features.view_image=true'),
          { ...codexRun, args: codexRun.args.filter((arg) => arg !== 'features.shell_tool=false') },
        ].map((plan) => vetPlan('codex', 'run', plan, stateDir).length),
      ).toEqual([1, 1, 1, 1]);
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

    test('dropping the cursor sandbox flag is caught', () => {
      expect(vetPlan('cursor', 'run', without(without(cursorRun, '--sandbox'), 'enabled'), stateDir)).toHaveLength(1);
    });

    test('turning the cursor sandbox off with a later flag is caught', () => {
      expect(vetPlan('cursor', 'run', plus(cursorRun, '--sandbox', 'disabled'), stateDir)).toHaveLength(1);
    });

    test('--force, which Cursor also spells --yolo, is caught', () => {
      expect(vetPlan('cursor', 'run', plus(cursorRun, '--force'), stateDir)).toHaveLength(1);
      expect(vetPlan('cursor', 'run', plus(cursorRun, '-f'), stateDir)).toHaveLength(1);
    });

    // Both Cursor and Vibe require --trust, which is why it can never join the global list:
    // headless Cursor refuses to start in a folder nobody trusted, and the folder is ours.
    test('dropping --trust is caught on both the CLIs that need it', () => {
      expect(vetPlan('cursor', 'run', without(cursorRun, '--trust'), stateDir)).toHaveLength(1);
      expect(vetPlan('vibe', 'run', without(vibeRun, '--trust'), stateDir)).toHaveLength(1);
    });

    test('approving every MCP server the user configured is caught', () => {
      expect(vetPlan('cursor', 'run', plus(cursorRun, '--approve-mcps'), stateDir)).toHaveLength(1);
    });

    test('handing the decision to the auto-review classifier is caught', () => {
      expect(vetPlan('cursor', 'run', plus(cursorRun, '--auto-review'), stateDir)).toHaveLength(1);
    });

    // The file is the containment, so an emptied deny list has to fail even though the path is there.
    test('emptying the cursor deny list is caught, though the file is still written', () => {
      const gutted = rewriting(cursorRun, '.cursor/cli.json', () => JSON.stringify({ permissions: { allow: [], deny: [] } }));
      expect(vetPlan('cursor', 'run', gutted, stateDir)).toHaveLength(1);
    });

    test('un-denying the shell in the cursor config is caught', () => {
      const shelled = rewriting(cursorRun, '.cursor/cli.json', (content) => content.replace('"Shell(*)"', '"Shell(ls)"'));
      expect(vetPlan('cursor', 'run', shelled, stateDir)).toHaveLength(1);
    });

    test('a writable cursor sandbox profile is caught', () => {
      const writable = rewriting(cursorRun, '.cursor/sandbox.json', (content) =>
        content.replace('workspace_readonly', 'workspace_readwrite'),
      );
      expect(vetPlan('cursor', 'run', writable, stateDir)).toHaveLength(1);
    });

    test('a cursor task that could reach an MCP server is caught', () => {
      const opened = rewriting(cursorTask, '.cursor/cli.json', (content) => content.replace('"Mcp(*)"', '"Mcp(browsentic:*)"'));
      expect(vetPlan('cursor', 'task', opened, stateDir)).toHaveLength(1);
    });

    test("letting a plugin's MCP server answer a cursor run is caught", () => {
      const opened = rewriting(cursorRun, '.cursor/cli.json', (content) => content.replace('"Mcp(plugin-*:*)"', '"Mcp(plugin-acme-*:*)"'));
      expect(vetPlan('cursor', 'run', opened, stateDir)).toHaveLength(1);
    });

    test('a cursor run may approve its own MCP server first, and nothing else', () => {
      const approving = (prepare: string[][]) => vetPlan('cursor', 'run', { ...cursorRun, prepare }, stateDir);
      expect([
        approving([['mcp', 'enable', 'browsentic']]),
        approving([['mcp', 'enable', 'linear']]),
        approving([['mcp', 'enable', 'browsentic', '--all']]),
        approving([['mcp', 'enable', 'browsentic'], ['mcp', 'login', 'browsentic']]),
      ].map((problems) => problems.length)).toEqual([0, 1, 1, 1]);
    });

    test('a set-up step is refused for a task, and for every agent that has none', () => {
      const prepare = [['mcp', 'enable', 'browsentic']];
      expect([
        vetPlan('cursor', 'task', { ...cursorTask, prepare }, stateDir),
        vetPlan('claude', 'run', { ...planOf('claude', 'run'), prepare }, stateDir),
      ].map((problems) => problems.length)).toEqual([1, 1]);
    });

    // Without --safe-mode the user's own MCP servers, hooks, extensions and permission rules load
    // beside the ones Browsentic passed, and their own browsentic entry reaches the browser ungated.
    test('dropping --safe-mode is caught on both qwen modes', () => {
      expect(vetPlan('qwen', 'run', without(qwenRun, '--safe-mode'), stateDir)).toHaveLength(1);
      expect(vetPlan('qwen', 'task', without(qwenTask, '--safe-mode'), stateDir)).toHaveLength(1);
    });

    test('--bare, which reads like --safe-mode but un-denies the shell, is caught', () => {
      expect(vetPlan('qwen', 'run', plus(qwenRun, '--bare'), stateDir)).toHaveLength(1);
    });

    test('--yolo and its -y alias are caught', () => {
      expect(vetPlan('qwen', 'run', plus(qwenRun, '--yolo'), stateDir)).toHaveLength(1);
      expect(vetPlan('qwen', 'run', plus(qwenRun, '-y'), stateDir)).toHaveLength(1);
    });

    test('skipping TLS verification is caught', () => {
      expect(vetPlan('qwen', 'run', plus(qwenRun, '--insecure'), stateDir)).toHaveLength(1);
    });

    // The classifier mode approves what the deny list exists to refuse, and the inline spelling
    // would slip past a check that only reads the value after the flag.
    test('a later approval mode, in either spelling, is caught', () => {
      expect(vetPlan('qwen', 'run', plus(qwenRun, '--approval-mode', 'auto'), stateDir)).toHaveLength(1);
      expect(vetPlan('qwen', 'run', plus(qwenRun, '--approval-mode=auto'), stateDir)).toHaveLength(1);
      expect(vetPlan('qwen', 'run', plus(qwenRun, '--approval-mode=yolo'), stateDir)).toHaveLength(1);
    });

    test('a second MCP server named for qwen is caught', () => {
      expect(vetPlan('qwen', 'run', plus(qwenRun, '--allowed-mcp-server-names', 'node-repl'), stateDir)).toHaveLength(1);
    });

    // Qwen ships bundled browser-use and computer-use skills, so `skill` is a second browser and
    // an unasked npm install, not a convenience.
    test('un-denying the shell, the sub-agent or the skill tool is caught', () => {
      expect(vetPlan('qwen', 'run', without(qwenRun, 'Bash'), stateDir)).toHaveLength(1);
      expect(vetPlan('qwen', 'run', without(qwenRun, 'agent'), stateDir)).toHaveLength(1);
      expect(vetPlan('qwen', 'run', without(qwenRun, 'skill'), stateDir)).toHaveLength(1);
    });

    test('a qwen run that could read the disk is caught', () => {
      expect(vetPlan('qwen', 'run', without(qwenRun, 'Read'), stateDir)).toHaveLength(1);
    });

    test('a qwen task that could reach an MCP server is caught', () => {
      expect(vetPlan('qwen', 'task', swapped(qwenTask, '{"mcpServers":{}}', '{"mcpServers":{"browsentic":{}}}'), stateDir)).toHaveLength(1);
    });

    test('a qwen run with web tools, or a task that reads a file, is still contained', () => {
      expect(vetPlan('qwen', 'run', planOf('qwen', 'run', { research: true }), stateDir)).toEqual([]);
      expect(vetPlan('qwen', 'task', planOf('qwen', 'task', { reads: true }), stateDir)).toEqual([]);
    });

    const opencodeRun = planOf('opencode', 'run');
    const opencodeTask = planOf('opencode', 'task');
    const reconfigured = (plan: Plan, edit: (config: Record<string, unknown>) => void): Plan => {
      const config = JSON.parse(plan.env?.OPENCODE_CONFIG_CONTENT ?? '{}') as Record<string, unknown>;
      edit(config);
      return withEnv(plan, 'OPENCODE_CONFIG_CONTENT', JSON.stringify(config));
    };
    const rules = (config: Record<string, unknown>) =>
      (config.agent as Record<string, { permission: Record<string, unknown> }>)['browsentic-contained'].permission;

    test('an opencode run with web tools, or a task that reads a file, is still contained', () => {
      expect(vetPlan('opencode', 'run', planOf('opencode', 'run', { research: true }), stateDir)).toEqual([]);
      expect(vetPlan('opencode', 'task', planOf('opencode', 'task', { reads: true }), stateDir)).toEqual([]);
    });

    // Plugins run inside OpenCode, so one can add a tool or answer a permission prompt itself.
    test('dropping --pure is caught on both opencode modes', () => {
      expect(vetPlan('opencode', 'run', without(opencodeRun, '--pure'), stateDir)).toHaveLength(1);
      expect(vetPlan('opencode', 'task', without(opencodeTask, '--pure'), stateDir)).toHaveLength(1);
    });

    test('running as another agent, the user’s own build agent among them, is caught', () => {
      expect(vetPlan('opencode', 'run', plus(opencodeRun, '--agent', 'build'), stateDir)).toHaveLength(1);
      expect(vetPlan('opencode', 'run', swapped(opencodeRun, 'browsentic-contained', 'browsentic'), stateDir)).toHaveLength(1);
    });

    test('a ruleset that no longer opens on a deny is caught', () => {
      const open = reconfigured(opencodeRun, (config) => void (rules(config)['*'] = 'allow'));
      expect(vetPlan('opencode', 'run', open, stateDir)).toHaveLength(1);
    });

    test('a config that lost its ruleset altogether is caught', () => {
      expect(vetPlan('opencode', 'run', withEnv(opencodeRun, 'OPENCODE_CONFIG_CONTENT'), stateDir)).toHaveLength(1);
    });

    test('sharing turned back on, in the config or the environment, is caught', () => {
      expect(vetPlan('opencode', 'run', reconfigured(opencodeRun, (config) => void (config.share = 'auto')), stateDir)).toHaveLength(1);
      expect(vetPlan('opencode', 'run', withEnv(opencodeRun, 'OPENCODE_DISABLE_SHARE'), stateDir)).toHaveLength(1);
    });

    test('loading project config from above the workspace is caught', () => {
      expect(vetPlan('opencode', 'run', withEnv(opencodeRun, 'OPENCODE_DISABLE_PROJECT_CONFIG', '0'), stateDir)).toHaveLength(1);
    });

    test('--auto, which approves whatever was not denied, is caught', () => {
      expect(vetPlan('opencode', 'run', plus(opencodeRun, '--auto'), stateDir)).toHaveLength(1);
    });

    test('a turn sent to a running server, another folder, or a public share is caught', () => {
      expect(vetPlan('opencode', 'run', plus(opencodeRun, '--attach', 'http://localhost:4096'), stateDir)).toHaveLength(1);
      expect(vetPlan('opencode', 'run', plus(opencodeRun, '--dir=/'), stateDir)).toHaveLength(1);
      expect(vetPlan('opencode', 'run', plus(opencodeRun, '--share'), stateDir)).toHaveLength(1);
    });

    test('an opencode task handed an MCP server is caught', () => {
      const reaching = reconfigured(opencodeTask, (config) => void (config.mcp = { browsentic: { type: 'local' } }));
      expect(vetPlan('opencode', 'task', reaching, stateDir)).toHaveLength(1);
    });

    test('losing the opencode instructions file is caught', () => {
      expect(vetPlan('opencode', 'run', { ...opencodeRun, files: [] }, stateDir)).toHaveLength(1);
    });

    describe('OpenCode 2', () => {
      const version = 'opencode v2.0.32';
      const turn = planOf('opencode', 'conversation', { version });
      const fallback = planOf('opencode', 'run', { version });
      const oneShot = planOf('opencode', 'task', { version });
      interface Statement {
        action: string;
        resource: string;
        effect: string;
      }
      const agentRules = (config: Record<string, unknown>) =>
        (config.agents as Record<string, { permissions: Statement[] }>)['browsentic-contained'].permissions;

      test('its turn, the plain run it falls back to, and its one-shots are contained, on research and reading a file too', () => {
        for (const [mode, plan] of [
          ['conversation', turn],
          ['conversation', planOf('opencode', 'conversation', { version, research: true })],
          ['run', fallback],
          ['task', oneShot],
          ['task', planOf('opencode', 'task', { version, reads: true })],
        ] as const) {
          expect(vetPlan('opencode', mode, plan, stateDir)).toEqual([]);
        }
      });

      // Without it, `run` hands the turn to the user's background service, which starts with this environment if it is not running.
      test('a run without its own server is caught', () => {
        expect(vetPlan('opencode', 'run', without(fallback, '--standalone'), stateDir)).not.toEqual([]);
        expect(vetPlan('opencode', 'task', without(oneShot, '--standalone'), stateDir)).not.toEqual([]);
      });

      test('a turn whose folder is not the one OpenCode moves to is caught', () => {
        expect(vetPlan('opencode', 'conversation', withEnv(turn, 'PWD', '/'), stateDir)).toHaveLength(1);
        expect(vetPlan('opencode', 'task', withEnv(oneShot, 'PWD'), stateDir)).toHaveLength(1);
      });

      // A list keeps the deny-all where it was, so only reading the rules shows a later allow.
      test('an allow added after the deny-all, or a deny-all that went, is caught', () => {
        const shell = reconfigured(turn, (config) => void agentRules(config).push({ action: 'shell', resource: '*', effect: 'allow' }));
        expect(vetPlan('opencode', 'conversation', shell, stateDir)).toEqual([expect.stringContaining('allow shell')]);
        expect(vetPlan('opencode', 'conversation', reconfigured(turn, (config) => void agentRules(config).shift()), stateDir)).not.toEqual([]);
      });

      test('a one-shot reading anything but its scratch folder is caught', () => {
        const reads = planOf('opencode', 'task', { version, reads: true });
        const everywhere = reconfigured(reads, (config) => void (agentRules(config)[1].resource = '*'));
        expect(vetPlan('opencode', 'task', everywhere, stateDir)).toHaveLength(1);
      });

      // Code Mode lists one `execute` tool in place of the server's, and it runs a script with the network.
      test("browser tools behind Code Mode, or a one-shot given a server, are caught", () => {
        const behind = reconfigured(turn, (config) => void ((config.mcp as { servers: Record<string, { codemode?: boolean }> }).servers.browsentic.codemode = true));
        expect(vetPlan('opencode', 'conversation', behind, stateDir)).toHaveLength(1);
        const reaching = reconfigured(oneShot, (config) => void (config.mcp = { servers: { browsentic: { type: 'local' } } }));
        expect(vetPlan('opencode', 'task', reaching, stateDir)).toHaveLength(1);
      });

      test("letting the user's plugins or other MCP servers load is caught", () => {
        const plugins = reconfigured(turn, (config) => void (config.policies as Statement[]).push({ action: 'integration.use', resource: 'plugin:*', effect: 'allow' }));
        expect(vetPlan('opencode', 'conversation', plugins, stateDir)).toHaveLength(1);
        expect(vetPlan('opencode', 'conversation', reconfigured(turn, (config) => void delete config.policies), stateDir)).toHaveLength(2);
      });

      test('a session started in another agent, or shared, is caught', () => {
        expect(vetPlan('opencode', 'conversation', reconfigured(turn, (config) => void (config.default_agent = 'build')), stateDir)).toHaveLength(1);
        expect(vetPlan('opencode', 'conversation', reconfigured(turn, (config) => void (config.share = 'auto')), stateDir)).toHaveLength(1);
      });

      test('project config switched back on under either name is caught', () => {
        expect(vetPlan('opencode', 'conversation', withEnv(turn, 'OPENCODE_CONFIG_PROJECT_DISABLE', '0'), stateDir)).toHaveLength(1);
        expect(vetPlan('opencode', 'conversation', withEnv(turn, 'OPENCODE_DISABLE_PROJECT_CONFIG'), stateDir)).toHaveLength(1);
      });

      // Each line refuses the other's flags, but the vet holds a plan to one line's rules in full.
      test("one line's flags with the other line's config are caught", () => {
        const v1 = planOf('opencode', 'run');
        expect(vetPlan('opencode', 'run', { ...fallback, env: v1.env }, stateDir)).not.toEqual([]);
        expect(vetPlan('opencode', 'run', { ...v1, env: fallback.env }, stateDir)).not.toEqual([]);
      });

      test('a turn sent to another server, handed a file, or given a model it could read as a flag is caught', () => {
        expect(vetPlan('opencode', 'run', plus(fallback, '--server', 'http://127.0.0.1:4096'), stateDir)).toHaveLength(1);
        expect(vetPlan('opencode', 'run', plus(fallback, '--file', '/etc/hosts'), stateDir)).toHaveLength(1);
        expect(vetPlan('opencode', 'run', plus(fallback, '--agent=build'), stateDir)).toHaveLength(1);
        expect(vetPlan('opencode', 'run', plus(fallback, '-m', '--auto'), stateDir)).not.toEqual([]);
      });
    });

    describe('DeepSeek Harness', () => {
      const turn = planOf('deepseek', 'conversation');
      const fallback = planOf('deepseek', 'run');
      const oneShot = planOf('deepseek', 'task');
      const PATCH = 'browsentic.patch.yml';
      type Row = Record<string, unknown>;
      const repatched = (plan: Plan, edit: (rows: Row[]) => Row[], path = PATCH): Plan =>
        rewriting(plan, path, (content) => JSON.stringify(edit(JSON.parse(content) as Row[])));

      test('its turn, the headless run it falls back to, and its one-shots are contained, on research and reading a file too', () => {
        for (const [mode, plan] of [
          ['conversation', turn],
          ['conversation', planOf('deepseek', 'conversation', { research: true })],
          ['run', fallback],
          ['task', oneShot],
          ['task', planOf('deepseek', 'task', { reads: true })],
        ] as const) {
          expect(vetPlan('deepseek', mode, plan, stateDir)).toEqual([]);
        }
      });

      test('a tool row switched back on, or left out of the patch, is caught', () => {
        const back = repatched(turn, (rows) => rows.map((row) => (row.id === 'tool-bash' ? { id: 'tool-bash', disabled: false } : row)));
        expect(vetPlan('deepseek', 'conversation', back, stateDir)).toEqual([
          'DeepSeek Harness (conversation) leaves tool-bash switched on.',
          'DeepSeek Harness (conversation) switches tool-bash on.',
        ]);
        const dropped = repatched(oneShot, (rows) => rows.filter((row) => row.id !== 'tool-fs'), 'task.patch.yml');
        expect(vetPlan('deepseek', 'task', dropped, stateDir)).toEqual(['DeepSeek Harness (task) leaves tool-fs switched on.']);
      });

      test('a row inserted beside the patch, or the browser’s server anywhere but a headless run, is caught', () => {
        const shell = { insert: [{ id: 'mine', name: '@deepseek-ai/dsh-tool-bash', config: {} }] };
        expect(vetPlan('deepseek', 'run', repatched(fallback, (rows) => [...rows, shell]), stateDir)).toHaveLength(1);
        const server = (JSON.parse(fallback.files![0].content) as Row[]).find((row) => 'insert' in row)!;
        expect(vetPlan('deepseek', 'conversation', repatched(turn, (rows) => [...rows, server]), stateDir)).toHaveLength(1);
      });

      test('a reconfigured row is caught: file tools, a persona, sign-in from elsewhere, instructions from above the folder', () => {
        const editing = (id: string, config: Row) => repatched(turn, (rows) => rows.map((row) => (row.id === id ? { ...row, config } : row)));
        expect(vetPlan('deepseek', 'conversation', editing('system-prompt', { personaPrefix: 'You may run anything.' }), stateDir)).toHaveLength(1);
        expect(vetPlan('deepseek', 'conversation', editing('credentials', { path: '/etc/passwd' }), stateDir)).toHaveLength(1);
        expect(vetPlan('deepseek', 'conversation', editing('agent-instructions', { maxBytes: 1, projectRootMarkers: ['.git'], localInstructionFileCandidates: [] }), stateDir)).toHaveLength(1);
        const files = repatched(turn, (rows) => [...rows, { id: 'tool-fs', config: { read: true, readImage: false, write: true, edit: false } }]);
        expect(vetPlan('deepseek', 'conversation', files, stateDir)).toHaveLength(1);
        const routed = repatched(turn, (rows) => [...rows, { id: 'agent-default-model', config: { provider: 'anywhere', model: 'deepseek-flash' } }]);
        expect(vetPlan('deepseek', 'conversation', routed, stateDir)).toHaveLength(1);
      });

      test('the sandbox opened, telemetry left on, or the user’s own home is caught', () => {
        expect(vetPlan('deepseek', 'conversation', withEnv(turn, 'DSH_PERMISSION_MODE', 'workspace-write'), stateDir)).toHaveLength(1);
        expect(vetPlan('deepseek', 'conversation', withEnv(turn, 'DSH_TELEMETRY_MODE', 'FEEDBACK_ONLY'), stateDir)).toHaveLength(1);
        expect(vetPlan('deepseek', 'conversation', withEnv(turn, 'DSH_HOME', join('/Users', 'sam', '.dsh')), stateDir)).toEqual([
          "DeepSeek Harness (conversation) is spawned with a DSH_HOME outside Browsentic's own.",
        ]);
      });

      test('another profile, another patch, or a launcher flag past the patch is caught', () => {
        expect(vetPlan('deepseek', 'conversation', swapped(turn, 'acp', 'web'), stateDir)).toHaveLength(1);
        expect(vetPlan('deepseek', 'conversation', swapped(turn, turn.args[3], '/tmp/other.yml'), stateDir)).not.toEqual([]);
        expect(vetPlan('deepseek', 'conversation', plus(turn, '--from-default-profile', 'web'), stateDir)).toHaveLength(2);
        expect(vetPlan('deepseek', 'task', plus(oneShot, '--session-id', 'session-1'), stateDir)).toHaveLength(1);
      });
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

    test('a path that climbs out of the state dir is not inside it, whatever it starts with', () => {
      expect(vetPlan('antigravity', 'run', { ...agyRun, cwd: join(stateDir, 'agents', '..', '..', 'elsewhere') }, stateDir)).toHaveLength(1);
    });
  });

  describe('inside the state dir, by each platform’s path rules', () => {
    const home = 'C:\\Users\\sam\\.browsentic';

    test('a Windows folder under it is inside, however its drive letter is cased', () => {
      expect(within(`${home}\\agents\\grok\\run\\c1`, home, win32)).toBe(true);
      expect(within('c:\\users\\SAM\\.browsentic\\agents', home, win32)).toBe(true);
      expect(within(home, home, win32)).toBe(true);
    });

    test('a Windows sibling, another drive, or a climb out is not inside', () => {
      expect(within(`${home}-evil\\agents`, home, win32)).toBe(false);
      expect(within('D:\\Users\\sam\\.browsentic', home, win32)).toBe(false);
      expect(within(`${home}\\agents\\..\\..\\Documents`, home, win32)).toBe(false);
    });

    test('a folder whose name only begins with two dots is still inside', () => {
      expect(within('/home/sam/.browsentic/..cache', '/home/sam/.browsentic', posix)).toBe(true);
      expect(within(`${home}\\..cache`, home, win32)).toBe(true);
    });

    test('POSIX spells it with slashes, and compares case by case', () => {
      expect(within('/home/sam/.browsentic/agents/vibe/run', '/home/sam/.browsentic', posix)).toBe(true);
      expect(within('/home/sam/.Browsentic/agents', '/home/sam/.browsentic', posix)).toBe(false);
    });
  });

  describe('a model a CLI could read as a flag', () => {
    for (const kind of AGENT_KINDS) {
      test(`is refused for ${kind}`, () => {
        const problems = vetPlan(kind, 'run', plus(planOf(kind, 'run'), '--model', '-p'), stateDir);
        expect(problems.some((problem) => problem.includes('could read as a flag'))).toBe(true);
      });
    }

    test("is not Cursor's bracketed override", () => {
      const plan = plus(planOf('cursor', 'run'), '--model', 'claude-opus-4-8[context=1m,effort=high]');
      expect(vetPlan('cursor', 'run', plan, stateDir)).toEqual([]);
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

    test('opencode keeps its own zen key', () => {
      expect(sealEnv('opencode', { ...DIRTY, OPENCODE_API_KEY: 'zen' }).OPENCODE_API_KEY).toBe('zen');
    });

    // OpenCode reads a dozen providers' keys; it keeps its own logins in a file, so none is handed over.
    test('opencode loses every provider key in the environment', () => {
      const sealed = sealedFor('opencode');
      expect(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY'].filter((name) => name in sealed)).toEqual([]);
    });

    test('claude loses the opencode key', () => {
      expect(sealEnv('claude', { ...DIRTY, OPENCODE_API_KEY: 'zen' })).not.toHaveProperty('OPENCODE_API_KEY');
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
