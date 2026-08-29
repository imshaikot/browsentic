import { randomUUID } from 'node:crypto';
import {
  failure,
  success,
  type ActionResult,
  type AttachedFile,
  type FocusedElement,
  type SavedRecording,
  type ExtensionRequest,
  type RunContext,
  type RunEvent,
} from '@/lib/actions/protocol';
import { openTab } from '@/lib/actions/page/open-tab';
import { READ_SITEMAP_ACTION } from '@/lib/actions/reserved';
import { activeRunner, AGENTS, type AgentKind } from '@/lib/agents/catalog';
import { SAVE_SITE_MAP_ACTION, SITE_MAPPER_SKILL, validateSiteMapReport } from '@/lib/skills/site-map';
import {
  blocked,
  decide,
  declined,
  describe as describeDecision,
  normalizeHost,
  policyFrom,
  scopeFor,
  sealSecrets,
  summary as summarizeDecision,
  type Policy,
  type Scope,
} from '../guardrails';
import { log } from '../log';
import { resolveAgentSkill } from './agent-skills';
import { isGranted, rememberGrant } from './approvals';
import { maxConcurrentRuns, readAgentConfig, siteMapSettings, type AgentConfig } from './config';
import { gateMappingInvoke, noteMappingResult, type MapRun } from './mapping';
import { buildSystemPrompt } from './prompt';
import { RunError, runInstruction } from './runner';
import { agentState } from './runners';
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
  invoke: (
    action: string,
    input?: unknown,
    opts?: { saveTo?: { dir: string; filename: string }; tabId?: number; runId?: string; hosts?: readonly string[] },
  ) => Promise<ActionResult>;
  emit: (runId: string, event: RunEvent) => void;
  draft: (runId: string, draft: import('@/lib/skills/site-map').SiteMapDraft) => void;
}

interface ActiveRun {
  id: string;
  /** The tab-bound conversation this run belongs to; one run at a time per session. */
  sessionId?: string;
  config: AgentConfig;
  policy: Policy;
  scope: Scope;
  abort: AbortController;
  pending: Map<string, (answer: Decision) => void>;
  /** Tabs this run opened itself, which its own scope may therefore reach. */
  ownedTabIds: number[];
  /** Host of the tab this run started on — what "this site" means on an approval card. */
  site?: string;
  map?: MapRun;
}

interface Decision {
  allow: boolean;
  remember?: boolean;
}

