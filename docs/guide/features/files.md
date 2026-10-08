# Files

How the agent works with files: reading a file you attach, uploading a file to a page, and capturing
a file a page downloads. Both directions ask for your approval by default.

---

## Files you hand it

Attach a file in the side panel: press **Attach a file** on the composer, or **drop files anywhere on
the panel** (several at once). The file belongs to **the conversation in that tab**: its chip shows
there and nowhere else, and only that conversation's agent hears about it.

Each file gets its own **file analyst**: a separate one-shot session of the agent you picked, started
the moment you attach, with no browser and nothing to open but that one file. It writes a report and
ends. The process is stopped as soon as the report is in, its copy of the file is deleted, and Claude
Code and Codex are told not to keep the session.

What it reads:

| Kind | Up to | On |
| --- | --- | --- |
| Text (CSV, JSON, Markdown, logs, code, anything in UTF-8) | 5 MB | every agent |
| PDF | 10 MB | Claude Code, Cursor CLI |
| Images (PNG, JPEG, GIF, WebP) | 5 MB | Claude Code, Codex, Cursor CLI |

The bytes decide the kind, not the name: a PNG called `notes.txt` is read as an image. Anything else
(a program, audio, video, or a ZIP archive, which Word, Excel and PowerPoint files also are) is
turned away before any agent starts, and so is anything over 10 MB, which the browser does not store.

Every file ends with one of three verdicts, and its chip says which:

| Verdict | The chip shows | |
| --- | --- | --- |
| **analyzed** | its summary | Read. The report holds a summary, the file's outline, the specifics worth keeping and terse notes |
| **rejected** | the reason, in amber | Not a file Browsentic reads, or one that would not open (encrypted, corrupted). Trying again changes nothing |
| **failed** | the reason, in red, and **Retry** | The analyst broke: it timed out, or the agent could not start. Retry reads it again |

The report reaches the agent **once**, inside the next message you send in that conversation, so it
becomes part of the agent's own session and every later turn still has it. A rejected or failed file
is reported too, with its reason, so the agent can tell you why it cannot answer from it. The
timeline marks the hand-over:

```
Handed to the agent: expenses.csv — analyzed · backup.zip — rejected (unsupported type)
```

Send while a file is still being read and the turn waits for it, with a `readFile` row on the
timeline. A file attached during a run reaches the agent with your next message, because a running
agent cannot be given anything new. Switch to another agent, or start a conversation it cannot
resume, and it is given every report again, since it holds none of them.

The agent never sees your filesystem or the file itself. It gets the report, plus two tools:

| | |
| --- | --- |
| `page_listFiles` | List the stored files, with each one's summary |
| `page_attachFile` | Put one into an `<input type="file">` on the page |

So the agent knows what it is uploading without being able to open anything you did not hand it.
Removing a chip stops its analyst if it is still reading, and a conversation's files are deleted
with it when it leaves history.

---

## Files it takes off a page

`page_captureDownload` runs one action and keeps whatever the browser downloads as a result:

```
download the CSV export and attach it to the ticket
open my latest invoice and save the PDF
```

It works two ways. Give it a **`target`** and it clicks (an "Export CSV" button, a "Download invoice"
link) and waits for the download the click produces. That is the case that matters: an export has no
URL worth fetching, because the file exists only as a result of the click. Give it a **`url`**
instead and the file is fetched **in the browser's own session**, with your cookies. A fetch from
Browsentic Bridge would be anonymous, which for a logged-in invoice means fetching the login page.

| | |
| --- | --- |
| `page_captureDownload` | Click something, or fetch a URL, and keep what lands |
| `page_listDownloads` | What has been captured, with notes on each |

The bytes go to **`~/browsentic/download/`** at mode `0600`, as [screenshots](screenshots.md) do, and
the result reports the path so you can open it.

The agent gets **notes**, never the bytes:

```
expenses-2026-08.csv — text/csv, 8.1 KB — 42 rows × 6 columns
```

That is enough to know what it captured and pass it on, but not to read it. The agent still has no
filesystem: the spawned CLI runs sealed, and this does not change that.

---

## Download here, upload there

`page_attachFile` takes a `downloadId` wherever it takes a `fileId`, so a captured file can go
straight into another page:

```
grab the report from the admin panel and attach it to issue 412
```

The file goes page → disk → page. It never passes through the agent or your clipboard.

---

## What it will not keep

Three refusals, all final, and each one **deletes the file the browser already wrote**, because
refusing an installer achieves nothing if the installer stays on disk.

| | |
| --- | --- |
| **Executables** | `.exe`, `.dmg`, `.msi`, `.sh`, `.ps1`, `.apk`, `.jar` and the rest. `DOWNLOAD_REFUSED`. An installer offered by a page carries a different risk from a CSV export, and getting that wrong has no safe outcome |
| **Anything over 100 MB** | `DOWNLOAD_TOO_LARGE`. Measured from the file on disk, not from what the page claimed |
| **Off-scope hosts** | `DOWNLOAD_OFF_SCOPE`. A download from a host this run was never pointed at, judged the same way [`off-scope-navigation`](../approvals.md#scope-which-sites-a-run-may-reach) judges a navigation |

The host of a *clicked* download is known only once it has landed, so that one is refused after the
fact instead of confirmed beforehand. A `url` you pass directly is checked up front like any other
navigation, so an off-scope one asks you first.

Captures are swept after **14 days**; they are larger than screenshots and pile up the same way.

```sh
browsentic downloads          # what has been captured, and where
browsentic downloads clear    # delete all of it
```

`downloadDir` and `downloadTtlDays` in [config](../configuration.md#paths) move the folder and
change the expiry.

---

## Both directions are gated

| | |
| --- | --- |
| `file-upload` | `page_attachFile`: putting a file into a page hands it to whoever runs that site |
| `file-download` | `page_captureDownload`: letting a page write a file to your disk |

Both are `confirm` by default. An [MCP client](../mcp-clients.md) cannot answer a prompt, so for one
both are refused outright.

They are the same rule in opposite directions, gated for the same reason: an agent that reads an
injected instruction can be told to fetch something, or to send something.

---

## See also

- [Approvals](../approvals.md): the `file-upload` and `file-download` rules
- [Screenshots](screenshots.md): the other thing that lands in `~/browsentic/`
- [reference/tools.md § Files](../../reference/tools.md#files): parameters
