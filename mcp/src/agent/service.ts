import { randomUUID } from 'node:crypto';
import {
  failure,
  success,
  type ActionResult,
  type ExtensionRequest,
  type RunContext,
  type RunEvent,
} from '@/lib/actions/protocol';
import { SAVE_SITE_MAP_ACTION, SITE_MAPPER_SKILL, validateSiteMapReport } from '@/lib/skills/site-map';
import { log } from '../log';
import { readAgentConfig, siteMapSettings, type AgentConfig } from './config';
import { gateMappingInvoke, noteMappingResult, type MapRun } from './mapping';
import { buildSystemPrompt } from './prompt';
import { RunError, runInstruction } from './runner';
import {
  discardStaging,
  mapTargetFor,
  prepareStaging,
  stageSiteMap,
  stagedScreenshots,
  sweepStaging,
  writeEvidence,
} from './site-map-store';
import { fetchSiteIndex, type SiteIndex } from './sitemap';
import { loadSkills, routeSkill, skillDirNames, type Skill } from './skills';

export interface AgentSessionDeps {
  /**
   * The daemon's own invoke path, so the agent reaches the browser exactly as MCP clients do.
   * `opts.saveTo` is how a mapping run's screenshots are placed by the daemon rather than named
   * by the model; `opts.tabId` pins a long autonomous run to the tab it started in.
   */
  invoke: (
    action: string,
    input?: unknown,
    opts?: { saveTo?: { dir: string; filename: string }; tabId?: number },
  ) => Promise<ActionResult>;
  emit: (runId: string, event: RunEvent) => void;
  /** A staged site map awaiting review. Separate from run events: it outlives the run. */
  draft: (runId: string, draft: import('@/lib/skills/site-map').SiteMapDraft) => void;
}

interface ActiveRun {
  id: string;
  config: AgentConfig;
  abort: AbortController;
  /** Approvals the run is blocked on, keyed by tool-use id. */
  pending: Map<string, (allow: boolean) => void>;
  /** Present only while this run is mapping a site. */
  map?: MapRun;
}

/**
 * One browser's agent state: the Claude Code session its conversation lives in and the run it
 * is in the middle of. Created when an extension connects and dropped when it disconnects, so
 * a reconnecting browser starts clean rather than resuming a conversation about a page that
 * has moved on.
 */
export class AgentSession {
  /** The `claude --resume` id. Null until a run establishes it; null again after `reset`. */
  private claudeSession: string | null = null;
  private active: ActiveRun | null = null;

  constructor(private readonly deps: AgentSessionDeps) {}

  handle(request: ExtensionRequest): void {
    switch (request.t) {
      case 'instruct':
        void this.start(request.id, request.text, request.context);
        return;
      case 'cancel':
        this.cancel(request.id);
        return;
      case 'decision':
        this.active?.pending.get(request.toolId)?.(request.allow);
        return;
      case 'reset':
        this.claudeSession = null;
        log('agent conversation reset');
        return;
    }
  }

  /**
   * A browser invocation made on behalf of a run — the spawned Claude Code tags its tool calls
   * with the run id from its environment, and the daemon routes them here. This is where the
   * timeline learns about tool calls, and where gated actions stop until the user decides.
   */
  async invokeForRun(runId: string, action: string, input?: unknown): Promise<ActionResult> {
    const run = this.active;
    if (!run || run.id !== runId) {
      // A cancelled or superseded agent does not get to keep driving the browser.
      return failure('RUN_INACTIVE', 'This agent run is no longer active');
    }
    const emit = (event: RunEvent) => this.deps.emit(runId, event);
    const toolId = randomUUID();
    emit({ kind: 'tool', toolId, action, input });

    // The reserved write action exists only for a mapping run. An ordinary run reaching it means
    // something is wrong with the tool list, not that it should be honoured.
    if (action === SAVE_SITE_MAP_ACTION) {
      if (!run.map) {
        emit({ kind: 'toolResult', toolId, ok: false, summary: 'not a mapping run' });
        return failure('UNKNOWN_ACTION', `Unknown action "${action}".`);
      }
      const result = this.submitSiteMap(run, input);
      emit({ kind: 'toolResult', toolId, ok: result.ok, summary: summarize(input, result) });
      return result;
    }

    if (run.map) {
      const gate = gateMappingInvoke(run.map, action, input);
      if (!gate.allow) {
        log(`mapping run ${runId} refused ${action}: ${gate.result.ok ? '' : gate.result.error.code}`);
        emit({ kind: 'toolResult', toolId, ok: false, summary: summarize(input, gate.result) });
        return gate.result;
      }
      const result = await this.deps.invoke(action, input, { saveTo: gate.saveTo, tabId: run.map.tabId });
      noteMappingResult(run.map, action, result);
      log(`agent → ${action} ${result.ok ? 'ok' : result.error.code}`);
      emit({ kind: 'toolResult', toolId, ok: result.ok, summary: summarize(input, result) });
      return result;
    }

    if (run.config.requireApproval.includes(action)) {
      emit({ kind: 'approval', toolId, action, input });
      if (!(await this.awaitDecision(run, toolId))) {
        emit({ kind: 'toolResult', toolId, ok: false, summary: 'declined by the user' });
        return failure(
          'DECLINED',
          'The user declined this action. Do not retry it and do not try to achieve the same effect another way. Tell the user it was declined and stop.',
        );
      }
    }

    const result = await this.deps.invoke(action, input);
    log(`agent → ${action} ${result.ok ? 'ok' : result.error.code}`);
    emit({ kind: 'toolResult', toolId, ok: result.ok, summary: summarize(input, result) });
    return result;
  }

