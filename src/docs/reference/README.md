---
layout: layouts/doc.njk
pageKey: docs
title: "Reference"
seoTitle: "Reference — Browsentic reference"
description: "Lookup tables. Nothing here explains a workflow — see the user guide for that, or internals for how it works."
deck: "Lookup tables. Nothing here explains a workflow — see the user guide for that, or internals for how it works."
docsPath: "reference/README.md"
section: "reference"
sectionLabel: "Reference"
sectionOrder: 3
order: -1
isIndex: true
permalink: "/docs/reference/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/reference/README.md"
---
| | |
| --- | --- |
| [Tools](/docs/reference/tools/) | All 41 MCP tools with their parameters, the three read-only resources, and the reserved actions that never become tools |
| [CLI](/docs/reference/cli/) | Every `browsentic` command |
| [Errors](/docs/reference/errors/) | Every error code, where it comes from, and what to do about it |

The tool list is generated from [`src/lib/actions/registry.ts`](https://github.com/imshaikot/browsentic/blob/main/src/lib/actions/registry.ts). The
machine-readable copy is always one command away:

```sh
yarn daemon:manifest
```
