# Approvals and guardrails

Which agent actions wait for your approval, which are refused outright, and how to change either in
`config.json` or the settings page.

In short: reading and clicking need no approval, anything that commits something or sends data
somewhere pauses and asks, and a handful of things are refused whatever you say.

---

## In the panel

When a run reaches a gated action, it stops and shows a card naming what it was about to do and why
that is gated. The card has three buttons:

| | |
| --- | --- |
| **Allow** | Once. |
| **Deny** | Final. The agent is told to report it and stop, and not to find another route to the same effect. |
| **Always on ‹host›** | Allow, and stop asking for *that action on that host*. |

**Always on ‹host›** is for a prompt you keep clicking through, such as a captcha checkbox on a site
you use daily or Enter-to-submit on a search box. The grant is a pair, one action and one host,
keyed to the site the run started on. It is written to `~/.browsentic/approvals.json` (mode `0600`),
survives restarts, and **only ever short-circuits a `confirm`**. A `deny` stays denied, because
denies are the ones you are not meant to be able to click past. The button is hidden when a run has
no single site to attach a grant to.

**A card the agent stops waiting for is withdrawn.** If the agent's CLI gives up on the call, the
run is stopped, or the agent moves on to something else, the card comes down and an answer after
that does nothing: an approval never runs an action the agent is no longer waiting on. Cursor CLI
gives up on any call after a minute, so there an unanswered card is handed back to the agent, which
asks again under the same card until you decide.

```sh
browsentic approvals              # what no longer asks
browsentic approvals clear        # forget all of them
browsentic approvals clear a.com  # forget one site's
```

---

## The rules

The policy is a table of rules, each naming a condition and an effect. Every rule whose condition
matches is collected and **the most severe effect wins**, so the outcome does not depend on
declaration order.

| Rule id | Fires when | Default |
| --- | --- | --- |
| `reserved-action` | An internal `browsentic.*` verb is called from outside | **deny** |
| `non-http-navigation` | A `javascript:`, `data:` or `file:` URL dressed up as a navigation | **deny** |
| `unreadable-navigation` | A URL that resolves to no destination Browsentic can check | **deny** |
| `raw-html-read` | `page_extractText` with `format: "html"` | **deny** |
| `network-body-read` | `page_readNetwork` with `includeBodies: true` | **deny** |
| `off-scope-navigation` | Navigating off the sites this run is about, however the URL is spelled | confirm |
| `url-payload` | A navigation whose query string or fragment exceeds `urlPayloadBytes` (512 by default) | confirm |
| `form-submission` | Anything that commits a form, however spelled | confirm |
| `site-tool-call` | `page_callSiteTool`: running a tool the site registered through WebMCP | confirm |
| `file-upload` | `page_attachFile`: putting one of your files into a page | confirm |
| `file-download` | `page_captureDownload`: letting a page write a file to your disk | confirm |
| `leaves-pinned-tab` | Moving to a tab the run was not pointed at | confirm |
| `captcha-solve` | `page_solveCaptcha`: ticking a site's "I am a human" box and answering its image challenge; one yes covers the rest of the run | confirm |
| `code-injection` | `page_injectCode`: installing JavaScript the agent wrote into the page | confirm |
| `external-code-injection` | `page_injectCode` called by an MCP client rather than the side panel | **deny** |
| `external-code-execution` | `page_runCode` called by an MCP client rather than the side panel | **deny** |
| `secret-in-url` | A saved secret placed in a navigation URL | **deny** |
| `secret-release` | A saved secret about to be typed into the page | confirm |
| `secret-off-scope` | …and it was read on a site outside this run's scope | confirm |
| `config-require-approval` | The action is named in your `requireApproval` list | confirm |

Five of these need more explanation:

**`form-submission` matches more than the submit tool.** It also catches `page_fillInput` and
`page_typeText` with `pressEnter: true`, and `page_pressKey` with `Enter`, because those submit
forms too.