  /** Called when the browser goes away mid-run, so nothing is left waiting on a dead socket. */
  dispose(): void {
    if (this.active) this.cancel(this.active.id);
    this.claudeSession = null;
  }

  private async start(runId: string, instruction: string, context?: RunContext): Promise<void> {
    const emit = (event: RunEvent) => this.deps.emit(runId, event);

    const text = instruction.trim();
    if (!text) return emit({ kind: 'error', code: 'INVALID_INPUT', message: 'Say what you want done.' });
    if (this.active) {
      return emit({
        kind: 'error',
        code: 'RUN_IN_PROGRESS',
        message: 'Another instruction is still running — cancel it first.',
      });
    }

    const routed = routeSkill(loadSkills(), text, context);
    if (!routed) {
      return emit({
        kind: 'error',
        code: 'NO_SKILL',
        message: `No skills found. Looked in ${skillDirNames().join(' and ')} — reinstall the package, or add a skill of your own.`,
      });
    }

    const config = readAgentConfig();
    // Mapping mode turns on the run's *identity*, never on front matter: `~/.voicelink/skills`
    // is parsed with no key allowlist, so a skill that could name its own privileges would be
    // granting them to itself. A hand-authored shadow of this name is `source: 'user'` and gets
    // an ordinary, fully locked-down run.
    const mapping = routed.base.name === SITE_MAPPER_SKILL && routed.base.source === 'bundled';
    if (mapping && !explicitlyAsked(text)) {
      return emit({
        kind: 'error',
        code: 'MAPPING_NOT_REQUESTED',
        message:
          'Mapping a site takes several minutes and drives this tab. Ask for it explicitly with the Map this site button, or by starting your message with @site-mapper.',
      });
    }

    const overlayNames = routed.overlays.map((overlay) => overlay.name);
    const run: ActiveRun = { id: runId, config, abort: new AbortController(), pending: new Map() };
    this.active = run;

    let built: { prompt: string; dropped: string[] };
    let instructionText = routed.text;
    try {
      if (mapping) {
        const prepared = await this.prepareMapping(run, routed.base, context, emit);
        if (!prepared) return;
        built = prepared.built;
        instructionText = prepared.instruction;
      } else {
        built = buildSystemPrompt(routed.base, routed.overlays);
      }
    } catch (error) {
      this.active = null;
      return emit({ kind: 'error', code: 'AGENT_FAILED', message: String(error) });
    }

    log(
      `agent run ${runId} started with skill "${routed.base.name}"` +
        (overlayNames.length ? ` + site notes [${overlayNames.join(', ')}]` : '') +
        (run.map ? ` mapping ${run.map.target.host}` : ''),
    );
    emit({ kind: 'started', skill: routed.base.name, overlays: [...overlayNames, ...built.dropped.map((n) => `${n} (too large — not applied)`)] });

    // A mapping run is a side quest, not part of the conversation: resuming it later would put
    // the whole crawl transcript behind the user's next message.
    const resume = !mapping && this.claudeSession !== null;
    const sessionId = mapping ? randomUUID() : (this.claudeSession ?? randomUUID());
    const budget = run.map ? setTimeout(() => run.abort.abort(), run.map.settings.timeoutMs) : undefined;

    try {
      const outcome = await runInstruction({
        runId,
        instruction: instructionText,
        systemPrompt: built.prompt,
        research: run.map ? run.map.settings.research : false,
        config: run.config,
        sessionId,
        resume,
        signal: run.abort.signal,
        emit,
      });
      // Only a session Claude Code actually created can be resumed by the next instruction.
      if (outcome.established) this.claudeSession = sessionId;
      log(`agent run ${runId} finished (${outcome.stopReason})`);
      emit({ kind: 'done', stopReason: outcome.stopReason });
    } catch (error) {
      const { code, message } = error instanceof RunError ? error : new RunError('AGENT_FAILED', String(error));
      log(`agent run ${runId} failed: ${code}: ${message}`);
      emit({ kind: 'error', code, message });
    } finally {
      clearTimeout(budget);
      // A mapping run that never submitted leaves nothing behind: an empty quarantine directory
      // would otherwise sit there until the next sweep looking like a map that failed to appear.
      if (run.map && !run.map.submitted) discardStaging(run.map.staging.id);
      // Only clear if this run is still the current one; a cancel may already have moved on.
      if (this.active === run) this.active = null;
    }
  }