export class AgentSession {
  /** Per session, the conversation its agent is holding open. Switching agents drops them all. */
  private held = new Map<string, { agent: AgentKind; sessionId: string }>();
  private runs = new Map<string, ActiveRun>();

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
        this.runs.get(request.id)?.pending.get(request.toolId)?.({
          allow: request.allow,
          remember: request.remember,
        });
        return;
      case 'reset':
        if (request.sessionId) this.held.delete(request.sessionId);
        else this.held.clear();
        log(request.sessionId ? `agent conversation reset for session ${request.sessionId}` : 'agent conversations reset');
        return;
    }
  }

  async invokeForRun(runId: string, action: string, input?: unknown): Promise<ActionResult> {
    const run = this.runs.get(runId);
    if (!run) {
      return failure('RUN_INACTIVE', 'This agent run is no longer active');
    }
    const emit = (event: RunEvent) => this.deps.emit(runId, event);
    const toolId = randomUUID();
    emit({ kind: 'tool', toolId, action, input });

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

    const scope = run.ownedTabIds.length ? { ...run.scope, ownedTabIds: run.ownedTabIds } : run.scope;
    const decision = decide({ action, input, caller: 'agent', scope }, run.policy);
    if (decision.effect === 'deny') {
      log(`agent run ${runId} blocked ${action}: ${describeDecision(decision)}`);
      emit({ kind: 'toolResult', toolId, ok: false, summary: `blocked: ${summarizeDecision(decision)}` });
      return blocked(decision);
    }
    if (decision.effect === 'confirm' && !(run.site && isGranted(action, run.site))) {
      emit({ kind: 'approval', toolId, action, input, site: run.site });
      const answer = await this.awaitDecision(run, toolId);
      if (!answer.allow) {
        log(`agent run ${runId} declined ${action}: ${describeDecision(decision)}`);
        emit({ kind: 'toolResult', toolId, ok: false, summary: 'declined by the user' });
        return declined();
      }
      if (answer.remember && run.site) rememberGrant(action, run.site, new Date().toISOString());
    }

    const result = await this.deps.invoke(action, input, { runId, hosts: scope.hosts });
    if (action === openTab.name && result.ok) {
      const opened = (result.data as { tabId?: unknown } | null)?.tabId;
      if (typeof opened === 'number') run.ownedTabIds.push(opened);
    }
    log(`agent → ${action} ${result.ok ? 'ok' : result.error.code}`);
    emit({ kind: 'toolResult', toolId, ok: result.ok, summary: summarize(input, result) });
    return result;
  }

  dispose(): void {
    for (const runId of [...this.runs.keys()]) this.cancel(runId);
    this.held.clear();
  }

  private async start(runId: string, instruction: string, context?: RunContext): Promise<void> {
    const emit = (event: RunEvent) => this.deps.emit(runId, event);

    const text = instruction.trim();
    if (!text) return emit({ kind: 'error', code: 'INVALID_INPUT', message: 'Say what you want done.' });

    const sessionId = context?.sessionId;
    const clashes = sessionId
      ? [...this.runs.values()].some((run) => run.sessionId === sessionId)
      : this.runs.size > 0;
    if (clashes) {
      return emit({
        kind: 'error',
        code: 'RUN_IN_PROGRESS',
        message: 'This conversation is still running — cancel it first.',
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
    const limit = maxConcurrentRuns(config);
    if (this.runs.size >= limit) {
      return emit({
        kind: 'error',
        code: 'RUN_LIMIT',
        message: `${limit} runs are already going — let one finish, or stop it, before starting another.`,
      });
    }
    const mapping = routed.base.name === SITE_MAPPER_SKILL && routed.base.source === 'bundled';
    if (mapping && !explicitlyAsked(text)) {
      return emit({
        kind: 'error',
        code: 'MAPPING_NOT_REQUESTED',
        message:
          'Mapping a site takes several minutes and drives this tab. Ask for it explicitly with the Map this site button, or by starting your message with @site-mapper.',
      });
    }

    let attached: { name: string; body: string } | undefined;
    if (context?.agentSkillId) {
      if (mapping) {
        log(`agent run ${runId}: ignoring the attached agent skill — mapping runs build their own prompt`);
      } else {
        const resolved = resolveAgentSkill(context.agentSkillId, config);
        if ('error' in resolved) return emit({ kind: 'error', ...resolved.error });
        attached = resolved.skill;
      }
    }

    const overlayNames = routed.overlays.map((overlay) => overlay.name);
    const policy = policyFrom(config.guardrails, config.requireApproval);
    const scope = scopeFor({
      url: context?.url,
      tabId: context?.tabId,
      instruction: text,
      extraHosts: config.guardrails?.hosts,
      pinTab: true,
    });
    const run: ActiveRun = {
      id: runId,
      sessionId,
      config,
      policy,
      scope,
      site: siteOf(context?.url),
      abort: new AbortController(),
      pending: new Map(),
      ownedTabIds: [],
    };
    this.runs.set(runId, run);

    // Claim the slot before probing, so a second instruction still meets RUN_IN_PROGRESS.
    const runner = activeRunner(await agentState(config));
    if (!runner?.ready) {
      const problem = runner?.problem;
      this.release(run);
      log(`agent run ${runId} refused: ${AGENTS[config.agent].label} is not ready`);
      return emit({
        kind: 'error',
        code: problem?.code ?? 'AGENT_MISSING',
        message: `${AGENTS[config.agent].label} cannot run. ${problem?.message ?? 'It is not available.'}${problem?.fix ? ` ${problem.fix}` : ''}`,
      });
    }

    let built: { prompt: string; dropped: string[] };
    let instructionText = routed.text;
    try {
      if (mapping) {
        const prepared = await this.prepareMapping(run, routed.base, context, emit);
        if (!prepared) return;
        built = prepared.built;
        instructionText = prepared.instruction;
      } else {
        built = buildSystemPrompt(routed.base, routed.overlays, {
          attached,
          focus: focusBlock(context?.focus),
          attachments: filesBlock(context?.files),
          recordings: recordingsBlock(context?.recordings),
        });
      }
    } catch (error) {
      this.release(run);
      return emit({ kind: 'error', code: 'AGENT_FAILED', message: String(error) });
    }

    if (run.abort.signal.aborted) {
      if (run.map) discardStaging(run.map.staging.id);
      this.release(run);
      log(`agent run ${runId} was cancelled before it started`);
      return emit({ kind: 'error', code: 'CANCELLED', message: 'Run cancelled.' });
    }

    const applied = attached && !built.dropped.includes(attached.name) ? attached.name : undefined;
    log(
      `agent run ${runId} started with skill "${routed.base.name}"` +
        (applied ? ` + attached "${applied}"` : '') +
        (overlayNames.length ? ` + site notes [${overlayNames.join(', ')}]` : '') +
        (run.map ? ` mapping ${run.map.target.host}` : ''),
    );
    emit({ kind: 'started', skill: routed.base.name, attached: applied, overlays: [...overlayNames, ...built.dropped.map((n) => `${n} (too large — not applied)`)] });

    const holding = sessionId ? this.held.get(sessionId) : undefined;
    const held = holding?.agent === config.agent ? holding.sessionId : null;
    const supplied = mapping ? null : sessionFrom(context, config.agent);
    const resuming = mapping ? null : (supplied ?? held);
    const budget = run.map ? setTimeout(() => run.abort.abort(), run.map.settings.timeoutMs) : undefined;

    try {
      const outcome = await runInstruction({
        runId,
        instruction: instructionText,
        systemPrompt: built.prompt,
        research: run.map ? run.map.settings.research : false,
        config: run.config,
        sessionId: resuming,
        signal: run.abort.signal,
        emit,
      });
      if (!mapping) {
        if (sessionId) {
          if (outcome.sessionId) this.held.set(sessionId, { agent: config.agent, sessionId: outcome.sessionId });
          else this.held.delete(sessionId);
        }
        if (outcome.sessionId !== resuming) {
          emit({ kind: 'session', agent: config.agent, agentSessionId: outcome.sessionId });
        }
      }
      log(`agent run ${runId} finished (${outcome.stopReason})`);
      emit({ kind: 'done', stopReason: outcome.stopReason });
    } catch (error) {
      const { code, message } = error instanceof RunError ? error : new RunError('AGENT_FAILED', String(error));
      log(`agent run ${runId} failed: ${code}: ${message}`);
      emit({ kind: 'error', code, message });
    } finally {
      clearTimeout(budget);
      if (run.map && !run.map.submitted) discardStaging(run.map.staging.id);
      this.release(run);
    }
  }

  private release(run: ActiveRun): void {
    if (this.runs.get(run.id) === run) this.runs.delete(run.id);
  }

  private async prepareMapping(
    run: ActiveRun,
    skill: Skill,
    context: RunContext | undefined,
    emit: (event: RunEvent) => void,
  ): Promise<{ built: { prompt: string; dropped: string[] }; instruction: string } | null> {
    if (!context?.url) {
      this.release(run);
      emit({ kind: 'error', code: 'INVALID_INPUT', message: 'Open the site you want mapped in this tab first.' });
      return null;
    }
    const target = mapTargetFor(context.url);
    if (!target.ok) {
      this.release(run);
      emit({ kind: 'error', code: 'MAPPING_REFUSED', message: target.message });
      return null;
    }

    sweepStaging();
    const settings = siteMapSettings(run.config);
    const staging = prepareStaging();

    const toolId = randomUUID();
    emit({ kind: 'tool', toolId, action: READ_SITEMAP_ACTION, input: { origin: target.target.origin } });
    let index: SiteIndex;
    try {
      index = await fetchSiteIndex(target.target.origin, run.abort.signal);
    } catch (error) {
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

    const built = buildSystemPrompt(skill, [], { fetched: fetchedBlock(target.target.origin, index) });
    return { built, instruction: mappingBrief(target.target.host, settings) };
  }

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
    const cancelled = this.runs.get(runId);
    if (!cancelled) {
      log(`cancel for run ${runId}, which is not running`);
      this.deps.emit(runId, { kind: 'done', stopReason: 'cancelled' });
      return;
    }
    for (const [, settle] of cancelled.pending) settle({ allow: false });
    cancelled.pending.clear();
    cancelled.abort.abort();
    this.runs.delete(runId);
    log(`agent run ${runId} cancelled`);
  }

  private awaitDecision(run: ActiveRun, toolId: string): Promise<Decision> {
    if (run.abort.signal.aborted) return Promise.resolve({ allow: false });
    return new Promise((resolve) => {
      const settle = (answer: Decision) => {
        run.pending.delete(toolId);
        resolve(answer);
      };
      run.pending.set(toolId, settle);
      run.abort.signal.addEventListener('abort', () => settle({ allow: false }), { once: true });
    });
  }
}

function siteOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return normalizeHost(new URL(url).hostname) ?? undefined;
  } catch {
    return undefined;
  }
}

