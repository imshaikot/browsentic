---
layout: layouts/doc.njk
pageKey: docs
title: "Approvals and guardrails"
seoTitle: "Approvals and guardrails — Browsentic user guide"
description: "What Browsentic asks about before doing, what it refuses outright, and how to change either. The short version: reading and clicking are free, anything that…"
deck: "What Browsentic asks about before doing, what it refuses outright, and how to change either."
docsPath: "guide/approvals.md"
section: "guide"
sectionLabel: "User guide"
sectionOrder: 1
order: 6
isIndex: false
permalink: "/docs/guide/approvals/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/approvals.md"
---
The short version: reading and clicking are free, anything that commits something or sends data
somewhere pauses and asks, and a handful of things are refused whatever you say.

---

## In the panel

When a run reaches a gated action it stops and shows a card naming what it was about to do and why
that is gated. Three buttons:

| | |
| --- | --- |
| **Allow** | Once. |
| **Deny** | Final. The agent is told to report it and stop — not to find another route to the same effect. |
| **Always on ‹host›** | Allow, and stop asking for *that action on that host*. |

**Always on ‹host›** is the answer to a prompt you keep clicking through — a captcha checkbox on a
site you use daily, Enter-to-submit on a search box. The grant is a pair, one action and one host,
keyed to the site the run started on. It is written to `~/.browsentic/approvals.json` (mode `0600`),
survives restarts, and **only ever short-circuits a `confirm`**. A `deny` stays denied, because
those are the ones you are not meant to be able to click past. The button is hidden when a run has
no single site to attach a grant to.

```sh
browsentic approvals              # what no longer asks
browsentic approvals clear        # forget all of them
browsentic approvals clear a.com  # forget one site's
```

---

## The rules

The policy is data, not scattered checks: each rule names a condition and an effect. Every rule
whose condition matches is collected and **the most severe effect wins**, so the outcome does not
depend on declaration order.

| Rule id | Fires when | Default |
| --- | --- | --- |
| `reserved-action` | An internal `browsentic.*` verb is called from outside | **deny** |
| `non-http-navigation` | A `javascript:`, `data:` or `file:` URL dressed up as a navigation | **deny** |
| `raw-html-read` | `page_extractText` with `format: "html"` | **deny** |
| `network-body-read` | `page_readNetwork` with `includeBodies: true` | **deny** |
| `off-scope-navigation` | Navigating off the sites this run is about | confirm |
| `url-payload` | A navigation whose query string or fragment exceeds `urlPayloadBytes` (512 by default) | confirm |
| `form-submission` | Anything that commits a form, however spelled | confirm |
| `file-upload` | `page_attachFile` — putting one of your files into a page | confirm |
| `file-download` | `page_captureDownload` — letting a page write a file to your disk | confirm |
| `leaves-pinned-tab` | Moving to a tab the run was not pointed at | confirm |
| `captcha-solve` | `page_solveCaptcha` — ticking a site's "I am a human" box | confirm |
| `code-injection` | `page_injectCode` — installing JavaScript the agent wrote into the page | confirm |
| `external-code-execution` | `page_runCode` called by an MCP client rather than the side panel | **deny** |
| `secret-in-url` | A saved secret placed in a navigation URL | **deny** |
| `secret-release` | A saved secret about to be typed into the page | confirm |
| `secret-off-scope` | …and it was read on a site outside this run's scope | confirm |
| `config-require-approval` | The action is named in your `requireApproval` list | confirm |

Five of these are less obvious than they look:

**`form-submission` is smarter than a name match.** It also catches `page_fillInput` and
`page_typeText` with `pressEnter: true`, and `page_pressKey` with `Enter` — because those submit
forms too.