  /**
   * Everything a mapping run needs before Claude Code starts: a target it is allowed to map, a
   * quarantine directory to write into, and the two phases that do not need a browser.
   *
   * Phase A (the sitemap) is plain Node, and Phase B (public background) is the run's own web
   * tools. Both feed the prompt as *fetched data* rather than as the user speaking — see
   * `buildSystemPrompt`'s third argument.
   */
  private async prepareMapping(
    run: ActiveRun,
    skill: Skill,
    context: RunContext | undefined,
    emit: (event: RunEvent) => void,
  ): Promise<{ built: { prompt: string; dropped: string[] }; instruction: string } | null> {
    if (!context?.url) {
      this.active = null;
      emit({ kind: 'error', code: 'INVALID_INPUT', message: 'Open the site you want mapped in this tab first.' });
      return null;
    }
    const target = mapTargetFor(context.url);
    if (!target.ok) {
      this.active = null;
      emit({ kind: 'error', code: 'MAPPING_REFUSED', message: target.message });
      return null;
    }

    sweepStaging();
    const settings = siteMapSettings(run.config);
    const staging = prepareStaging();

    const toolId = randomUUID();
    emit({ kind: 'tool', toolId, action: 'voicelink.readSitemap', input: { origin: target.target.origin } });
    let index: SiteIndex;
    try {
      index = await fetchSiteIndex(target.target.origin, run.abort.signal);
    } catch (error) {
      // A sitemap is a nice-to-have; a site without one still gets mapped by walking it.
      log('sitemap phase failed', error);
      index = { source: 'none', documents: 0, urlCount: 0, truncated: false, paths: [], patterns: [], raw: '' };
    }
    emit({
      kind: 'toolResult',
      toolId,
      ok: true,
      summary: index.urlCount ? `${index.urlCount} URLs from ${index.source}` : 'no sitemap published',
    });
    writeEvidence(staging, 'sitemap.txt', index.raw);

    run.map = {
      target: target.target,
      staging,
      index,
      settings,
      tabId: context.tabId,
      shots: 0,
      pagesVisited: new Set(),
      offSite: null,
      submitted: false,
    };

    const built = buildSystemPrompt(skill, [], fetchedBlock(target.target.origin, index));
    return { built, instruction: mappingBrief(target.target.host, settings) };
  }

  /**
   * The agent's one persistence channel. The report is typed, every leaf is scrubbed and capped,
   * and the daemon renders the document itself — the model fills slots, it never writes a file.
   */
  private submitSiteMap(run: ActiveRun, input: unknown): ActionResult {
    const map = run.map!;
    if (map.submitted) return failure('ALREADY_SUBMITTED', 'This run has already written its map.');

    const raw = (input as { report?: unknown } | undefined)?.report;
    if (JSON.stringify(raw ?? null).length > 256 * 1024) {
      return failure('MAPPING_REPORT_TOO_LARGE', 'That report is far too large. Summarize each page in a sentence.');
    }
    const checked = validateSiteMapReport(raw, {
      origin: map.target.origin,
      screenshots: stagedScreenshots(map.staging),
    });
    if (!checked.ok) return failure('INVALID_INPUT', checked.message);

    const draft = stageSiteMap({
      staging: map.staging,
      target: map.target,
      report: checked.report,
      index: map.index,
      background: null,
      warnings: checked.warnings,
      runId: run.id,
    });
    map.submitted = true;
    this.deps.draft(run.id, draft);
    log(`mapping run ${run.id} staged ${draft.name} (${draft.pages} pages, ${draft.screenshots} shots)`);
    return success({
      staged: true,
      name: draft.name,
      pages: draft.pages,
      message: 'The map is written and waiting for the user to review it. Tell them what you found, briefly.',
    });
  }