**`file-download` only decides whether the capture happens.** What may be *kept* is not a
preference: executables, files over 100 MB, and downloads from a host outside the run's scope are
refused whatever this rule is set to, and the file the browser already wrote is deleted. See
[Files](features/files.md#what-it-will-not-keep).

**`code-injection` is the one prompt that shows the code, and the one capability that is off until
you switch it on.** The composer's **Live tool** switch starts off, and while it is off
`page_injectCode` is refused outright, before this rule is consulted. With it on, approving means
running JavaScript the agent wrote in the page, with your session, so the panel puts a **Review**
button on the prompt that opens the full source before you decide. There is no "always on this
site" for it, because that would let later, unread code run on your approval of earlier code. One
approval covers every later `page_runCode` call into *that* toolkit, on that tab and that site,
which is what makes twenty repetitions cheap; a different script is a new prompt. See
[Page actions](features/page-actions.md).

**`raw-html-read` is denied by default** because `outerHTML` carries comments, `aria-hidden` nodes
and off-screen text: everything a page can hide from the person looking at it but still hand to the
model. The default rendered-text format drops those. Set it to `allow` if a run genuinely needs
markup.

**`network-body-read` is denied by default** because a response body is the richest credential
surface a page has: session tokens, API keys and other people's personal data, in bulk. Request and
response *metadata* (method, URL, status, timing) needs no approval, and headers come back
[sanitized](../internals/guardrails.md) when asked for; between them they answer nearly every real
"why did that fail?". Reading the body goes well past diagnosing. Set it to `allow` if a run
genuinely needs payloads. See [Diagnostics](features/diagnostics.md).

### Scope: which sites a run may reach

A run's scope, which `off-scope-navigation` checks against, is derived once when the run starts,
from things you control:

- the host of the tab it started on,
- any host you named in your own instruction ("check the pricing on stripe.com"),
- anything in `guardrails.hosts` in your config.

It never widens on its own, and **nothing read from a page can widen it**. A run that starts nowhere
in particular (a blank tab, no host named) is unconfined, because failing closed there would block
"search for X" on an empty tab.

`example.com` in scope covers `www.example.com` and `app.example.com`. `["*"]` in
`guardrails.hosts` disables host confinement entirely.

### Sites that are never in scope

The Bridge works out scope per run, and `config.json` can widen it. For a site the agent must never
touch at all, use [Blocked sites](features/blocked-sites.md) instead: the extension enforces that
list itself, before any of these rules run, and nothing on the Bridge's side can read or change it.
A run started from a blocked tab does not send its address, so it begins unconfined, as from a
blank tab, but every action on the blocked site is still refused.

---

## Callers with nobody to ask

A client on the optional MCP endpoint ([MCP clients](mcp-clients.md)) has no approval channel. So
for an external caller, `confirm` resolves to **deny**, with a message telling the agent the action
is only available from the side panel, where you can see and answer it.

This is deliberate. The client's own permission prompts stop protecting you the moment someone
allowlists the browsentic tools to stop being asked. To waive the denial anyway, and go back to the
client's permissions being the only gate, set:

```json
{ "guardrails": { "unattended": "allow" } }
```

### Tools the user kept

A toolkit the user saved from the keep prompt runs from `/` with no approval at all: its code was
read and approved when it was kept, so asking again would ask about something already answered.
What holds it in place is the saved record itself, which pins the origin and the path segment it was
approved on and re-checks both before it installs anything.

The Bridge is not involved. The code lives in extension storage, the run goes from the side panel
straight to the tab, and the Bridge holds only a markdown note that the tool exists. There is no
action for it, so no MCP client can reach it, with or without `unattended`.

`unattended` does not waive a `deny`. That is why the two live-tool rules for external callers deny
rather than confirm: a client allowlisting the Browsentic tools is exactly the setup where
`unattended: allow` gets turned on, and a client's own prompt is in no position to judge code
written into your logged-in page.

---

## Changing the policy in config.json

In `~/.browsentic/config.json`:

**Gate more actions.** Add to `requireApproval`:

```json
{ "requireApproval": ["page.submitForm", "page.closeTab"] }
```

**Change a rule's effect.** Set it by id; this applies to external clients as well:

```json
{ "guardrails": { "rules": { "captcha-solve": "allow", "off-scope-navigation": "deny" } } }
```

**Turn the form gate off completely.** Set `requireApproval: []`. The legacy key owns that rule, so
an empty list means "gate nothing".

One caution against a long list: **a prompt you see on every other tool call is a prompt you stop
reading**, and then the gate no longer tells you anything.

---

## The settings page

These settings can be changed without opening a file, from two places that edit the same rows:

- **The settings page**, under **Guardrails**. Open it with the sliders button in the side panel's
  header or the popup, or right-click the toolbar icon → **Options**.
- **The Mac app's Settings tab**, in its **Guardrails** card.

A change made in one shows up in the other at once, and so does a hand edit of the file.

The screen is a list of **overrides** of the defaults Browsentic ships, not switches that turn
protection on. Every row starts off, meaning "use the default", so a fresh install has an empty
settings page and behaves as this page describes whether or not you ever open it.

Turning a row on reveals **Allow / Ask / Block** and writes that one line to
`~/.browsentic/config.json`. Turning it back off removes the line rather than writing a value equal
to the default, so your config file names only decisions you actually made, and a later change to a
shipped default still reaches you.

A run takes its policy when it starts, so a change applies from the next run, not one already going.

Four rows are shown but **locked**: `reserved-action`, `non-http-navigation`,
`unreadable-navigation` and `secret-in-url`. Allowing a `javascript:` URL, letting a page call an
internal verb, or letting a credential travel in a query string has no use worth a switch you could
hit by accident. Hand-editing `config.json` still works if you genuinely mean it.

Credential sealing is listed with no switch at all, because there is nothing to turn off: it is what
keeps a plaintext password off the socket in the first place.

An agent run cannot use either screen's route to loosen its own rules: the Bridge refuses a
settings change from a connection that has acted for a run, with `BLOCKED`.

---

## Secrets are sealed before you are asked

Before any rule runs, a deterministic sanitizer takes credentials out of what the browser hands
back. A password, key, token, cookie or card number found in a page is replaced by a placeholder
naming what it was and where it came from:

```
Your new password is ⟦password:7f3a@mail.example.com⟧
```

The agent never sees the value. It stays in the browser and becomes plaintext again at exactly one
moment: when the agent types it into a page field, which is when `secret-release` asks you first.
So the agent can carry a reset password from the mail page to the login form without ever being
able to read it, repeat it, or put it in a URL.

A `⟦…⟧` in the panel is a credential being handled, not an error.
[How it works](../internals/guardrails.md#sealed-secrets).

---

## What this does not cover

The policy governs what an agent may do **to a page**. What the spawned CLI may do **to your
machine** is a separate mechanism that never passes through these rules. See
[internals/guardrails.md § Spawn containment](../internals/guardrails.md#spawn-containment).

No gate makes an agent immune to [prompt injection](limits.md#prompt-injection-is-a-real-risk). A
policy can make sure a successful injection has nowhere to send what it took.

---

## See also

- [Configuration](configuration.md): the keys
- [internals/guardrails.md](../internals/guardrails.md): how the policy is evaluated
- [Limits](limits.md): what Browsentic does not do
