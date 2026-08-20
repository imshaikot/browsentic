# Approvals and guardrails

What Browsentic asks about before doing, what it refuses outright, and how to change either.

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
browsentic-mcp approvals              # what no longer asks
browsentic-mcp approvals clear        # forget all of them
browsentic-mcp approvals clear a.com  # forget one site's
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
| `off-scope-navigation` | Navigating off the sites this run is about | confirm |
| `url-payload` | A navigation whose query string or fragment exceeds `urlPayloadBytes` (512 by default) | confirm |
| `form-submission` | Anything that commits a form, however spelled | confirm |
| `file-upload` | `page_attachFile` — putting one of your files into a page | confirm |
| `leaves-pinned-tab` | Moving to a tab the run was not pointed at | confirm |
| `captcha-solve` | `page_solveCaptcha` — ticking a site's "I am a human" box | confirm |
| `config-require-approval` | The action is named in your `requireApproval` list | confirm |

Two of these are less obvious than they look:

**`form-submission` is smarter than a name match.** It also catches `page_fillInput` and
`page_typeText` with `pressEnter: true`, and `page_pressKey` with `Enter` — because those submit
forms too.

**`raw-html-read` is denied by default** because `outerHTML` carries comments, `aria-hidden` nodes
and off-screen text: everything a page can hide from the person looking at it but still hand to the
model. The default rendered-text format has already dropped those. Set it to `allow` if a run
genuinely needs markup.

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

An [MCP client](mcp-clients.md) has no approval channel. So for an external caller, `confirm`
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

## What this does not cover

The policy governs what an agent may do **to a page**. What the spawned CLI may do **to your
machine** is a separate mechanism — it never passes through these rules at all. See
[internals/guardrails.md § Spawn containment](../internals/guardrails.md#spawn-containment).

And no gate makes an agent immune to [prompt injection](limits.md#prompt-injection-is-a-real-risk).
What a policy can do is make sure a successful injection has nowhere to send what it took.

---

## See also

- [Configuration](configuration.md) — the keys
- [internals/guardrails.md](../internals/guardrails.md) — how the policy is evaluated
- [Limits](limits.md) — the honest boundaries
