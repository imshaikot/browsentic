// Every marketing page as one markdown document, for models that want the text
// rather than the map. The docs tree is not inlined here, because it is already markdown
// at its own URLs, and llms.txt links to it.
export default class {
  data() {
    return { permalink: '/llms-full.txt', eleventyExcludeFromCollections: true }
  }

  render({ site, copy }) {
    const {
      ALL_TOOLS, AUTOMATIONS, AUTOMATION_FEATURED, CTA, FAQ, HERO, LIMITS, MCP_POINTS, MODES,
      ORCHESTRATION_POINTS, ORCHESTRATION_SESSIONS, ORCHESTRATION_SHARED, PANEL_POINTS, PIPELINE,
      QUICKSTART, REPO, RESOURCES, SECTIONS, SECURITY, STATS, TOOL_GROUPS, VERSION,
    } = copy

    const lines = (t) => (typeof t === 'string' ? t : t.join(' '))
    const heroTitle = `${HERO.title.lead} ${HERO.title.tail}${HERO.title.accent}`
    const block = (url, title, lede, body) =>
      `## ${lines(title)}\n\n${site.url(url)}\n\n${lede ? `${lede}\n\n` : ''}${body}`

    return `# Browsentic

${heroTitle}

${HERO.lede}

The product is the browser extension and its side panel. An external MCP client driving the same
browser is an optional integration, not the architecture.

Source: ${REPO}
Site: ${site.url('/')}
Version: ${VERSION} (MIT)

${STATS.map((s) => `- ${s.value}${s.suffix} ${s.label}: ${s.note}`).join('\n')}

${block(
  '/how-it-works/',
  SECTIONS.how.title,
  SECTIONS.how.lede,
  PIPELINE.map((n) => `### ${n.title}\n\n_${n.sub}_\n\n${n.body}`).join('\n\n'),
)}

${block(
  '/capabilities/',
  SECTIONS.capabilities.title,
  SECTIONS.capabilities.lede,
  `All ${ALL_TOOLS.length} page tools:\n\n` +
    TOOL_GROUPS.map(
      (g) => `### ${g.label} (${g.tools.length})\n\n${g.blurb}\n\n${g.tools.map((t) => `- \`${t}\``).join('\n')}`,
    ).join('\n\n') +
    `\n\n### Read-only resources\n\n${RESOURCES.map((r) => `- \`${r.uri}\`: ${r.desc}`).join('\n')}`,
)}

${block(
  '/',
  SECTIONS.panel.title,
  SECTIONS.panel.lede,
  PANEL_POINTS.map((p) => `### ${p.title}\n\n${p.body}`).join('\n\n'),
)}

${block(
  '/orchestration/',
  SECTIONS.orchestrate.title,
  SECTIONS.orchestrate.lede,
  ORCHESTRATION_SESSIONS.map(
    (r) => `### ${r.host}\n\n${r.title}, on ${r.agent}, ${r.status}: ${r.timeline.join('; ')}.`,
  ).join('\n\n') +
    `\n\n${ORCHESTRATION_POINTS.map(([t, b]) => `- **${t}** ${b}`).join('\n')}` +
    `\n\n${ORCHESTRATION_SHARED.body}`,
)}

${block(
  '/automations/',
  SECTIONS.automations.title,
  SECTIONS.automations.lede,
  `### ${AUTOMATION_FEATURED.title}\n\n${AUTOMATION_FEATURED.body}\n\n${AUTOMATION_FEATURED.steps
    .map((s) => `- \`${s.tool}\` ${s.note}${s.gate ? ' (asks you first)' : ''}`)
    .join('\n')}\n\n` +
    AUTOMATIONS.map(
      (a) => `### ${a.title}\n\n${a.body}\n\n${a.tools.map((t) => `- \`${t}\``).join('\n')}\n\nGate: ${a.gate}`,
    ).join('\n\n'),
)}

${block(
  '/skills/',
  SECTIONS.teach.title,
  SECTIONS.teach.lede,
  MODES.map(
    (m) =>
      `### ${m.tab}: ${m.title}\n\n${m.body}\n\nInvoke with: \`${m.invocation}\`\n\n${m.points
        .map(([t, b]) => `- **${t}** ${b}`)
        .join('\n')}`,
  ).join('\n\n'),
)}

${block(
  '/security/',
  SECTIONS.security.title,
  SECTIONS.security.lede,
  SECURITY.map((s) => `### ${s.title}\n\n${s.body}`).join('\n\n') +
    `\n\n### Two limits worth stating\n\n${LIMITS.map((l) => `- **${l.title}** ${l.body}`).join('\n')}`,
)}

${block(
  '/install/',
  SECTIONS.start.title,
  SECTIONS.start.lede,
  QUICKSTART.map((s) => `### ${s.n}. ${s.title}\n\n${s.body}\n\n\`\`\`${s.lang}\n${s.code}\n\`\`\``).join('\n\n'),
)}

${block(
  '/mcp-server/',
  SECTIONS.mcp.title,
  SECTIONS.mcp.lede,
  MCP_POINTS.map((p) => `### ${p.title}\n\n${p.body}`).join('\n\n'),
)}

${block('/faq/', SECTIONS.faq.title, undefined, FAQ.map((f) => `### ${f.q}\n\n${f.a}`).join('\n\n'))}

## ${CTA.title.lead} ${CTA.title.accent}

${CTA.lede}

\`\`\`sh
${CTA.command}
\`\`\`
`
  }
}
