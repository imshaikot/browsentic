# Skills

What decides how an instruction is handled — and how to change it.

---

## Every instruction is routed to one base skill

Chosen by trigger words in what you said:

| Skill | Handles |
| --- | --- |
| `browser-control` *(default)* | Drive the open tab — click, type, submit, navigate, verify |
| `page-research` | Read and summarise without changing anything |
| `page-theming` | Read what the page is painting and [retheme it](theming.md) |
| `browse-navigation` | [Replay a recorded session](recordings.md) — "do it like last time" |
| `monitor-progress` | [Watch a long-running task](monitoring.md) and report when it finishes |
| `site-mapper` | [Walk a site](site-maps.md) and write up how it is laid out |
| `captcha` | [Get past a "verify you are human" block](captcha.md), or hand a real challenge to you |

Exactly one base skill is picked, by counting trigger-word hits, with `browser-control` as the
fallback. Prefix an instruction with `@name` to pin one explicitly:

```
@page-research what does this page say about refunds?
```

`@site-mapper` is the one case where the prefix is **required** rather than optional.

---

## Site notes are overlays, not replacements

A skill with `category: site-exploration` and a `domains:` list stacks **on top of** the base skill
whenever the active tab's host matches — longest match first. The normal driving and read-only rules
still apply underneath.

That is what [site maps](site-maps.md) generate, and what you write by hand for a site you know
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
browsentic-mcp skills    # everything the router can see, tagged with where it came from
```

---

## What does not go through routing

[Instant commands](instant-commands.md) never reach an agent, so they are never routed. Anything
starting with `@` escalates unconditionally, which is why a pin always works.

---

## See also

- [internals/agent-runs.md § Skill routing](../../internals/agent-runs.md#skill-routing) — the matching, and how the prompt is assembled
- [Site maps](site-maps.md) — generated overlays
