# Browsentic — site and documentation

The marketing site and the rendered documentation for
[Browsentic](https://github.com/imshaikot/browsentic), published to **https://browsentic.com**.

Static HTML. No React, no client-side router, no hydration. One 2 KB script, and it is entirely
progressive: every page is complete and navigable with JavaScript blocked.

> **Working on this with Claude Code?** The `browsentic-website` skill on `main`
> (`.claude/skills/browsentic-website/SKILL.md`) is the companion to this file.

## This branch is deliberately not `main`

`website` is an **orphan branch**, created with `git worktree add --orphan`, so it shares no
commit, no file and no history with `main`. That is the whole separation mechanism:

```
main      ──●──●──●──●──   extension + daemon. No site source.
website   ──○──○──○──      this branch. Eleventy site + docs sync + deploy pipeline.
```

`git merge-base website main` prints nothing and exits non-zero. Nothing here can reach `main`
except by an explicit, deliberate cherry-pick.

## Working on it locally

Use a worktree, so `main` stays checked out in your usual directory:

```sh
git worktree add ../browsentic-site website
cd ../browsentic-site
npm install
npm run dev          # http://localhost:8080
```

The package manager here is **npm**, not the Yarn 4 that `main` pins.

## Layout

```
src/
  _data/
    copy.js            every fact on the marketing pages, in one file
    site.js            origin, version, nav, footer — the information architecture
    eleventyComputed.js  per-page JSON-LD (WebSite, SoftwareApplication, Breadcrumb, TechArticle, FAQ, HowTo)
  _includes/
    layouts/base.njk   <head>, nav, footer — every page passes through here
    layouts/page.njk   marketing pages
    layouts/doc.njk    docs: sidebar, breadcrumbs, TOC, prev/next
    partials/macros.njk  section, hero, card, button, command, code block
  docs/                SYNCED from main — do not edit by hand (see below)
  css/main.css         design tokens + prose styles. Tailwind v4, no config file
  js/site.js           the only script: nav condense, mobile sheet, copy, TOC highlight
  *.njk                one file per page
scripts/
  sync-docs.mjs        pulls docs/ out of main, rewrites links, injects front matter
  verify.mjs           gates the build (see below)
  vercel-output.mjs    packs _site into Build Output API format
  deploy.sh            the whole pipeline
```

### Pages

Ten marketing pages, each owning one keyword cluster, plus 41 documentation pages.

| URL | What it is for |
| --- | --- |
| `/` | the hub, linking out to every segment |
| `/how-it-works/` | architecture: the four hops, why there is a daemon |
| `/capabilities/` | all 41 page tools, grouped |
| `/mcp-server/` | driving it from Claude Code, Cursor, Zed, Codex |
| `/orchestration/` | several tabs, several agents, one browser |
| `/automations/` | the jobs people hand over |
| `/skills/` | site maps, recordings, intent routing |
| `/security/` | the security model and the two limits |
| `/install/` | four steps, with `HowTo` structured data |
| `/faq/` | the accordion, with `FAQPage` structured data |
| `/docs/**` | the whole `docs/` tree from `main`, rendered |

Copy for the marketing pages lives in `src/_data/copy.js`. **Templates hold no copy of their own** —
changing text means editing one file.

**The tool count is load-bearing.** `TOOL_GROUPS` holds 41 tool names and the hero, the stat bar
and several headings all say "41". Add a tool on `main` and those go stale. `yarn mcp:manifest`
on `main` prints the real list.

## The docs are synced, not authored here

`src/docs/` is **generated**. `scripts/sync-docs.mjs` copies `docs/` out of the `main` worktree and:

- injects front matter (title, deck, meta description, section, order, permalink, GitHub edit link)
- rewrites every relative link for the web tree — `guide/install.md` becomes `/docs/guide/install/`
- rewrites anything that escapes `docs/` (`../../lib/actions/registry.ts`) to a GitHub URL
- lifts the opening paragraph out as a deck, so the page header does not repeat the body
- copies `docs/assets/` alongside

Edit documentation **on `main`**, then re-sync:

```sh
npm run sync:docs     # looks for ../browsentic/docs, or set DOCS_SRC
```

The synced copy is committed, so a build never depends on `main` being checked out next door.

## Design

Dark ground, dot lattice, one hot accent used sparingly — and the ground is **warm**: every
neutral carries a low-chroma amber hue near 50°, not a cool near-black. Tokens are declared in a
Tailwind v4 `@theme` block in `src/css/main.css`. There is no `tailwind.config.js`.

**Four rules that are easy to break.**

- **Tailwind only sees whole class names.** `text-{{ accent }}` produces nothing. Accents are looked
  up from the `ACCENT` table at the top of `partials/macros.njk`, which holds complete strings.
- **`.text-gradient` stays warm.** An ink → brand → ember ramp crosses two near-complementary hues
  and greys out at the midpoint. The ramp is ink → amber → ember for that reason.
- **No em dashes in site copy.** `npm run check:copy` fails the build on one. `src/docs/` is exempt,
  because it is synced verbatim from `main` and follows that repository's conventions.
- **Fonts are self-hosted**, latin subsets only, in `public/fonts/`. `npm run fonts` regenerates
  them and `src/css/fonts.css`. Third-party font CSS is render-blocking from a host we do not control.

## The build gates itself

`npm run build` runs sync → copy check → Eleventy → Tailwind → `scripts/verify.mjs`, which asserts
across all 52 pages:

- a `<title>`, a meta description of a sensible length, a canonical link, an `og:image`
- exactly one `<h1>`
- JSON-LD that actually parses
- no unrendered template syntax, no leaked `undefined`, no `<img>` without `alt`
- every internal link resolves to a real file
- every sitemap URL has a page behind it

A failure here exits non-zero, so a broken deploy cannot leave this machine.

## Deploying

The pipeline runs **locally**. Nothing is built on Vercel's side.

```sh
npm run deploy:preview     # throwaway URL
npm run deploy -- --prod   # production, browsentic.com
```

`scripts/deploy.sh` builds, verifies, packs `_site/` into
[Build Output API](https://vercel.com/docs/build-output-api/v3) format via `scripts/vercel-output.mjs`,
then runs `vercel deploy --prebuilt`. Headers, caching and redirects come from `vercel.json`, which
stays the single source of truth for both the prebuilt path and a future git-driven one.

Set a different origin with `SITE_ORIGIN` — every absolute URL, the canonical tags, the sitemap and
the JSON-LD are built from it:

```sh
SITE_ORIGIN=https://staging.browsentic.com npm run build
```

### GitHub Pages is retired

The site used to live at `https://imshaikot.github.io/browsentic/`. Two live copies of the same
content compete in search, so that host now serves the stub in `pages-redirect/`: every page
carries `rel=canonical` pointing at `browsentic.com` and redirects there **preserving the path**,
so `/browsentic/docs/guide/install/` lands on `/docs/guide/install/`.

`.github/workflows/pages.yml` publishes only that stub, and only when `pages-redirect/**` changes.

## Commands

| command | does |
| --- | --- |
| `npm run dev` | Eleventy + Tailwind in watch mode on :8080 |
| `npm run build` | sync, check, build, minify, verify |
| `npm run sync:docs` | re-pull `docs/` from `main` |
| `npm run check:copy` | fail on banned punctuation in site copy |
| `npm run verify` | run the gate against an existing `_site/` |
| `npm run fonts` | re-vendor the latin font subsets |
| `npm run og` | re-render `public/og.png` (needs Chrome) |
| `npm run pack` | build the `.vercel/output` directory without deploying |
| `npm run deploy` | the whole pipeline, preview by default |

## Rules

1. **Never commit site files to `main`.** If `git status` in that checkout shows `src/*.njk`, you
   are in the wrong worktree.
2. **Never create a `gh-pages` branch.**
3. **Copy goes in `src/_data/copy.js`**, not in a template.
4. **Never hand-edit `src/docs/`.** Edit on `main` and re-sync.
5. **Do not commit `_site/` or `.vercel/`.**
6. Confirm before `npm run deploy -- --prod` — it publishes to the live domain.
