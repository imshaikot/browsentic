# Browsentic — landing page

The marketing site for [Browsentic](https://github.com/imshaikot/browsentic), published to
GitHub Pages at **https://imshaikot.github.io/browsentic/**.

> **Working on this with Claude Code?** The `browsentic-website` skill on `main`
> (`.claude/skills/browsentic-website/SKILL.md`) covers the branch layout, the
> section map, the design tokens and the deploy pipeline in one place.

## This branch is deliberately not `main`

`website` is an **orphan branch**. It was created with `git worktree add --orphan`, so it shares
no commit, no file and no history with `main`. That is the whole separation mechanism:

```
main      ──●──●──●──●──   extension + daemon. No website source, no Pages workflow.
website   ──○──○──○──      this branch. Vite app + .github/workflows/pages.yml
```

- `git log main..website` and `git log website..main` are both meaningless — there is no merge base.
- Nothing here can reach `main` except by an explicit, deliberate cherry-pick.
- There is **no `gh-pages` branch**. Pages is configured with *Source: GitHub Actions*, so CI
  uploads the built site as an artifact and Pages serves it. No compiled asset is committed anywhere.

### Nothing to configure by hand

The build step runs `actions/configure-pages` with `enablement: true`, which turns Pages on
through the API and points it at Actions when it is not already set. The first push to `website`
therefore both enables Pages and publishes to it.

If your org blocks Actions from enabling Pages, the run fails on that step — set
**Settings → Pages → Build and deployment → Source = "GitHub Actions"** once by hand and re-run.

## Working on it locally

Use a worktree so `main` stays checked out in your usual directory and you never switch branches:

```sh
git worktree add ../browsentic-site website
cd ../browsentic-site
npm install
npm run dev          # http://localhost:5173/browsentic/
```

Both directories are the same clone, sharing one `.git`. `git worktree list` shows them; to detach
later, `git worktree remove ../browsentic-site`.

Note the `/browsentic/` in the URL: the app is built with `base: '/browsentic/'` because Pages
serves it from a subpath. The dev server mirrors that so links behave the same locally.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type check, then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run compile` | Type check only |
| `npm run og` | Re-render `public/og.png` (needs Chrome; see below) |

## Deployment

`.github/workflows/pages.yml` runs on every push to `website`:

1. refuses to run on any other branch,
2. `npm ci`, type check, `npm run build`,
3. asserts `dist/index.html` is non-empty,
4. uploads the artifact and deploys it to Pages.

Pull requests targeting `website` build and type check but do not deploy.

## Content lives in one file

Every fact on the page — capability counts, tool names, security claims, quickstart steps, FAQ —
comes from [`src/data/content.ts`](src/data/content.ts), and every fact there comes from the
README and `docs/` on `main`. Components hold no copy of their own, so keeping the site honest
means editing that one file when the product changes.

## Assets

- **Favicons** (`public/icon/*.png`) are the extension's own icons, generated on `main` by
  `node scripts/generate-icons.mjs`. When they change there, copy the five PNGs across.
- **`public/og.png`** is the social card, rendered from `scripts/og.html` by headless Chrome via
  `npm run og`. It is committed, so CI never needs a browser. Re-run it by hand when the copy or
  the mark changes.

## Moving to a custom domain

1. Add `public/CNAME` containing the domain.
2. Change `BASE_PATH` in the workflow to `/` (the apex serves from the root).
3. Update the absolute `og:url` / `og:image` URLs in `index.html`.

## Stack

Vite 6, React 19, Tailwind CSS v4, [Motion](https://motion.dev), lucide-react. No runtime
dependencies beyond React and Motion; the output is static HTML, CSS and one JS bundle.
