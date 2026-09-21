# Agent CLI transcripts

What each agent CLI printed on stdout, one event per line, for the reader tests in `../<agent>.test.ts`.

- `<cli version>-<case>.jsonl` was recorded from that version of the real CLI. The only edits are to
  Claude Code's `init` line, where the working directory became `/Users/you/.browsentic` and the
  recording machine's slash commands, agents, skills, plugins and memory paths were emptied, and to
  its `rate_limit_event`, which keeps only its status.
- `<case>.hand-written.jsonl` was written from the reader code, for streams a contained run cannot
  produce or a CLI that was not installed. Its first line says so.

Lines starting with `#` are comments, and the tests skip them.