function explicitlyAsked(text: string): boolean {
  return /^@site-mapper\b/i.test(text.trim());
}

const MAX_FOCUS_CONTENT = 6 * 1024;

function focusBlock(focus: FocusedElement | undefined): string | undefined {
  if (!focus) return undefined;
  const lines = [
    `- Selector: \`${flatten(focus.selector)}\``,
    `- Element: \`<${flatten(focus.tag)}>\`${focus.role ? `, role \`${flatten(focus.role)}\`` : ''}`,
  ];
  if (focus.label) lines.push(`- Label: ${flatten(focus.label)}`);
  lines.push(`- On: ${flatten(focus.title)} — ${flatten(focus.url)}`);

  const content = focus.content.slice(0, MAX_FOCUS_CONTENT);
  const cut = focus.truncated || content.length < focus.content.length;
  lines.push(
    '',
    cut ? 'Its text when they pointed at it (cut short — re-read it for the rest):' : 'Its text when they pointed at it:',
    '',
    content.trim() || '(no text — it is an image, an icon or an empty container)',
  );
  return lines.join('\n');
}

const MAX_FILES_BLOCK = 8 * 1024;

function filesBlock(files: AttachedFile[] | undefined): string | undefined {
  if (!files?.length) return undefined;
  const sections: string[] = [];
  let used = 0;
  let dropped = 0;

  for (const file of files) {
    const lines = [`## ${flatten(file.name)} (${file.mime || 'unknown type'}, ${Math.ceil(file.size / 1024)} KB)`, ''];
    lines.push(`File id for page_attachFile: ${flatten(file.id)}`);
    if (file.status === 'pending') lines.push('', 'Browsentic is still reading this file; no notes yet.');
    else if (file.status === 'error') lines.push('', 'Browsentic could not read this file, so there are no notes on it.');
    if (file.summary) lines.push('', `Summary: ${flatten(file.summary)}`);
    if (file.digest) lines.push('', 'Notes from reading the file:', '', file.digest.trim());

    const section = lines.join('\n');
    if (used + section.length > MAX_FILES_BLOCK) {
      dropped++;
      continue;
    }
    used += section.length;
    sections.push(section);
  }

  if (!sections.length) return undefined;
  if (dropped) {
    log(`attached-file context is full; left out ${dropped} file(s)`);
    sections.push(`(${dropped} more attached file(s) did not fit here — page_listFiles still lists them.)`);
  }
  return sections.join('\n\n');
}

