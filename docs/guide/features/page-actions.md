# Page actions

The 52 page tools the agent uses to read, click, type, move between tabs and script a page. You do
not name them in an instruction, since the agent picks the tool, but knowing what exists tells you
what is worth asking for.

Every parameter is in [reference/tools.md](../../reference/tools.md).

---

## How targeting works

Most actions take a target as a **CSS selector, visible text, ARIA role or index**.

`page_getPageInfo` returns an inventory of links, buttons, fields and forms with a **stable selector
already computed** for each, so the agent uses those instead of guessing. Targeting by **visible
text** is sturdier still: it survives redesigns that break CSS paths.

---

## Reading

| | |
| --- | --- |
| `page_getPageInfo` | The main snapshot. Document metadata, viewport and scroll state, a text diagram of the landmark regions with a selector for each, the heading outline, and an inventory of every interactive element with its selector, its ARIA role, its live state (disabled, checked, expanded, filled, `aria-current`) and the landmark region it sits in |
| `page_extractText` | Rendered text of an element or the whole page, a sentence-aligned group at a time; long pages come back through a cursor instead of being truncated. Raw HTML is [denied by default](../approvals.md) |
| `page_waitForElement` | Wait until an element is attached, visible, hidden or detached |
| `page_findProgress` | Scan for progress signals worth [monitoring](monitoring.md) |
| `page_findSearch` | Report whether this site has a search of its own, where its box is, and the URL a search lands on |
| `page_pickElement` | Hand the page over and let the user point at the element they mean. See [A-Eye](a-eye.md) |
| `page_screenshot` | See [Screenshots](screenshots.md) |

## Clicking and typing

| | |
| --- | --- |
| `page_clickElement` | Clicks like a user, firing the full pointer and mouse sequence |
| `page_trustedClick` | A real browser-level click: `isTrusted` is true, because it is dispatched through Chrome's debugger instead of from the page. The pointer travels to the target and pauses before pressing, so widgets that sample pointer movement get the sequence they wait for. For the few pages that reject synthetic clicks, and the browser features only a genuine gesture unlocks |
| `page_hoverElement` | Triggers menus, tooltips and hover states |
| `page_dragElement` | Drag one element onto another, or to a point |
| `page_focusInput` | Focus and place the caret, or select all |
| `page_fillInput` | Set a value in an input, textarea or contenteditable |
| `page_typeText` | Types one keystroke at a time at a human pace: a real key event per character, varying pauses, longer pauses after punctuation. For pages that *watch* you type |
| `page_selectOption` | Choose a `<select>` option by value, label or position |
| `page_selectText` | Select text by element or exact phrase |
| `page_pressKey` | A key press with optional modifiers |
| `page_submitForm` | Submit a form, firing its validation as if you pressed Enter. [Gated by default](../approvals.md) |
| `page_highlightElement` | A temporary outline overlay with an optional caption, to show you what the agent found |

## Moving around

| | |
| --- | --- |
| `page_searchSite` | Search this site with its own search, by its search URL or its search box, and land on the results |
| `page_navigate` | Go to a URL, or back / forward / reload |
| `page_scrollTo` | To an element, an absolute position, or by one viewport |
| `page_openTab` | Open a URL in a new tab, which becomes the target for later actions unless `active: false` |
| `page_switchTab` | Bring another tab to the front. With no arguments it *lists* the open tabs and their ids |
| `page_closeTab` | Close a tab and report which one the browser moved to |

Only the tab tools change *which* tab every other tool acts on, and they are scoped to the current
window. `closeTab` refuses in four cases: the only tab in a window, a pinned tab, a browser page,
and a tab being [recorded](recordings.md).

## Repeating a job, and doing what no tool covers

Two tools cover what the fixed toolset handles badly. Repeating a sequence twenty times with only the
input changing (creating twenty tags, archiving every row) takes twenty slow, fragile rounds of
wait, find, click and verify. And some jobs no tool covers: seeking a video to a timestamp, reading
pixels off a canvas, driving an editor's own API.

**Both are off until you switch them on** with the composer's **Live tool** switch, the `</>`
button beside the message box. While it is off the agent cannot reach these tools, is not told they
exist, and gets `LIVE_TOOLS_OFF` if it tries; only your own click turns it on. With it on, the agent
decides whether the job warrants a script.

