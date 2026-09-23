import { describe, expect, test } from 'vitest';
import { stateDir } from '../../lockfile';
import { jsonContext, shown, streamContext } from './fixtures/support';
import { vibeRunner } from './vibe';

const settings = { bin: 'vibe' };
const stream = (overrides: Parameters<typeof streamContext>[1] = {}) => vibeRunner.stream(streamContext(settings, overrides));

const fileIn = (plan: { files?: readonly { path: string; content: string }[] }, path: string) =>
  plan.files?.find((file) => file.path === path)?.content ?? '';

describe('a streamed run', () => {
  test('a fresh run writes its server, model and tool grants where Vibe will read them', () => {
    expect(shown(stream({ settings: { bin: 'vibe', model: 'mistral-medium-3.5' } }))).toMatchInlineSnapshot(`
      {
        "args": [
          "--prompt",
          "what does this page cost",
          "--output",
          "streaming",
          "--trust",
          "--agent",
          "ask",
          "--enabled-tools",
          "browsentic_*",
        ],
        "cwd": "<state>/agents/vibe/run/conversation-1",
        "env": {
          "BROWSENTIC_AGENT_RUN": "run-1",
        },
        "files": [
          {
            "content": "active_model = "mistral-medium-3.5"

      [[mcp_servers]]
      name = "browsentic"
      transport = "stdio"
      command = ["/usr/local/bin/node"]
      args = ["/usr/local/lib/node_modules/browsentic/dist/cli.js", "mcp"]

      [mcp_servers.env]
      BROWSENTIC_AGENT_RUN = "run-1"

      [tools."browsentic_page_getPageInfo"]
      permission = "always"

      [tools."browsentic_page_clickElement"]
      permission = "always"

      [tools."browsentic_browsentic_status"]
      permission = "always"
      ",
            "path": ".vibe/config.toml",
          },
          {
            "content": "You are Browsentic.
      ",
            "path": "AGENTS.md",
          },
        ],
      }
    `);
  });

  /**
   * Vibe re-reads a resumed session from the folder it began in, not the one it is started in. A
   * folder per run left the second turn calling the browser with the first turn's run id — which
   * the daemon answers RUN_INACTIVE, every time — behind the first turn's system prompt.
   */
  test('a follow-up rewrites the same folder, so the run id and the prompt are this turn’s', () => {
    const first = stream();
    const second = stream({
      runId: 'run-2',
      // The daemon points the server at the run it belongs to; the config carries whatever it says.
      mcp: { ...streamContext(settings).mcp, env: { BROWSENTIC_AGENT_RUN: 'run-2' } },
      sessionId: 'vibe-session-1',
      systemPrompt: 'You are Browsentic. Second turn.',
    });

    expect(second.cwd).toBe(first.cwd);
    expect(second.args).toContain('--resume');
    expect(fileIn(second, '.vibe/config.toml')).toContain('BROWSENTIC_AGENT_RUN = "run-2"');
    expect(fileIn(second, 'AGENTS.md')).toContain('Second turn.');
    expect(second.env?.BROWSENTIC_AGENT_RUN).toBe('run-2');
  });

  test('a run with no conversation keeps a folder of its own', () => {
    expect(stream({ conversation: null }).cwd).toBe(`${stateDir}/agents/vibe/run/run-1`);
  });

  test('a conversation id is spelled so it stays one path segment', () => {
    expect(stream({ conversation: '../../escape me' }).cwd).toBe(`${stateDir}/agents/vibe/run/______escape_me`);
  });

  test('research adds the web tools to the allowlist, and nothing else is switched on', () => {
    const args = stream({ research: true }).args;
    const allowed = args.flatMap((arg, at) => (arg === '--enabled-tools' ? [args[at + 1]] : []));
    expect(allowed).toEqual(['browsentic_*', 'web_search', 'web_fetch']);
  });
});

describe('a one-shot task', () => {
  test('a task reaches no browser and switches no tool on', () => {
    const plan = vibeRunner.json(jsonContext(settings));
    expect(plan.cwd).toBe(`${stateDir}/agents/vibe/task`);
    expect(plan.args).toContain('re:^$');
    expect(fileIn(plan, '.vibe/config.toml')).not.toContain('mcp_servers');
  });
});
