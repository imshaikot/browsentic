# Files

Putting a file you have into a file input on a page.

---

## How it works

Attach a file in the side panel. Browsentic reads it **once, at attach time**, and keeps notes about
what it is.

From then on the agent sees those notes — never your filesystem — plus two tools:

| | |
| --- | --- |
| `page_listFiles` | Re-read the list, with each file's summary |
| `page_attachFile` | Put one into an `<input type="file">` on the page |

So the agent knows what it is uploading without being able to open anything you did not hand it.

---

## Uploading is gated

`page_attachFile` is a `confirm` by default under the `file-upload` rule: putting a file into a page
hands it to whoever runs that site.

For an [MCP client](../mcp-clients.md), which cannot answer a prompt, it is refused outright.

---

## See also

- [Approvals](../approvals.md) — the `file-upload` rule
- [reference/tools.md § Files](../../reference/tools.md#files) — parameters
