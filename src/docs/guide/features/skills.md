---
layout: layouts/doc.njk
pageKey: docs
title: "Skills"
seoTitle: "Skills — Browsentic features"
description: "What decides how an instruction is handled — and how to change it. Chosen by trigger words in what you said: Exactly one base skill is picked, by counting…"
deck: "What decides how an instruction is handled — and how to change it."
docsPath: "guide/features/skills.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 12
isIndex: false
permalink: "/docs/guide/features/skills/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/skills.md"
---
---

## Every instruction is routed to one base skill

Chosen by trigger words in what you said:

| Skill | Handles |
| --- | --- |
| `browser-control` *(default)* | Drive the open tab — click, type, submit, navigate, verify |
| `page-research` | Read and summarise without changing anything |
| `page-theming` | Read what the page is painting and [retheme it](/docs/guide/features/theming/) |
| `browse-navigation` | [Replay a recorded session](/docs/guide/features/recordings/) — "do it like last time" |
| `monitor-progress` | [Watch a long-running task](/docs/guide/features/monitoring/) and report when it finishes |
| `site-mapper` | [Walk a site](/docs/guide/features/site-maps/) and write up how it is laid out |
| `captcha` | [Get past a "verify you are human" block](/docs/guide/features/captcha/), or hand a real challenge to you |
| `a-eye` | Work on [the element you pointed at](/docs/guide/features/a-eye/), or ask you to point at one |

Exactly one base skill is picked, by counting trigger-word hits, with `browser-control` as the
fallback. Prefix an instruction with `@name` to pin one explicitly:

```
@page-research what does this page say about refunds?
```

`@site-mapper` is the one case where the prefix is **required** rather than optional.

Typing `/` at the start of the panel's composer opens a picker over everything below — skills for
the current site first, then the rest — so the prefix does not have to be remembered. Picking a
Browsentic skill inserts its `@name` for you.

---

## Site notes are overlays, not replacements

A skill with `category: site-exploration` and a `domains:` list stacks **on top of** the base skill
whenever the active tab's host matches — longest match first. The normal driving and read-only rules
still apply underneath.

That is what [site maps](/docs/guide/features/site-maps/) generate, and what you write by hand for a site you know
well.

---

## Writing your own

Skills are plain markdown with YAML-ish front matter:

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

Drop it into `~/.browsentic/skills/`, or upload it from the panel's **Skills** tab.

Both `<name>.md` and `<name>/SKILL.md` are recognised.

### Where they are loaded from

Three directories, later shadowing earlier by name — so your own `browser-control.md` replaces the
bundled one:

| Directory | Tagged | Contents |
| --- | --- | --- |
| bundled | `bundled` | The seven above |
| `~/.browsentic/skills/` | `user` | Hand-written overrides |
| `~/browsentic/skills/` (or `skillsDir`) | `uploaded` | Panel uploads and generated site maps |

**All three are re-read on every run**, so an edit applies to the very next instruction. No reload,
no restart.

```sh
browsentic skills    # everything the router can see, tagged with where it came from
```

---

## The agent's own skills

The `/` picker also lists the skills the active agent CLI keeps for itself — Claude Code's
`~/.claude/skills/`, Codex's `~/.codex/skills/` and `~/.codex/prompts/`, the roots in Antigravity's
`skills.txt`. Picking one attaches it to that message: the daemon reads the file at spawn time and
appends it to the system prompt, clearly marked, with a note that browser tools are all the run
has.

These never go through routing — they ride alongside whatever base skill was picked. Only the
skill's **title crosses to the extension**; the panel holds an opaque id, and the daemon refuses
any id it did not mint itself, so the file's path and content stay on your machine's daemon side.
Files past 48 KB are left out of the picker. Switching agents swaps the list.

---

## What does not go through routing

[Instant commands](/docs/guide/features/instant-commands/) never reach an agent, so they are never routed. Anything
starting with `@` escalates unconditionally, which is why a pin always works.

---

## See also

- [internals/agent-runs.md § Skill routing](/docs/internals/agent-runs/#skill-routing) — the matching, and how the prompt is assembled
- [Site maps](/docs/guide/features/site-maps/) — generated overlays
