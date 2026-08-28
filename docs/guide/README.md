# User guide

Everything you need to run Browsentic on your own machine and your own browser.

## Setting up

Three short steps, about five minutes in total. There is no account, no API key and no cloud
service.

1. **[Install](install.md)** — clone, build, load the extension
2. **[Pair](pair.md)** — put `browsentic` on your `PATH` and connect your browser to it
3. **[First run](first-run.md)** — a tour of the side panel, and your first instruction

## Using it

**[Features](features/)** — one page per capability:

| | |
| --- | --- |
| [Conversations](features/conversations.md) | Voice, text, one conversation per tab, history |
| [Instant commands](features/instant-commands.md) | The things that run in milliseconds without an agent |
| [Page actions](features/page-actions.md) | What it can actually do to a page |
| [Screenshots](features/screenshots.md) | Capturing the viewport, the full page, or one element |
| [Theming](features/theming.md) | Dark mode on any site, and a real contrast audit |
| [Captchas](features/captcha.md) | What it will and will not do at a "verify you are human" block |
| [Monitoring](features/monitoring.md) | Watching a long job in the background |
| [Site maps](features/site-maps.md) | Teaching it a site once |
| [Recordings](features/recordings.md) | Showing it a task once, repeating it later |
| [Files](features/files.md) | Attaching a file and uploading it to a page |
| [Skills](features/skills.md) | How instructions get routed, and how to write your own |

## Configuring

| | |
| --- | --- |
| [Choosing an agent](agents.md) | Claude Code, Codex or Antigravity — switching, and what each needs |
| [MCP clients](mcp-clients.md) | Registering Browsentic with Claude Code, Cursor, Zed, Codex, Gemini CLI |
| [Configuration](configuration.md) | Every key in `~/.browsentic/config.json` |
| [Approvals](approvals.md) | The gate — what asks first, and how to tune it |

## When something is wrong

| | |
| --- | --- |
| [Limits](limits.md) | The honest boundaries. Read this before relying on it for anything |
| [Troubleshooting](troubleshooting.md) | Symptom, cause, fix |
| [Maintenance](maintenance.md) | Updating, and removing it cleanly |

---

Want to know how it works underneath? [Internals](../internals/).
