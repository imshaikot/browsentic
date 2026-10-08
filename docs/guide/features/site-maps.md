# Site maps

A site map is a set of notes the agent writes from one exploration of a site. After you activate it,
every later run on that domain starts out knowing where search lives, what a button is really called
and why a list looks empty until you scroll, instead of spending its first minutes rediscovering them.

---

## Making one

Press **Map this site** in the side panel's **Skills** tab, or say:

```
@site-mapper map this site
```

Mapping needs the explicit `@site-mapper` prefix or the button. Trigger words alone will not start
one, because a mapping run takes minutes and takes over the tab.

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

From then on, every instruction you give on that domain carries those notes. Elsewhere they have no
effect.

---

## Nothing takes effect until you say so

A map in progress is written to a staging directory the skill loader **cannot read**, so an
unreviewed map is never even opened, let alone used.

The panel shows you the exact markdown as plain text, never rendered, with the domain it will match.
**Activate** turns it on; **Discard** deletes it. The review appears on the conversation that mapped
the site, so switch back to that tab to decide. If that tab closes first, the review follows you, so
an unsaved map is never lost.

> A map is written from pages an agent read, so read it before activating, as you would any
> generated content.

---

## What a mapping run may do

The crawl is **read-only and locked to one host**. It cannot click, fill or submit, and it cannot
leave the site. It is pinned to the tab it started in, so switching tabs stops it instead of taking
it with you. Off the host, every read is blocked until it navigates back.

Browsentic Bridge enforces the limits, and [config](../configuration.md) can narrow them but never
widen them:

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

To describe a site yourself, upload a markdown file from the **Skills** tab:

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

Notes are **overlays**: on a matching site they stack on top of whatever Browsentic was already
doing, so the normal driving and read-only rules still apply. Prefix an instruction with
`@acme-admin` to apply one wherever you are.

Notes live outside the repository and are re-read on every run, so an edit applies to the next thing
you ask. Hand-written notes take precedence over generated ones.

```sh
browsentic skills    # everything currently in scope, and where it came from
```

---

## See also

- [Skills](skills.md): how overlays and base skills fit together
- [Recordings](recordings.md): what you do on a site, where a site map describes the site itself
- [internals/subsystems.md](../../internals/subsystems.md): staging, validation, and the sweep
