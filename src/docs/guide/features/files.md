---
layout: layouts/doc.njk
pageKey: docs
title: "Files"
seoTitle: "Files — Browsentic features"
description: "Getting a file into a page, and getting one back out. Attach a file in the side panel. Browsentic reads it once, at attach time, and keeps notes about what…"
deck: "Getting a file into a page, and getting one back out."
docsPath: "guide/features/files.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 11
isIndex: false
permalink: "/docs/guide/features/files/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/files.md"
---
---

## Files you hand it

Attach a file in the side panel. Browsentic reads it **once, at attach time**, and keeps notes about
what it is.

From then on the agent sees those notes — never your filesystem — plus two tools:

| | |
| --- | --- |
| `page_listFiles` | Re-read the list, with each file's summary |
| `page_attachFile` | Put one into an `<input type="file">` on the page |

So the agent knows what it is uploading without being able to open anything you did not hand it.

---

## Files it takes off a page

`page_captureDownload` runs one action and keeps whatever the browser downloads as a result:

```
download the CSV export and attach it to the ticket
open my latest invoice and save the PDF
```

Two mechanics, one tool. Give it a **`target`** and it clicks — an "Export CSV" button, a "Download
invoice" link — and waits for the transfer the click produces. That is the case that matters: an
export has no URL worth fetching, because the file only exists as a consequence of the click. Give
it a **`url`** instead and the file is fetched **in the browser's own session**, with your cookies.
A daemon-side fetch would be anonymous, which for a logged-in invoice means fetching the login page.

| | |
| --- | --- |
| `page_captureDownload` | Click something, or fetch a URL, and keep what lands |
| `page_listDownloads` | What has been captured, with notes on each |

The bytes go to **`~/browsentic/download/`** at mode `0600`, the same convention as
[screenshots](/docs/guide/features/screenshots/), and the result reports the path so you can open it.

The agent gets **notes**, never the bytes:

```
expenses-2026-08.csv — text/csv, 8.1 KB — 42 rows × 6 columns
```

Enough to know what it captured and hand it on. Not enough to read it, and it still has no
filesystem: the spawned CLI runs sealed, and that does not change for this.

---

## Download here, upload there

`page_attachFile` takes a `downloadId` wherever it takes a `fileId`, which closes the loop:

```
grab the report from the admin panel and attach it to issue 412
```

The file goes page → disk → page. It never passes through the agent, and never through your
clipboard.

---

## What it will not keep

Three refusals, all of them final, and all of them **delete the file the browser already wrote** —
refusing an installer is worth nothing if the installer stays on the disk.

| | |
| --- | --- |
| **Executables** | `.exe`, `.dmg`, `.msi`, `.sh`, `.ps1`, `.apk`, `.jar` and the rest. `DOWNLOAD_REFUSED`. A page that says "download this installer" is a different proposition from one that says "here is your CSV", and there is no version of getting that wrong that ends well |
| **Anything over 100 MB** | `DOWNLOAD_TOO_LARGE`. Measured from the file on disk, not from what the page claimed |
| **Off-scope hosts** | `DOWNLOAD_OFF_SCOPE`. A download from a host this run was never pointed at, judged the same way [`off-scope-navigation`](/docs/guide/approvals/#scope-which-sites-a-run-may-reach) judges a navigation |

The host of a *clicked* download is only knowable once it has landed, so that one is refused after
the fact rather than confirmed before it. A `url` you pass directly is checked up front like any
other navigation, and confirms.

Captures are swept after **14 days** — they are bigger than screenshots and accumulate the same way.

```sh
browsentic downloads          # what has been captured, and where
browsentic downloads clear    # delete all of it
```

`downloadDir` and `downloadTtlDays` in [config](/docs/guide/configuration/#paths) move the folder and
change the expiry.

---

## Both directions are gated

| | |
| --- | --- |
| `file-upload` | `page_attachFile` — putting a file into a page hands it to whoever runs that site |
| `file-download` | `page_captureDownload` — letting a page write a file to your disk |

Both are `confirm` by default. For an [MCP client](/docs/guide/mcp-clients/), which cannot answer a prompt,
both are refused outright.

They are the same rule pointing in opposite directions, and they are gated for the same reason: an
agent reading an injected instruction is an agent that can be told to fetch something, or to send
something.

---

## See also

- [Approvals](/docs/guide/approvals/) — the `file-upload` and `file-download` rules
- [Screenshots](/docs/guide/features/screenshots/) — the other thing that lands in `~/browsentic/`
- [reference/tools.md § Files](/docs/reference/tools/#files) — parameters
