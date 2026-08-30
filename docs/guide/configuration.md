# Configuration

Everything is optional. Browsentic works with no config file at all.

Settings live in `~/.browsentic/config.json`. The daemon re-reads it before every run, so an edit
applies to the next thing you ask — no restart.

`BROWSENTIC_HOME` relocates the whole state directory if you need it somewhere other than
`~/.browsentic`. See [internals/state.md](../internals/state.md) for the full disk layout.

---

## A complete example

Nothing here is required; this shows every key in one place.

```json
{
  "agent": "claude",
  "agents": {
    "claude": { "bin": "/opt/homebrew/bin/claude", "model": "claude-sonnet-5", "effort": "high" }
  },
  "requireApproval": ["page.submitForm"],
  "maxConcurrentRuns": 3,
  "guardrails": {
    "rules": { "raw-html-read": "allow" },
    "unattended": "deny",
    "urlPayloadBytes": 512,
    "hosts": [],
    "fence": true
  },
  "screenshotDir": "~/browsentic/screenshot",
  "downloadDir": "~/browsentic/download",
  "downloadTtlDays": 14,
  "skillsDir": "~/browsentic/skills",
  "siteMap": {
    "research": true,
    "allowClicks": false,
    "maxPages": 15,
    "maxScreenshots": 10,
    "timeoutMs": 600000
  }
}
```

---

## Agent

| Key | Default | Notes |
| --- | --- | --- |
| `agent` | `claude` | Which CLI the side panel runs on: `claude`, `codex` or `antigravity` |
| `agents.<name>.bin` | the CLI's own command name | Absolute path to the binary |
| `agents.<name>.model` | `claude-sonnet-5` for Claude, else the CLI's default | Passed as `--model`; the agent picker's model select writes it |
| `agents.<name>.effort` | unset | That CLI's reasoning-effort flag; an unaccepted value is dropped |

Full detail, including the Antigravity permission rule: [Choosing an agent](agents.md).

## Runs

| Key | Default | Max | Notes |
| --- | --- | --- | --- |
| `maxConcurrentRuns` | 3 | 8 | How many tab sessions may have a run going at once. Exceeding it returns `RUN_LIMIT` |

Eight tab sessions may be *open* at once regardless; that ceiling is compiled in. See
[Conversations](features/conversations.md).

## Approvals and guardrails

Most of this section has a UI: the side panel's **Settings** tab writes these same keys, one row at
a time. Rows start off — meaning "use the default" — so an install that never opens the tab has no
`guardrails` key at all. Turning a row back off deletes its line rather than writing the default,
which is why a hand-edited file and a panel-edited file look the same.

| Key | Default | Notes |
| --- | --- | --- |
| `requireApproval` | `["page.submitForm"]` | Actions an agent run must ask about first. Listing `page.submitForm` also catches `pressEnter: true` and pressing Enter, because those submit forms too |
| `guardrails.rules` | — | Override any rule's effect by id: `allow`, `confirm` or `deny` |
| `guardrails.unattended` | `deny` | What a `confirm` becomes for a caller with nobody to ask — i.e. an [MCP client](mcp-clients.md) |
| `guardrails.urlPayloadBytes` | 512 | Query-string + fragment size above which a navigation is treated as carrying a payload |
| `guardrails.hosts` | — | Standing host allowlist added to every run's scope. `["*"]` disables host confinement entirely |
| `guardrails.fence` | `true` | Whether page-derived text is wrapped and marked as untrusted data |

Every rule id and what it does, plus the three that the panel shows but will not change: [Approvals](approvals.md).

## Paths

| Key | Default | Notes |
| --- | --- | --- |
| `screenshotDir` | `~/browsentic/screenshot` | Where captures taken with `save: true` are written, mode `0600` |
| `downloadDir` | `~/browsentic/download` | Where files captured with `page_captureDownload` are written, mode `0600` |
| `downloadTtlDays` | `14` | How long a captured download is kept before the daemon sweeps it. Fractions allowed — `0.5` is twelve hours |
| `skillsDir` | `~/browsentic/skills` | Where panel uploads and generated site maps live |
| `extensionDir` | `~/browsentic/extension/chrome-mv3` | Where `browsentic setup` installed the unpacked extension. Written for you by `setup --dir`, and read back by `update` so it refreshes the copy the browser actually loaded. Changing it by hand means loading the new folder in the browser again, because the extension ID follows the path |

## Site mapping

| Key | Default | Ceiling | Notes |
| --- | --- | --- | --- |
| `siteMap.research` | `true` | — | Lets a mapping run use web search for public background on the domain. Turn it off to keep everything inside the browser |
| `siteMap.allowClicks` | `false` | — | Lets a mapping run reach routes that only exist behind an interaction |
| `siteMap.maxPages` | 15 | 40 | |
| `siteMap.maxScreenshots` | 10 | 24 | |
| `siteMap.timeoutMs` | 600 000 (10 min) | 1 800 000 (30 min) | |

**Config can narrow these but never widen them past the compiled ceilings.** A value above the
ceiling is clamped; a value that is not a number ≥ 1 falls back to the default. See
[Site maps](features/site-maps.md).

---

## Things that are not configurable

Compiled-in ceilings, listed here so you do not go looking for a key that does not exist:

| | |
| --- | --- |
| Open tab sessions | 8 |
| Concurrent background monitors | 3 |
| Monitor duration | 30 minutes default, 4 hours maximum |
| Recording duration | 15 minutes, warning at 13 |
| Full-page screenshot | 48 tiles, 16 384 px canvas side |
| System prompt | 64 KB total |
| Loopback ports | 8765, 8766, 8767 |

---

## See also

- [Approvals](approvals.md) — the gate, rule by rule
- [internals/state.md](../internals/state.md) — every file Browsentic writes
- [reference/cli.md](../reference/cli.md) — commands that read and write this config
