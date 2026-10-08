# Skills

Skills are the markdown instructions that tell the agent how to handle a request. Each instruction is
routed to one base skill, site notes stack on top of it, and you can add, override or pin your own.

---

## Every instruction is routed to one base skill

The base skill is chosen by trigger words in what you said:

| Skill | Handles |
| --- | --- |
| `browser-control` *(default)* | Drive the open tab: click, type, submit, navigate, verify |
| `page-research` | Read and summarise without changing anything |
| `page-theming` | Read what the page is painting and [retheme it](theming.md) |
| `page-diagnostics` | Find out [why a page misbehaved](diagnostics.md) from its console errors and failed requests |
| `browse-navigation` | [Replay a recorded session](recordings.md), as in "do it like last time" |
| `monitor-progress` | [Watch a long-running task](monitoring.md) and report when it finishes |
| `scheduled-jobs` | [Do something on a clock](scheduling.md): once after a delay, or on an interval |
| `site-mapper` | [Walk a site](site-maps.md) and write up how it is laid out |
| `captcha` | [Get past a "verify you are human" block](captcha.md), or hand a real challenge to you |
| `a-eye` | Work on [the element you pointed at](a-eye.md), or ask you to point at one |

Exactly one base skill is picked, by counting trigger-word hits, with `browser-control` as the
fallback. Prefix an instruction with `@name` to pin one explicitly:

```
@page-research what does this page say about refunds?
```

`@site-mapper` is the one case where the prefix is **required** rather than optional.

One bundled skill is never the base: `page-scripting` rides along with whichever base skill was
picked, and only when the composer's **Live tool** switch is on (see
[Page actions](page-actions.md#repeating-a-job-and-doing-what-no-tool-covers)).

Typing `/` at the start of the composer opens a picker over every kind of skill described below,
with skills for the current site first, so you do not have to remember names. Picking a Browsentic skill inserts its `@name`
for you.

---

## Site notes are overlays, not replacements

A skill with `category: site-exploration` and a `domains:` list stacks **on top of** the base skill
whenever the active tab's host matches, longest match first. The normal driving and read-only rules
still apply underneath.

[Site maps](site-maps.md) generate these, and you can write one by hand for a site you know well.

---

## Writing your own

Skills are plain markdown with YAML-style front matter:

```markdown
---
name: acme-admin
description: Our internal admin tool.
category: site-exploration
domains: [admin.acme.com]
---

Search is `#q` and submits on Enter, not on the button.
Results lazy load. Click "Load more" until it disappears before counting anything.
```

Put it in `~/.browsentic/skills/`, or upload it from the panel's **Skills** tab. Both `<name>.md`
and `<name>/SKILL.md` are recognised.

### Where they are loaded from

Three directories, with later ones shadowing earlier ones by name, so your own `browser-control.md`
replaces the bundled one:

| Directory | Tagged | Contents |
| --- | --- | --- |
| bundled | `bundled` | The skills above, plus `page-scripting` |
| `~/.browsentic/skills/` | `user` | Hand-written overrides |
| `~/browsentic/skills/` (or `skillsDir`) | `uploaded` | Panel uploads and generated site maps |

**All three are re-read on every run**, so an edit applies to the next instruction with no reload
or restart.

```sh
browsentic skills    # everything the router can see, tagged with where it came from
```

---

## The agent's own skills

The `/` picker also lists the skills the active agent CLI keeps for itself:

| Agent | Where it looks |
| --- | --- |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/`, `~/.codex/prompts/` |
| Antigravity | the roots listed in `~/.gemini/antigravity/skills.txt` |
| Mistral Vibe | `~/.vibe/skills/`, `~/.agents/skills/` |
| Grok Build | `~/.grok/skills/`, `~/.agents/skills/`, and the Claude Code skills it also loads |
| Cursor CLI | `~/.cursor/skills/`, `~/.agents/skills/` |
| Qwen Code | `~/.qwen/skills/`, `~/.agents/skills/` |
| OpenCode | `~/.config/opencode/skills/` (and `skill/`), `~/.opencode/skills/`, `~/.agents/skills/`, `~/.claude/skills/` |

Picking one attaches it to that message: Browsentic Bridge reads the file when it starts the run and
appends it to the system prompt, clearly marked, with a note that browser tools are all the run has.

These skip routing and ride alongside whichever base skill was picked. Only the skill's **title
reaches the browser**: the side panel holds an opaque id, and the Bridge refuses any id it did not
issue itself, so the file's path and contents stay with the Bridge on your computer. Files over
48 KB are left out of the picker. Switching agents swaps the list.

---

## What does not go through routing

[Instant commands](instant-commands.md) never reach an agent, so they are never routed. Anything
starting with `@` always escalates, which is why a pin always works.

---

## See also

- [internals/agent-runs.md § Skill routing](../../internals/agent-runs.md#skill-routing): the matching, and how the prompt is assembled
- [Site maps](site-maps.md): generated overlays
