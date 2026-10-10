# Configuration

The keys Browsentic reads from `~/.browsentic/config.json` and `profile.json`, with their defaults
and limits. Every key is optional; Browsentic runs with no config file at all.

The Bridge re-reads `config.json` before every run, so an edit applies to the next thing you ask
without a restart. It also watches the file, so the settings page and the Mac app show a hand edit
as soon as you save it.

`BROWSENTIC_HOME` moves the whole state directory somewhere other than `~/.browsentic`.
[internals/state.md](../internals/state.md) has the full disk layout.

---

## A complete example

None of these keys is required.

```json
{
  "agent": "claude",
  "agents": {
    "claude": { "bin": "/opt/homebrew/bin/claude", "model": "claude-sonnet-5", "effort": "high" }
  },
  "requireApproval": ["page.submitForm"],
  "maxConcurrentRuns": 3,
  "theme": "midnight",
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
  },
  "android": { "enabled": true }
}
```

---

## Agent

| Key | Default | Notes |
| --- | --- | --- |
| `agent` | `claude` | Which CLI the side panel runs on: `claude`, `codex`, `antigravity`, `vibe`, `grok`, `cursor`, `qwen` or `opencode` |
| `agents.<name>.bin` | the CLI's own command name | Absolute path to the binary |
| `agents.<name>.model` | `sonnet` for Claude, else the CLI's default | Passed as `--model`; the agent picker's model select writes it. One starting with a dash or holding a space is ignored |
| `agents.<name>.effort` | unset | That CLI's reasoning-effort flag; an unaccepted value is dropped |
| `agents.codex.transport` | unset (the app-server) | `"exec"` runs Codex through `codex exec` instead of its app-server; see [agents.md § Codex](agents.md#codex-gets-the-browser-tools-as-its-own) |

The models the select offers are not configurable: Codex, Antigravity, Grok Build and Cursor CLI are
asked for their own list, and the rest offer a short list shipped with Browsentic.

Full detail, including the Antigravity permission rule: [Choosing an agent](agents.md).

## Runs

| Key | Default | Max | Notes |
| --- | --- | --- | --- |
| `maxConcurrentRuns` | 3 | 8 | How many tab sessions may have a run going at once. Exceeding it returns `RUN_LIMIT` |

Separately, at most eight tab sessions may be *open* at once; that ceiling is compiled in. See
[Conversations](features/conversations.md).

## Approvals and guardrails

Most of these keys can also be set from the settings page or the Mac app's Settings tab, which both
write the same keys one row at a time. Every row starts off, meaning "use the default", so an
install that never opens either has no `guardrails` key at all. Turning a row back off deletes its
line instead of writing the default, so a hand-edited file and one edited from the UI look the same.

| Key | Default | Notes |
| --- | --- | --- |
| `requireApproval` | `["page.submitForm"]` | Actions an agent run must ask about first. Listing `page.submitForm` also catches `pressEnter: true` and pressing Enter, because those submit forms too |
| `guardrails.rules` | none | Override any rule's effect by id: `allow`, `confirm` or `deny` |
| `guardrails.unattended` | `deny` | What a `confirm` becomes for a caller with nobody to ask, i.e. an [MCP client](mcp-clients.md) |
| `guardrails.urlPayloadBytes` | 512 | Query-string + fragment size above which a navigation is treated as carrying a payload |
| `guardrails.hosts` | none | Standing host allowlist added to every run's scope. `["*"]` disables host confinement entirely |
| `guardrails.fence` | `true` | Whether page-derived text is wrapped and marked as untrusted data |

[Approvals](approvals.md) lists every rule id and what it does, including the four that the
settings page shows but will not change.

## Paths

| Key | Default | Notes |
| --- | --- | --- |
| `screenshotDir` | `~/browsentic/screenshot` | Where captures taken with `save: true` are written, mode `0600` |
| `downloadDir` | `~/browsentic/download` | Where files captured with `page_captureDownload` are written, mode `0600` |
| `downloadTtlDays` | `14` | How long a captured download is kept before the Bridge sweeps it. Fractions are allowed: `0.5` is twelve hours |
| `skillsDir` | `~/browsentic/skills` | Where panel uploads and generated site maps live |
| `extensionDir` | `~/browsentic/extension/chrome-mv3` | Where `browsentic setup --unpacked` writes the unpacked extension. `--dir` writes it for you, and `update` reads it back so it refreshes the copy the browser actually loaded. If you change it by hand, load the new folder in the browser again, because the extension ID follows the path |

## Android

| Key | Default | Notes |
| --- | --- | --- |
| `android.enabled` | `true` | `false` stops the Bridge using adb at all: it never looks for phones, and the side panel shows no Android switch. See [Android phone](features/android.md) |
| `android.adb` | found | Absolute path to the adb to use. Without it the Bridge looks on `PATH`, under `ANDROID_HOME` and `ANDROID_SDK_ROOT`, in Android Studio's SDK, where Homebrew puts it, and on Windows where winget, Scoop and Chocolatey put it and in `Downloads`. Name one when you have several, since two adb versions stop each other's server. On Windows write the path with forward slashes, `"C:/platform-tools/adb.exe"`: a single backslash is not valid JSON, and the Bridge then ignores the whole file |

## Site mapping

| Key | Default | Ceiling | Notes |
| --- | --- | --- | --- |
| `siteMap.research` | `true` | n/a | Lets a mapping run use web search for public background on the domain. Turn it off to keep everything inside the browser |
| `siteMap.allowClicks` | `false` | n/a | Lets a mapping run reach routes that only exist behind an interaction |
| `siteMap.maxPages` | 15 | 40 | |
| `siteMap.maxScreenshots` | 10 | 24 | |
| `siteMap.timeoutMs` | 600 000 (10 min) | 1 800 000 (30 min) | |

**Config can narrow these but never widen them past the compiled ceilings.** A value above the
ceiling is clamped; a value that is not a number ≥ 1 falls back to the default. See
[Site maps](features/site-maps.md).

---

## Appearance

| Key | Default | Notes |
| --- | --- | --- |
| `theme` | absent (Ember) | `ember`, `midnight`, `phosphor` or `daylight`: the look of the side panel, the popup and the settings page |

Pick it from the row of tiles under **Appearance** in the **Extension** section of the settings
page, or under **Browser theme** in the Mac app's Settings tab: **Ember** (warm near-black, cyan),
**Midnight** (cool blue-black, violet), **Phosphor** (a green CRT) and **Daylight** (ink on paper).
Each tile is drawn in the theme it offers.

One theme applies to every paired browser: picking one anywhere repaints the side panel, the popup
and the settings page in all of them. A browser that has never been paired keeps its choice locally
and hands it to the Bridge when it first connects; a theme picked while the Bridge is unreachable is
handed over at the next connect. The Mac app's own window has a separate System / Light / Dark
setting.

### The Extension section

Below the theme, the same section holds settings that belong to one browser only. None of them is
in `config.json`; each browser keeps its own.

| Block | What it sets |
| --- | --- |
| **On the page** | **Show what the agent does**: the [action cues](features/action-cues.md) ring on each element an agent acts on. Off until you switch it on; the composer's button and the mic's menu switch the same setting |
| **Right-click menu** | Whether a right-click on a page offers **Open Browsentic** (the side panel) and **Open Browsentic (Hands Free)**. Both are on until you switch one off. With both on, the browser groups them under a **Browsentic** entry |
| **Keyboard shortcuts** | Shows the keys for **Open the popup**, **Open or close the side panel** and **Start or stop hands-free**. The browser owns these: it gives the side panel **Alt+Shift+B** and hands-free **Alt+Shift+H** (**⌥⇧B**, **⌥⇧H** on a Mac) at install unless something else already has them, and **Change shortcuts** opens its own shortcuts page. Firefox has the popup and the sidebar only |
| **Hands-free** | **Hold to talk**, the same switch as in the mic's own menu |

The hands-free item, shortcut and block show only in a browser that can transcribe speech; see
[Hands-free → Which browsers](features/hands-free.md#which-browsers).

---

## Profile

The **Profile** section of the settings page writes `~/.browsentic/profile.json`, a separate file
that keeps personal details out of `config.json`. It is re-read before every run and watched the
same way, and every field in it is optional:

```json
{
  "fields": {
    "givenName": "Ada",
    "familyName": "Lovelace",
    "email": "ada@example.com",
    "street": "12 St James’s Square\nFlat 3",
    "country": "United Kingdom"
  },
  "details": [{ "label": "Frequent flyer", "value": "BA 123456" }],
  "instructions": "Always choose the cheapest shipping."
}
```

| Key | Limit | Notes |
| --- | --- | --- |
| `fields` | 300 characters each | `givenName`, `familyName`, `email`, `phone`, `street`, `city`, `region`, `postalCode`, `country`, `company`, `jobTitle` |
| `details` | 20 entries; label 60, value 300 characters | Anything the fields do not cover |
| `instructions` | 4,000 characters | Kept on every task |

An entry that breaks a limit, or a key the page does not know, is left out rather than cut short,
and the Bridge logs that it did. [Profile](features/profile.md) covers what the agent is told and
what is refused.

---

## Things that are not configurable

These ceilings are compiled in, and no key changes them:

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

- [Approvals](approvals.md): the gate, rule by rule
- [internals/state.md](../internals/state.md): every file Browsentic writes
- [reference/cli.md](../reference/cli.md): commands that read and write this config
