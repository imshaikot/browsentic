import { randomUUID } from 'node:crypto';
import type { AttachedFile, HandedFile, RunEvent } from '@/lib/actions/protocol';
import { READ_FILE_ACTION } from '@/lib/actions/reserved';
import type { AgentKind } from '@/lib/agents/catalog';
import { refusal, validateFileReport, verdictLabel, type FileReport } from '@/lib/files/report';
import { log } from '../log';

export const MAX_REPORTS_BLOCK = 16 * 1024;

export interface Handover {
  /** Reports this conversation's agent has not been given, to carry in this turn's message. */
  reports?: string;
  /** Files whose reports it already holds, for the system prompt. */
  known?: string;
  handed: HandedFile[];
}

export interface HandoverDeps {
  agent: AgentKind;
  signal: AbortSignal;
  emit: (event: RunEvent) => void;
  wait: (fileId: string, signal: AbortSignal) => Promise<FileReport | null>;
}

/**
 * Settles what a turn tells its agent about attached files. A report travels once, inside
 * the message, so the agent's own session holds it from then on; one still being written
 * is waited for, because the turn it misses is the one the user is asking about it in.
 */
export async function handOver(files: AttachedFile[] | undefined, deps: HandoverDeps): Promise<Handover> {
  const known = (files ?? []).filter((file) => file.delivered);
  const fresh = (files ?? []).filter((file) => !file.delivered);
  const reports = await Promise.all(fresh.map((file) => reportOn(file, deps)));
  if (deps.signal.aborted) return { handed: [] };

  const sections: string[] = [];
  const handed: HandedFile[] = [];
  let used = 0;
  fresh.forEach((file, index) => {
    const report = reports[index];
    const section = reportSection(file, report);
    if (used + section.length > MAX_REPORTS_BLOCK) return;
    used += section.length;
    sections.push(section);
    handed.push({ id: file.id, name: file.name, verdict: report.verdict, code: report.reason?.code });
  });
  if (handed.length < fresh.length) log(`attached-file reports are full; ${fresh.length - handed.length} wait for the next turn`);

  return {
    reports: sections.length ? sections.join('\n\n') : undefined,
    known: known.length ? known.map(knownLine).join('\n') : undefined,
    handed,
  };
}

async function reportOn(file: AttachedFile, deps: HandoverDeps): Promise<FileReport> {
  if (file.report) {
    const checked = validateFileReport(file.report);
    return checked.ok ? checked.report : refusal('failed', deps.agent, 'AGENT_FAILED', 'The report on this file was damaged; re-attach it.');
  }

  const toolId = randomUUID();
  deps.emit({ kind: 'tool', toolId, action: READ_FILE_ACTION, input: { name: file.name } });
  const report =
    (await deps.wait(file.id, deps.signal)) ??
    refusal('failed', deps.agent, 'AGENT_FAILED', 'Browsentic lost track of this file’s analysis — remove it and attach it again.');
  deps.emit({
    kind: 'toolResult',
    toolId,
    ok: report.verdict === 'analyzed',
    summary: `${flatten(file.name)} — ${verdictLabel(report.verdict, report.reason?.code)}`,
  });
  return report;
}

function reportSection(file: AttachedFile, report: FileReport): string {
  const lines = [
    `## ${flatten(file.name)} (${file.mime || 'unknown type'}, ${Math.ceil(file.size / 1024)} KB)`,
    '',
    `File id for page_attachFile: ${flatten(file.id)}`,
  ];
  if (report.verdict !== 'analyzed') {
    const word = report.verdict === 'rejected' ? 'Rejected' : 'Could not be read';
    lines.push(`${word} — not read: ${flatten(report.reason?.message ?? 'no reason given')}`);
    return lines.join('\n');
  }

  lines.push(`Read ${report.coverage === 'partial' ? 'in part' : 'in full'}${report.kind ? ` as ${report.kind}` : ''}.`);
  if (report.summary) lines.push('', `Summary: ${report.summary}`);
  if (report.outline?.length) lines.push('', 'Outline:', ...report.outline.map((line) => `- ${line}`));
  if (report.facts?.length) lines.push('', 'Facts:', ...report.facts.map((fact) => `- ${fact}`));
  if (report.notes) lines.push('', 'Notes:', '', report.notes);
  if (report.omitted) lines.push('', `Not covered: ${report.omitted}`);
  return lines.join('\n');
}

function knownLine(file: AttachedFile): string {
  const verdict = file.report ? verdictLabel(file.report.verdict, file.report.reason?.code) : 'reported earlier';
  return `- ${flatten(file.name)} — file id ${flatten(file.id)} — ${verdict}`;
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim();
