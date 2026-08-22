# Security

Browsentic drives a real, logged-in browser. That is the point of it, and it is also why this
file exists. Read this before you rely on it, and before you report anything.

## Reporting a vulnerability

Report vulnerabilities privately through
[GitHub security advisories](https://github.com/imshaikot/browsentic/security/advisories/new)
rather than a public issue — a public report on a tool that holds live browser sessions puts
every user at risk before a fix exists. Reports are read and acknowledged as quickly as a
one-maintainer project allows.

Bugs that are not vulnerabilities — a tool that fails, a gate that prompts too often — belong in
[ordinary issues](https://github.com/imshaikot/browsentic/issues).

## Supported versions

The latest release only. There is no backporting; the fix for anything lands in the next version.

## The security model, in brief

The full write-up lives in the docs and is the authority:

- [Transport and authorization](docs/internals/transport.md) — the origin gate, the mutual
  pairing handshake, why a web page can never reach the control path
- [Guardrails](docs/internals/guardrails.md) — the action policy, run scope, fencing of page
  text, sealing of credentials, containment of the spawned agent CLI
- [Limits](docs/guide/limits.md) — the boundaries stated plainly

Three of those boundaries matter enough to repeat here. **Pairing controls which browser, not
which local process**: anything running as your user can drive an already-paired browser, so
your user account is the trust boundary. **Prompt injection is mitigated, not solved**: an
agent reading a hostile page can be influenced by it, and the design goal is to leave a
successful injection nowhere to act or send data — not to make injection impossible. And
**secret detection is a filter, not a proof**: the sanitizer is deterministic and errs toward
sealing, but a credential with no recognisable shape, no label near it and low entropy — a short
passphrase in running prose — can still read as ordinary text. Held secrets live in the
extension's session storage in the clear, gone when the browser closes; they are never written to
disk and never cross the socket.

## Disclaimer and liability

Browsentic is provided **"as is", without warranty of any kind**, under the terms of the
[MIT License](LICENSE). In no event shall the authors be liable for any claim, damages, or
other liability arising from the software or its use. In plain language, that means:

- **You are responsible for what you approve and where you point it.** The approval gate names
  the action; deciding is yours. Actions taken in your browser — purchases, submissions,
  messages, deletions — are actions taken on your accounts, by you.
- **The agent is not part of this project.** Browsentic spawns Claude Code, Codex, or
  Antigravity and contains them as well as each CLI's own flags allow, but their behaviour,
  their terms, and what they do with your prompts are governed by their vendors, not by this
  repository.
- **Automating a website may breach that website's terms of service.** Whether a site permits
  automated interaction is between you and the site.
- **No security mechanism here is a guarantee.** The gates, the handshake, and the fencing
  reduce risk; they do not eliminate it. Do not point an agent at sites you do not trust with
  the sessions your browser is holding.

If any of this is unacceptable for your use, do not use the software.