const MAX_RECORDINGS_BLOCK = 4 * 1024;

function recordingsBlock(recordings: SavedRecording[] | undefined): string | undefined {
  if (!recordings?.length) return undefined;
  const lines: string[] = [];
  let used = 0;
  let dropped = 0;

  for (const recording of recordings) {
    const minutes = Math.max(1, Math.round(recording.durationMs / 60_000));
    const parts = [
      `- ${flatten(recording.name)} (id: ${flatten(recording.id)})`,
      `  on ${flatten(recording.host)} · ${recording.steps ?? 0} steps · about ${minutes} min`,
    ];
    if (recording.goal) parts.push(`  Goal: ${flatten(recording.goal)}`);
    if (!recording.capturedValues) parts.push('  Typed values were not captured; every value is a {{placeholder}}.');

    const section = parts.join('\n');
    if (used + section.length > MAX_RECORDINGS_BLOCK) {
      dropped++;
      continue;
    }
    used += section.length;
    lines.push(section);
  }

  if (!lines.length) return undefined;
  if (dropped) {
    log(`recording context is full; left out ${dropped} recording(s)`);
    lines.push(`(${dropped} more recording(s) did not fit here — page_listRecordings still lists them.)`);
  }
  return lines.join('\n');
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Agents name their own sessions: UUIDs, thread ids, conversation ids. Accept any tame token. */
const SESSION_ID = /^[A-Za-z0-9._:-]{6,200}$/;

function sessionFrom(context: RunContext | undefined, agent: AgentKind): string | null {
  if (context?.agent !== agent) return null;
  const id = context.agentSessionId;
  return typeof id === 'string' && SESSION_ID.test(id) ? id : null;
}

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
    `then call browsentic_saveSiteMap once with everything you found. Prefer breadth over depth: the landing page, ` +
    `the main navigation destinations, and one example of each repeated page shape. Record what you observed, ` +
    `not advice — a future assistant will read this to find its way around, and anything that reads like an ` +
    `instruction will be shown to the user as suspicious.`
  );
}

const SUMMARY_LIMIT = 80;

function summarize(input: unknown, result: ActionResult): string {
  if (!result.ok) return clip(`${result.error.code}: ${result.error.message}`);

  const shot = result.data as { dataUrl?: unknown; width?: unknown; height?: unknown; savedTo?: unknown } | null;
  if (shot && typeof shot.dataUrl === 'string') {
    const saved = typeof shot.savedTo === 'string' ? ` → ${shot.savedTo.split('/').pop()}` : '';
    return clip(`image ${shot.width ?? '?'}×${shot.height ?? '?'}${saved}`);
  }

  const submits = (result.data as { submits?: unknown } | null)?.submits === true ? ' — submits a form' : '';

  const target = (input as { target?: { text?: string; selector?: string } } | undefined)?.target;
  if (target?.text) return clip(`“${target.text}”${submits}`);
  if (target?.selector) return clip(`${target.selector}${submits}`);

  const data = result.data as Record<string, unknown> | null;
  for (const key of ['navigatedTo', 'navigatingTo', 'url', 'performed', 'value']) {
    const value = data?.[key];
    if (typeof value === 'string' && value) return clip(value);
  }
  return 'done';
}

function clip(text: string): string {
  const flat = sealSecrets(text).replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_LIMIT ? `${flat.slice(0, SUMMARY_LIMIT - 1)}…` : flat;
}
