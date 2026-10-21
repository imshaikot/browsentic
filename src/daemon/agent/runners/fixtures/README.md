# Agent CLI transcripts

What each agent CLI printed on stdout, one event per line, for the reader tests in `../<agent>.test.ts`.

- `<cli version>-<case>.jsonl` was recorded from that version of the real CLI. The only edits are to
  Claude Code's `init` line, where the working directory became `/Users/you/.browsentic` and the
  recording machine's slash commands, agents, skills, plugins and memory paths were emptied, and to
  its `rate_limit_event`, which keeps only its status. Grok Build prints the same `available_commands`
  line several times over; its recordings keep one of each, with the recording machine's slash
  commands emptied. OpenCode's were recorded through the runner's own plan with the model provider
  replaced by a local stand-in, so the model's words are scripted and its URL is 127.0.0.1 — all but
  `free-tier`, which the real Zen endpoint answered and which lost only its `cf-ray` and
  `cf-placement` headers; paths became `/Users/you`. OpenCode 2.0.32's were recorded the same way,
  from `opencode run --standalone` and from `opencode acp`; the `acp-` ones keep only what the CLI
  printed, with its replies renumbered to the request ids the runner uses, and both `free-tier`
  recordings were answered by the real Zen endpoint. DeepSeek Harness 0.2.1-rc.2's were recorded through
  the runner's plans with a stand-in for the browser's MCP server: the `acp-` ones keep only what
  `dsh --profile acp` printed, with its replies renumbered to the runner's request ids, and the
  `headless-` ones what `dsh --profile headless --json` printed. `acp-turn` was answered by a real
  DeepSeek account and keeps the line of dsh's own that is not JSON; the rest by a local stand-in
  model. Paths became `/Users/you`. Codex's `web-search`, `shell`, `two-calls` and `tool-search`
  and Claude Code's `mcp-failed` were recorded the same way, each saying so in its first line.
- `<case>.hand-written.jsonl` was written from the reader code, for streams a contained run cannot
  produce or a CLI that was not installed. Its first line says so.

Lines starting with `#` are comments, and the tests skip them.

- `<cli version>-models.txt` and `-models-signed-out.txt` are what the CLI's model-listing command
  printed, for `../models.test.ts`: stdout, then stderr after a `# stderr` line, with the exit code
  in a `# exit` line. `codex/<version>-models_cache.json` is Codex's own cache, cut to the fields the
  lister reads, with the account identity and etag replaced. OpenCode 2.0.32's are what
  `opencode api --standalone model.list` printed, cut to the fields the lister reads, which drops
  the account's organization id: `models` on a database signed in to OpenCode Zen alone,
  `-signed-out` on an empty one, and `-provider-keys` on an empty one with stand-in keys for
  Anthropic, OpenAI and Google in the environment.
