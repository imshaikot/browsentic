# Page actions

The 37 things Browsentic can do to a page. You never have to name these — you say what you want and
the agent picks — but knowing what exists tells you what is worth asking for.

Exact parameters for every one: [reference/tools.md](../../reference/tools.md).

---

## How targeting works

Most actions take a target described by **CSS selector, visible text, ARIA role or index**.

`page_getPageInfo` returns an inventory of links, buttons, fields and forms with a **stable selector
already computed** for each — so the agent uses those rather than guessing. Better still, targeting
by **visible text** survives redesigns that break CSS paths.

---

## Reading

| | |
| --- | --- |
| `page_getPageInfo` | The workhorse. Document metadata, viewport and scroll state, a semantic layout tree with a text diagram, the heading outline, and an inventory of every interactive element — each with its selector, its ARIA role, its live state (disabled, checked, expanded, filled, `aria-current`) and the landmark region it sits in |
| `page_extractText` | Rendered text of an element or the whole page, a sentence-aligned group at a time — long pages come back through a cursor rather than truncated. Raw HTML is [denied by default](../approvals.md) |
| `page_waitForElement` | Wait until an element is attached, visible, hidden or detached |
| `page_findProgress` | Scan for progress signals worth [monitoring](monitoring.md) |
| `page_findSearch` | Report whether this site has a search of its own, where its box is, and the URL a search lands on |
| `page_screenshot` | See [Screenshots](screenshots.md) |

## Clicking and typing

| | |
| --- | --- |
| `page_clickElement` | Clicks like a user, firing the full pointer and mouse sequence |
| `page_trustedClick` | A real browser-level click — `isTrusted` is true, dispatched through Chrome's debugger rather than from the page. The pointer travels to the target and dwells before pressing, so widgets that sample pointer movement get the sequence they wait for. For the handful of pages that reject synthetic clicks, and the browser features only a genuine gesture unlocks |
| `page_hoverElement` | Triggers menus, tooltips and hover states |
| `page_dragElement` | Drag one element onto another, or to a point |
| `page_focusInput` | Focus and place the caret, or select all |
| `page_fillInput` | Set a value in an input, textarea or contenteditable |
| `page_typeText` | Streams text one keystroke at a time at a human pace — a real key event per character, varying pauses, longer breaths after punctuation. For pages that *watch* you type |
| `page_selectOption` | Choose a `<select>` option by value, label or position |
| `page_selectText` | Select text by element or exact phrase |
| `page_pressKey` | A key press with optional modifiers |
| `page_submitForm` | Submit a form, firing its validation as if you pressed Enter. [Gated by default](../approvals.md) |
| `page_highlightElement` | A temporary outline overlay with an optional caption — for showing you what it found |

## Moving around

| | |
| --- | --- |
| `page_searchSite` | Search this site with its own search, by its search URL or its search box, and land on the results |
| `page_navigate` | Go to a URL, or back / forward / reload |
| `page_scrollTo` | To an element, an absolute position, or by one viewport |
| `page_openTab` | Open a URL in a new tab, which becomes the target for later actions unless `active: false` |
| `page_switchTab` | Bring another tab to the front. With no arguments it *lists* the open tabs and their ids |
| `page_closeTab` | Close a tab and report which one the browser moved to |

Tab tools are the only ones that change *which* tab everything else acts on, and they are scoped to
the current window. `closeTab` refuses deliberately in four cases: the only tab in a window, a
pinned tab, a browser page, and a tab being [recorded](recordings.md).

## Everything else

| Group | Tools | See |
| --- | --- | --- |
| Theming and accessibility | `page_readTheme`, `page_auditContrast`, `page_applyTheme` | [Theming](theming.md) |
| Captchas | `page_findCaptcha`, `page_solveCaptcha` | [Captchas](captcha.md) |
| Background watching | `page_startMonitor`, `page_monitorStatus`, `page_awaitMonitor`, `page_stopMonitor` | [Monitoring](monitoring.md) |
| Files | `page_listFiles`, `page_attachFile` | [Files](files.md) |
| Recordings | `page_listRecordings`, `page_readRecording` | [Recordings](recordings.md) |

---

## See also

- [reference/tools.md](../../reference/tools.md) — every parameter
- [Approvals](../approvals.md) — which of these pause and ask
- [internals/registry.md](../../internals/registry.md) — why the tool list can never describe something the browser cannot do