**`file-download` is not the whole download story.** The rule decides whether the capture happens.
What may be *kept* is not a preference: executables, files over 100 MB, and downloads from a host
outside the run's scope are refused whatever this is set to, and the file the browser already wrote
is deleted. See [Files](/docs/guide/features/files/#what-it-will-not-keep).

**`code-injection` is the one prompt that shows its work** — and the one capability that is off until
you switch it on. The composer's **Live tool** switch starts off, and with it off `page_injectCode`
is refused outright, before this rule is ever consulted. With it on, approving means running
JavaScript the agent wrote in the page, with your session — so the panel puts a **Review** button on
the prompt and opens the full source before you decide. There is no "always on this site" for it: that would let
later, unread code run on your say-so about earlier code. One approval covers every later
`page_runCode` call into *that* toolkit, on that tab and that site, which is what makes twenty
repetitions cheap; a different script is a fresh prompt. See [Page actions](/docs/guide/features/page-actions/).

**`raw-html-read` is denied by default** because `outerHTML` carries comments, `aria-hidden` nodes
and off-screen text: everything a page can hide from the person looking at it but still hand to the
model. The default rendered-text format has already dropped those. Set it to `allow` if a run
genuinely needs markup.

**`network-body-read` is denied by default** because a response body is the richest credential
surface a page has: session tokens, API keys and other people's personal data, wholesale. Request and
response *metadata* — method, URL, status, timing — is free, and headers come back
[sanitized](/docs/internals/guardrails/) when asked for, which between them answer nearly every real
"why did that fail?". The body is the read that goes well past diagnosing. Set it to `allow` if a run
genuinely needs payloads. See [Diagnostics](/docs/guide/features/diagnostics/).

### Scope: which sites a run may reach

`off-scope-navigation` needs to know what "off scope" means. A run's scope is derived once, when it
starts, from things you control:

- the host of the tab it started on,
- any host you named in your own instruction ("check the pricing on stripe.com"),
- anything in `guardrails.hosts` in your config.

It never widens on its own, and **nothing read from a page can widen it**. A run that starts nowhere
in particular — blank tab, no host named — comes back unconfined, because failing closed there would
block "search for X" on an empty tab.

`example.com` in scope covers `www.example.com` and `app.example.com`. `["*"]` in
`guardrails.hosts` disables host confinement entirely.

---

## Callers with nobody to ask

An [MCP client](/docs/guide/mcp-clients/) has no approval channel. So for an external caller, `confirm`
resolves to **deny**, with a message telling the agent the action is only available from the side
panel where you can see and answer it.

That is deliberate. Leaning on the client's own permission prompts stops being true the moment
someone allowlists the browsentic tools to stop being asked.

```json
{ "guardrails": { "unattended": "allow" } }
```

waives them instead, going back to "the client's permissions are the only gate".

---

## Tuning it

In `~/.browsentic/config.json`:

**Gate more actions.** Add to `requireApproval`:

```json
{ "requireApproval": ["page.submitForm", "page.closeTab"] }
```

**Change a rule outright.** By id, which applies to external clients as well:

```json
{ "guardrails": { "rules": { "captcha-solve": "allow", "off-scope-navigation": "deny" } } }
```

**Turn the form gate off completely.** `requireApproval: []` does it — the legacy key owns that
rule, so an empty list means "gate nothing".

One caution, which is the real argument against a long list: **a prompt you see on every other tool
call is a prompt you stop reading.** The cost of gating more is not the clicking, it is that the
gate stops being information.

---

## The Settings tab

Everything below is editable from **Settings** in the side panel, without opening a file.

The screen is a list of **overrides**, not a list of switches that turn protection on. Every row
starts off, meaning "use the default Browsentic ships" — so a fresh install has an empty settings
tab and the posture you get is the posture described here, whether or not you ever open it.

Turning a row on reveals **Allow / Ask / Block** and writes that one line to
`~/.browsentic/config.json`. Turning it back off removes the line rather than writing a value equal
to the default, so your config file only ever names decisions you actually made — and a change to a
shipped default still reaches you.

A run takes its policy when it starts. A change applies to the next run, not one already going.

Three rows are shown but **locked**: `reserved-action`, `non-http-navigation` and `secret-in-url`.
Allowing a `javascript:` URL, letting a page call an internal verb, or letting a credential travel
in a query string are not preferences, and none of them has a use worth a switch you can hit by
accident. Hand-editing config.json still works if you genuinely mean it.

Credential sealing appears in the list with no switch at all, because there is nothing to turn off:
it is what keeps a plaintext password off the socket in the first place.

---

## Secrets are sealed before you are asked

Before any of this runs, a deterministic sanitizer takes credentials out of what the browser hands
back. A password, key, token, cookie or card number found in a page is replaced by a placeholder
that names what it was and where it came from:

```
Your new password is ⟦password:7f3a@mail.example.com⟧
```

The agent never sees the value. It stays in the browser and becomes plaintext again at exactly one
moment: when the agent types it into a page field, which is when `secret-release` asks you first.
That is why the flow works at all — the agent can carry a reset password from the mail page to the
login form without ever being able to read it, repeat it, or put it in a URL.

If you see `⟦…⟧` in the panel, nothing has gone wrong. That is a credential being handled.
[How it works](/docs/internals/guardrails/#sealed-secrets).

---

## What this does not cover

The policy governs what an agent may do **to a page**. What the spawned CLI may do **to your
machine** is a separate mechanism — it never passes through these rules at all. See
[internals/guardrails.md § Spawn containment](/docs/internals/guardrails/#spawn-containment).

And no gate makes an agent immune to [prompt injection](/docs/guide/limits/#prompt-injection-is-a-real-risk).
What a policy can do is make sure a successful injection has nowhere to send what it took.

---

## See also

- [Configuration](/docs/guide/configuration/) — the keys
- [internals/guardrails.md](/docs/internals/guardrails/) — how the policy is evaluated
- [Limits](/docs/guide/limits/) — the honest boundaries
