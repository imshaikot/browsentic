---
layout: layouts/doc.njk
pageKey: docs
title: "Site maps"
seoTitle: "Site maps — Browsentic features"
description: "Teach it a site once. An agent that has never seen your site spends its first minutes rediscovering it: where search lives, what a button is really called…"
deck: "Teach it a site once."
docsPath: "guide/features/site-maps.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 8
isIndex: false
permalink: "/docs/guide/features/site-maps/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/site-maps.md"
---
An agent that has never seen your site spends its first minutes rediscovering it: where search
lives, what a button is really called, why the list looks empty until you scroll. A site map does
that exploration once and keeps the result.

---

## Making one

Press **Map this site** in the side panel's **Skills** tab, or say:

```
@site-mapper map this site
```

Mapping requires the explicit `@site-mapper` prefix or the button. Trigger words alone will not
start one, because a mapping run takes minutes and commandeers the tab.

Browsentic reads the site's own `robots.txt` and `sitemap.xml`, looks up public background on the
domain, then walks the site for a few minutes taking screenshots.

## What you get

```
~/browsentic/skills/acme-com/
├── SKILL.md          landmarks, key pages, how they connect, quirks
├── map.json          the structured report behind it
├── screenshots/      captures taken during the crawl
├── evidence/         the robots.txt and sitemap it worked from
└── pages/            longer per-page notes, kept out of the prompt
```

From then on, any instruction you give on that domain carries those notes. Elsewhere they are inert.

---

## Nothing takes effect until you say so

A map in flight is written to a staging directory the skill loader **cannot read**, so an unreviewed
map is not merely unused — it is never opened.

The panel shows you the exact markdown as plain text, never rendered, along with the domain it will
match. **Activate** arms it; **Discard** deletes it.

> A map is written from pages an agent read, so read it before activating, as you would any
> generated content.

---

## What a mapping run may do

The crawl is **read-only and locked to one host**. It cannot click, fill or submit; it cannot leave
the site; and it is pinned to the tab it started in, so switching tabs stops it rather than
following you. Off-host, every read is blocked until it navigates back.

Limits are enforced by the daemon, and [config](/docs/guide/configuration/) can narrow them but never widen
them:

| Setting | Default | Ceiling |
| --- | --- | --- |
| `maxPages` | 15 | 40 |
| `maxScreenshots` | 10 | 24 |
| `timeoutMs` | 600 000 (10 min) | 1 800 000 (30 min) |

Two switches change what a run may do:

| | Default | Effect |
| --- | --- | --- |
| `allowClicks` | off | Lets it reach routes that only exist behind an interaction |
| `research` | on | Lets it use web search for public background on the domain |

`research` is the one case where a run both reads pages and makes outbound requests. Turn it off to
keep everything inside the browser.

---

## Writing notes by hand instead

If you would rather describe a site yourself, upload a markdown file from the **Skills** tab:

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

Notes are **overlays**, not replacements: on a matching site they stack on top of whatever
Browsentic was already doing, so the normal driving and read-only rules still apply. Prefix an
instruction with `@acme-admin` to pin one regardless of where you are.

Notes live outside the repository, are re-read on every run so an edit applies to the next thing you
ask, and hand-written ones take precedence over generated ones.

```sh
browsentic skills    # everything currently in scope, and where it came from
```

---

## See also

- [Skills](/docs/guide/features/skills/) — how overlays and base skills fit together
- [Recordings](/docs/guide/features/recordings/) — a site map teaches it what a site *is*; a recording teaches it what *you do* there
- [internals/subsystems.md](/docs/internals/subsystems/) — staging, validation, and the sweep
