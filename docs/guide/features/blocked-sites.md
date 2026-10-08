# Blocked sites

A list of sites Browsentic never reads or acts on, such as your bank, your mail or a company admin
console. The list is enforced inside the browser, so no agent, MCP client or Bridge setting can
loosen it.

Open settings from the sliders button at the top of the side panel or the popup, and pick
**Blocked sites**. It works without pairing.

---

## Writing a pattern

| Pattern | Blocks |
| --- | --- |
| `mybank.com` | The whole site: every subdomain, every page. `https://www.mybank.com/` is stored the same way |
| `mail.example.com` | That subdomain and anything below it, not the rest of `example.com` |
| `example.com/admin` | `/admin` and everything under it (`/admin/users`, `/admin?tab=2`), but not `/administrator` |
| `github.com/*/settings` | `*` stands for any run of characters, slashes included |
| `example.com/checkout*` | Every path that starts with `/checkout` |
| `shop.*` | The same name on any domain ending: `shop.com`, `shop.co.uk`, `www.shop.de` |
| `localhost:3000` | One port. Without a port, every port |

Matching ignores case and anything after `#`. The address is normalised before it is compared, so
`/%61dmin` and `//admin` both count as `/admin`. A path pattern with a query
(`example.com/search?q=private`) matches that query in that order. Only web pages can be blocked;
browser pages are out of reach anyway.

**Check a page**, at the bottom of the section, tells you which pattern, if any, blocks an address
you paste.

## What it stops

Everything Browsentic could do to a matching page, whoever asked:

- **Reading it**: page info, text, screenshots, the console and the network log.
- **Acting on it**: clicking, typing, filling, submitting, scrolling, code, downloads, captchas.
- **Going there**: `page_navigate` and `page_openTab` to a blocked address are refused before the
  browser loads it. A redirect or a click that lands somewhere blocked is caught after the fact, and
  nothing read there comes back.
- **Seeing it in passing**: a blocked tab is left out of the agent's tab list, never matched by name,
  and cannot be switched to or closed. A run started from a blocked tab does not send its address.
- **Your own tools**: [instant commands](instant-commands.md), saved tools, the ones set to run on
  every visit, [A-Eye](a-eye.md), **Attach page** and [recording](recordings.md) all refuse it too.
- **Things already running**: a [monitor](monitoring.md) or a [diagnostics](diagnostics.md) capture
  ends when its tab moves onto a blocked site (the capture discards what it collected), a recording
  stops before the blocked page is written into it, and a [scheduled task](scheduling.md) that would
  open one fails instead of starting.

The agent gets `SITE_BLOCKED` and is told to stop, not to look for another way in. The side panel
shows a banner while the active tab is blocked; the agent can still work in other tabs.

## Why nothing can override it

The list lives in this browser's extension storage and nowhere else. No message from the Bridge can
read or write it, and the extension checks it inside the browser before every page action, so neither
the agent, an MCP client, nor an edit to `~/.browsentic/config.json` can loosen it. The content script
in the page checks it a second time, and the agent cannot steer a tab to the settings page to edit it:
page actions refuse anything that is not an http(s) page.

That makes it different from [approvals](../approvals.md), which the Bridge applies and you can tune
per run. A blocked site is not something the agent can ask for.

## Edges

- **Per browser.** Each paired browser keeps its own list, and the desktop apps do not show it.
- **A different address is a different site.** A site's IP address, or another of its domains, needs
  its own pattern.
- **Code on an allowed page can still send the page somewhere blocked.** Every action stops once the
  tab is there, but Browsentic cannot stop the page's own requests.
- **A blocked frame inside an allowed page** cannot be entered or acted on, but it can still appear in
  a screenshot of the page around it.
- **Saved tools that run on every visit** check for a blocked path from inside the page, where the
  page's own code could interfere; a site blocked as a whole never gets the tool at all.
- Up to 500 patterns, each up to 200 characters.
