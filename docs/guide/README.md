# User guide

How to install, pair, use, configure and troubleshoot Browsentic on your own computer and browser.

## Setting up

Three short steps, about five minutes in total, with no account, no API key and no cloud service.

1. **[Install](install.md)**: the [Mac app](mac-app.md), the [Windows app](windows-app.md) or one command installs Browsentic Bridge on your computer, then opens the extension's store page in your browser
2. **[Pair](pair.md)**: connect your browser with a single-use code
3. **[First run](first-run.md)**: a tour of the side panel, and your first instruction

## Using it

**[Features](features/)**, one page per capability:

| | |
| --- | --- |
| [Conversations](features/conversations.md) | Voice, text, one conversation per tab, history |
| [Instant commands](features/instant-commands.md) | Commands that run in the browser in milliseconds, without an agent |
| [Page actions](features/page-actions.md) | What the agent can do on a page |
| [Screenshots](features/screenshots.md) | Capturing the viewport, the full page, or one element |
| [Theming](features/theming.md) | Dark mode on any site, and a contrast audit |
| [Captchas](features/captcha.md) | What it will and will not do at a "verify you are human" block |
| [Monitoring](features/monitoring.md) | Watching a long job in the background |
| [Site maps](features/site-maps.md) | Teaching the agent a site once |
| [Recordings](features/recordings.md) | Showing the agent a task once and replaying it later |
| [Files](features/files.md) | Attaching a file and uploading it to a page |
| [Skills](features/skills.md) | How instructions get routed, and how to write your own |

## Configuring

| | |
| --- | --- |
| [Choosing an agent](agents.md) | The eight agent CLIs the side panel can run on: switching, and what each needs |
| [MCP clients](mcp-clients.md) | Optional: registering Browsentic with Claude Code, Cursor, Zed, Codex or Gemini CLI |
| [Configuration](configuration.md) | Every key in `~/.browsentic/config.json` |
| [Approvals](approvals.md) | Which actions wait for your approval, and how to tune that |

## When something is wrong

| | |
| --- | --- |
| [Limits](limits.md) | Where Browsentic stops. Read this before relying on it for anything |
| [Troubleshooting](troubleshooting.md) | Symptom, cause, fix |
| [Maintenance](maintenance.md) | Updating, and removing it cleanly |

---

How it works underneath: [Internals](../internals/).