`page_injectCode` then asks to install a small toolkit of JavaScript functions in the page. **You
review the source and approve it**: the prompt in the side panel has a **Review** button that opens
the full code. `page_runCode` then calls one of those functions with new arguments, as often as the
job needs, without asking again.

The approval covers that code, on that tab, on that site. Later calls reach only the functions you
read, with new arguments. An injection has no "always on this site" option, because that would
authorise code you never saw. On another site the toolkit stops working.

The agent is told to use this only when a task repeats three or more times or nothing else can do
the job; a one-off click is cheaper as a click. See [Approvals](../approvals.md) and
[reference/tools.md](../../reference/tools.md#scripting).

### Keeping one

A second after a toolkit installs, the panel offers to keep it as a tool of your own. Accept, and it
is named after where it belongs (for example `youtube.com:watch:darken-page-except-video-player`)
and runs whenever you type `/` on that site and pick it: no agent, no round trip and no second
approval, because you already read the code.

Only a zero-argument function can be kept, because `/` passes nothing; a toolkit whose entry point
takes arguments stays a one-off.

Scope is the host plus the first path segment. A tool made on a `/watch` page is offered on every
`/watch` page of that host, nowhere else on the host, and never on another host.

The two halves are stored separately. The JavaScript stays in the extension's own storage. Browsentic
Bridge gets only a markdown note saying the tool exists and what it does, so the agent can point you
to it instead of writing it again. A saved tool is not a page action, so no MCP client can call one.

Type `/remove-tools` for the list, with a cross beside each tool. Removing one deletes the code from
the browser and the note from the Bridge together.

### Running one on every visit

The same prompt has a switch, off by default: **Also run it on every visit to youtube.com/watch**.
With it on, the tool runs by itself each time you arrive in its scope: on a page load, or when a
site that never reloads (YouTube, Gmail) moves you there from elsewhere on it. Moving between two
pages inside the scope is not a new arrival. The tool runs once the page has loaded and its content
has stopped changing, waiting at most three seconds, because that is the state you watched it work
in. `/remove-tools` has the same switch beside each tool, to turn it off or to turn it on for a tool
you kept earlier.

Only the code you approved runs, in the page's own world. Chrome injects it as a user script, so
there is no debugging bar, DevTools can stay open, and it keeps running after the browser restarts.
The Bridge's note about the tool says it runs on every visit, so the agent knows its effect is
usually already on the page. A tool that throws on some visit logs a line starting `Browsentic:` in
the page's console, and the page carries on.

**Chrome needs one switch of its own first.** Open `chrome://extensions`, then Browsentic's
**Details**, and turn on **Allow User Scripts**. Chrome before 138 uses Developer mode instead, the
switch at the top right of `chrome://extensions`. Until Chrome allows it, the panel says so and
offers to open that page; the tool remembers that it should run on every visit. It starts within a
couple of seconds of Chrome allowing it, or within a minute if the side panel is closed. Like live
tools themselves, this is Chrome-only.

## Everything else

| Group | Tools | See |
| --- | --- | --- |
| Theming and accessibility | `page_readTheme`, `page_auditContrast`, `page_applyTheme` | [Theming](theming.md) |
| Captchas | `page_findCaptcha`, `page_solveCaptcha` | [Captchas](captcha.md) |
| Diagnostics | `page_startDiagnostics`, `page_readConsole`, `page_readNetwork`, `page_stopDiagnostics` | [Diagnostics](diagnostics.md) |
| Background watching | `page_startMonitor`, `page_monitorStatus`, `page_awaitMonitor`, `page_stopMonitor` | [Monitoring](monitoring.md) |
| Scheduled jobs | `page_startTimer`, `page_timerStatus`, `page_stopTimer` | [Scheduling](scheduling.md) |
| Files | `page_listFiles`, `page_attachFile`, `page_captureDownload`, `page_listDownloads` | [Files](files.md) |
| Recordings | `page_listRecordings`, `page_readRecording` | [Recordings](recordings.md) |

---

## See also

- [reference/tools.md](../../reference/tools.md): every parameter
- [Approvals](../approvals.md): which of these pause and ask
- [internals/registry.md](../../internals/registry.md): why the tool list can never describe something the browser cannot do
