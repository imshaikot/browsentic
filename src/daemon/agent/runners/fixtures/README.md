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
  `cf-placement` headers; paths became `/Users/you`.
- `<case>.hand-written.jsonl` was written from the reader code, for streams a contained run cannot
  produce or a CLI that was not installed. Its first line says so.

Lines starting with `#` are comments, and the tests skip them.

- `<cli version>-models.txt` and `-models-signed-out.txt` are what the CLI's model-listing command
  printed, for `../models.test.ts`: stdout, then stderr after a `# stderr` line, with the exit code
  in a `# exit` line. `codex/<version>-models_cache.json` is Codex's own cache, cut to the fields the
  lister reads, with the account identity and etag replaced.
