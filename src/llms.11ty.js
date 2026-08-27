// https://llmstxt.org: a short, linkable map of the project for language models.
// Generated from the same copy the pages render, so it cannot drift from them.
export default class {
  data() {
    return { permalink: '/llms.txt', eleventyExcludeFromCollections: true }
  }

  render({ site, copy }) {
    const { SEO, STATS, TOOL_GROUPS, VERSION, REPO } = copy
    const u = (p) => site.url(p)
    const link = (label, href, note) => `- [${label}](${href}): ${note}`

    return `# Browsentic

> ${SEO.summary}

Browsentic is ${VERSION}, MIT licensed, and runs entirely on your own machine: a Manifest V3
extension, a local daemon on loopback, and the AI agent you already have installed. There is no
hosted relay, no API key, and no headless browser. It drives the real tab you are signed into.

${TOOL_GROUPS.map((g) => `- **${g.label}** (${g.tools.length} tools): ${g.blurb}`).join('\n')}

## Pages

${link('How it works', u('/how-it-works/'), 'the four hops, and why a Manifest V3 extension forces a daemon')}
${link('Capabilities', u('/capabilities/'), 'all 41 page tools, grouped, plus the three read-only resources')}
${link('MCP server', u('/mcp-server/'), 'driving the same logged-in browser from Claude Code, Cursor, Zed or Codex')}
${link('Agent orchestration', u('/orchestration/'), 'several tabs, several agents, one browser, all at once')}
${link('Automations', u('/automations/'), 'the jobs people hand over, and where each one stops for you')}
${link('Skills', u('/skills/'), 'automatic site maps, record and replay, local intent routing')}
${link('Security', u('/security/'), 'the security model, and the two limits worth stating')}
${link('Install', u('/install/'), 'four steps, about five minutes')}
${link('FAQ', u('/faq/'), 'the questions people ask first')}

## Docs

${link('Documentation index', u('/docs/'), 'split by who is asking: using it, building on it, looking something up')}
${link('User guide', u('/docs/guide/'), 'install, pair, first run, features, configuration, approvals, limits')}
${link('Tool reference', u('/docs/reference/tools/'), 'every tool published to an MCP client, with its parameters')}
${link('CLI reference', u('/docs/reference/cli/'), 'every browsentic-mcp command')}
${link('Error codes', u('/docs/reference/errors/'), 'every error code, what caused it, what to do')}
${link('Internals', u('/docs/internals/'), 'how an instruction becomes a click, end to end')}

## Optional

${link('Full site text', u('/llms-full.txt'), 'every marketing page as one markdown document')}
${link('Source', REPO, 'the repository')}
${link('Releases', `${REPO}/releases`, 'built extension archives per version')}

## Key facts

- Install as an MCP server: \`claude mcp add browsentic -- browsentic-mcp\`
- ${STATS.map((s) => `${s.value}${s.suffix} ${s.label}`).join('\n- ')}
- Concurrency: one conversation per tab, bound to the tab it started in. Eight tab sessions open, three runs at once by default, ceiling of eight (\`maxConcurrentRuns\`).
- The side panel runs on Claude Code, Codex or Antigravity, switched with one click. As an MCP server it is agent-agnostic: Cursor, Zed, Claude Desktop or any MCP client drives the same browser.
- Pairing is two-gated: the daemon classifies the WebSocket peer by handshake Origin, then requires a pairing token or an origin-bound session key. A web page cannot reach the control path.
`
  }
}
