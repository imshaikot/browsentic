import { randomUUID } from 'node:crypto';
import {
  failure,
  success,
  type ActionResult,
  type AttachedFile,
  type SavedRecording,
  type ExtensionRequest,
  type RunContext,
  type RunEvent,
} from '@/lib/actions/protocol';
import { READ_SITEMAP_ACTION } from '@/lib/actions/reserved';
import { SAVE_SITE_MAP_ACTION, SITE_MAPPER_SKILL, validateSiteMapReport } from '@/lib/skills/site-map';
import { log } from '../log';
import { readAgentConfig, siteMapSettings, type AgentConfig } from './config';
import { needsApproval } from './effects';
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
  invoke: (
    action: string,
    input?: unknown,
    opts?: { saveTo?: { dir: string; filename: string }; tabId?: number },
  ) => Promise<ActionResult>;
  emit: (runId: string, event: RunEvent) => void;
  draft: (runId: string, draft: import('@/lib/skills/site-map').SiteMapDraft) => void;
}

interface ActiveRun {
  id: string;
  config: AgentConfig;
  abort: AbortController;
  pending: Map<string, (allow: boolean) => void>;
  map?: MapRun;
}

export class AgentSession {
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

  async invokeForRun(runId: string, action: string, input?: unknown): Promise<ActionResult> {
    const run = this.active;
    if (!run || run.id !== runId) {
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

    if (needsApproval(run.config.requireApproval, action, input)) {
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
        built = buildSystemPrompt(routed.base, routed.overlays, {
          attachments: filesBlock(context?.files),
          recordings: recordingsBlock(context?.recordings),
        });
      }
    } catch (error) {
      this.active = null;
      return emit({ kind: 'error', code: 'AGENT_FAILED', message: String(error) });
    }

    if (run.abort.signal.aborted) {
      if (run.map) discardStaging(run.map.staging.id);
      if (this.active === run) this.active = null;
      log(`agent run ${runId} was cancelled before it started`);
      return emit({ kind: 'error', code: 'CANCELLED', message: 'Run cancelled.' });
    }

    log(
      `agent run ${runId} started with skill "${routed.base.name}"` +
        (overlayNames.length ? ` + site notes [${overlayNames.join(', ')}]` : '') +
        (run.map ? ` mapping ${run.map.target.host}` : ''),
    );
    emit({ kind: 'started', skill: routed.base.name, overlays: [...overlayNames, ...built.dropped.map((n) => `${n} (too large — not applied)`)] });

    const supplied = mapping ? null : validSessionId(context?.claudeSessionId);
    const known = supplied ?? this.claudeSession;
    const resume = !mapping && known !== null;
    const sessionId = mapping ? randomUUID() : (known ?? randomUUID());
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
      if (outcome.established) this.claudeSession = sessionId;
      if (!mapping) {
        if (outcome.established) emit({ kind: 'session', claudeSessionId: sessionId });
        else if (supplied) emit({ kind: 'session', claudeSessionId: null });
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
      if (this.active === run) this.active = null;
    }
  }

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
    if (!this.active || this.active.id !== runId) {
      log(`cancel for run ${runId}, which is not the active run`);
      this.deps.emit(runId, { kind: 'done', stopReason: 'cancelled' });
      return;
    }
    const cancelled = this.active;
    for (const [, settle] of cancelled.pending) settle(false);
    cancelled.pending.clear();
    cancelled.abort.abort();
    this.active = null;
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

function explicitlyAsked(text: string): boolean {
  return /^@site-mapper\b/i.test(text.trim());
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
    if (file.status === 'pending') lines.push('', 'VoiceLink is still reading this file; no notes yet.');
    else if (file.status === 'error') lines.push('', 'VoiceLink could not read this file, so there are no notes on it.');
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validSessionId(id: string | undefined): string | null {
  return typeof id === 'string' && UUID.test(id) ? id : null;
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
    `then call voicelink_saveSiteMap once with everything you found. Prefer breadth over depth: the landing page, ` +
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
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_LIMIT ? `${flat.slice(0, SUMMARY_LIMIT - 1)}…` : flat;
}