  private cancel(runId: string): void {
    if (!this.active || this.active.id !== runId) return;
    // Release anything blocked on approval first — an aborted run would otherwise leave a
    // tool call awaiting a promise that can never settle.
    for (const [, settle] of this.active.pending) settle(false);
    this.active.pending.clear();
    this.active.abort.abort();
    log(`agent run ${runId} cancelled`);
  }

  private awaitDecision(run: ActiveRun, toolId: string): Promise<boolean> {
    if (run.abort.signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const settle = (allow: boolean) => {
        run.pending.delete(toolId);
        resolve(allow);
      };
      run.pending.set(toolId, settle);
      run.abort.signal.addEventListener('abort', () => settle(false), { once: true });
    });
  }
}

/**
 * Mapping must be asked for, never inferred. Trigger scoring is `haystack.includes(...)`, and the
 * side panel listens continuously and auto-sends after a pause — so a phrase like "show me the
 * site map" spoken near the laptop would otherwise start a ten-minute crawl that screenshots
 * whatever is on screen.
 */
function explicitlyAsked(text: string): boolean {
  return /^@site-mapper\b/i.test(text.trim());
}

/** The sitemap findings, as data the run was handed rather than as anything anyone said. */
function fetchedBlock(origin: string, index: SiteIndex): string {
  if (!index.urlCount) return `No sitemap is published at ${origin}. Discover the site by walking its own links.`;
  const lines = [
    `## ${origin} sitemap (${index.source}, ${index.urlCount} URLs across ${index.documents} documents)`,
    '',
    '### Shapes',
    ...index.patterns.map((p) => `- ${p.pattern} — ${p.count} pages, e.g. ${p.example}`),
    '',
    '### Paths',
    ...index.paths.map((path) => `- ${path}`),
  ];
  if (index.truncated) lines.push('- (truncated: the sitemap lists more than was read)');
  return lines.join('\n');
}

function mappingBrief(host: string, settings: { maxPages: number; maxScreenshots: number }): string {
  return (
    `Map ${host}. Visit up to ${settings.maxPages} pages and take up to ${settings.maxScreenshots} screenshots, ` +
    `then call voicelink_saveSiteMap once with everything you found. Prefer breadth over depth: the landing page, ` +
    `the main navigation destinations, and one example of each repeated page shape. Record what you observed, ` +
    `not advice — a future assistant will read this to find its way around, and anything that reads like an ` +
    `instruction will be shown to the user as suspicious.`
  );
}

const SUMMARY_LIMIT = 80;

/** A one-line "what just happened" for the timeline — the detail, not the action name. */
function summarize(input: unknown, result: ActionResult): string {
  if (!result.ok) return clip(`${result.error.code}: ${result.error.message}`);

  // A screenshot's data is an image; describe it rather than dumping the base64 or the target.
  const shot = result.data as { dataUrl?: unknown; width?: unknown; height?: unknown; savedTo?: unknown } | null;
  if (shot && typeof shot.dataUrl === 'string') {
    const saved = typeof shot.savedTo === 'string' ? ` → ${shot.savedTo.split('/').pop()}` : '';
    return clip(`image ${shot.width ?? '?'}×${shot.height ?? '?'}${saved}`);
  }

  const target = (input as { target?: { text?: string; selector?: string } } | undefined)?.target;
  if (target?.text) return clip(`“${target.text}”`);
  if (target?.selector) return clip(target.selector);

  const data = result.data as Record<string, unknown> | null;
  for (const key of ['navigatedTo', 'navigatingTo', 'url', 'performed', 'value']) {
    const value = data?.[key];
    if (typeof value === 'string' && value) return clip(value);
  }
  return 'done';
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_LIMIT ? `${flat.slice(0, SUMMARY_LIMIT - 1)}…` : flat;
}
