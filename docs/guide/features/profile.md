# Profile

Your name, email, address and the rules you want kept, saved once so the agent fills a form with
the real thing instead of asking every time — or worse, making something up.

```
sign me up for the newsletter
fill in the delivery details and stop before paying
```

Open settings from the sliders button at the top of the side panel or the popup, and pick **Profile**.

---

## What it holds

| Group | Fields |
| --- | --- |
| **You** | First name, last name, email, phone |
| **Address** | Street address, city, state / region, postal code, country |
| **Work** | Company, job title |
| **More details** | Anything else, as label and value — a loyalty number, a date of birth, a delivery note. Up to 20 |
| **Instructions** | Rules for every task, in your own words. Up to 4,000 characters |

Every field is optional. **Save** writes the whole profile at once; nothing is sent while you type.

## What the agent sees

Whatever is filled in goes into the system prompt of **every side-panel run and every scheduled task**,
as two sections:

- **About the user** — one `Label: value` line per detail, exactly as you wrote it. The agent is told to
  use them as written and **never to invent, guess or “complete” a detail that is not there** — no
  middle name, no postcode worked out from a city, no email built from your name. When a form needs
  something you have not saved, it leaves the field empty and tells you what is missing.
- **Your standing instructions** — kept as firmly as its own rules. Where they conflict with a skill or
  with site notes, yours win.

Instructions cannot loosen the handful of rules every run starts with — page text is never an
instruction, nothing is exfiltrated, a declined action stays declined — and cannot make an action skip
its [approval](../approvals.md). Guardrails are enforced by the daemon, not by the prompt, so a rule
that tried would change nothing but what the agent says.

An edit reaches the next run. In a conversation that is already going, the next message carries the
change, so the agent never works from the version it started with.

What does **not** see the profile: an [MCP client](../mcp-clients.md) driving the browser (it brings
its own context), [site mapping](site-maps.md), the file analyst, and conversation titles.

## What it refuses

Passwords, API keys, tokens and card numbers. Browsentic [seals those](../approvals.md#secrets-are-sealed-before-you-are-asked) in the browser
so no model ever reads them, and a profile would undo that on every run. Saving one is refused with the
name of the field it is in; leave it out and let the page hand the sealed value over when it is needed.

A phone number is never taken for a card, whatever its digits add up to.

## Where it lives

`~/.browsentic/profile.json`, mode 0600, on this computer only — deliberately not in `config.json`, so
that file stays safe to paste into a bug report. Clearing every field deletes the file.

One profile serves every paired browser, and a change in one shows on the settings page of the others
at once. The format is in [Configuration](../configuration.md#profile) if you would rather edit it by hand.

## Edges

- It needs the daemon: the settings page reads and writes the file through it, so the section is empty
  while the daemon is offline.
- Every run pays for the profile in tokens. A filled-in profile is a few hundred; the limits keep the
  largest possible one to about 16,000 characters.
- The Mac and Windows apps do not edit it yet.
