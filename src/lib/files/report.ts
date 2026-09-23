import { AGENT_KINDS, type AgentKind } from '@/lib/agents/catalog';
import { clip, scrub, scrubLines } from '@/lib/skills/scrub';

export const FILE_KINDS = ['text', 'pdf', 'image'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_VERDICTS = ['analyzed', 'rejected', 'failed'] as const;
/** `rejected`: the file is not one Browsentic reads, so trying again changes nothing. `failed`: the analyst broke, so it may. */
export type FileVerdict = (typeof FILE_VERDICTS)[number];

const MB = 1024 * 1024;

/** Above this the browser keeps only the file's name and size, and the analyst rejects it unread. */
export const MAX_STORED_FILE_BYTES = 10 * MB;

export const FILE_LIMITS: Record<FileKind, number> = { text: 5 * MB, pdf: 10 * MB, image: 5 * MB };

export const REPORT_LIMITS = {
  summary: 500,
  outline: 20,
  outlineLine: 160,
  facts: 30,
  fact: 200,
  notes: 4_000,
  omitted: 300,
  reason: 300,
} as const;

export interface FileReport {
  verdict: FileVerdict;
  /** The agent the analyst ran on. Absent when the browser never reached the daemon at all. */
  agent?: AgentKind;
  kind?: FileKind;
  reason?: { code: string; message: string };
  summary?: string;
  outline?: string[];
  facts?: string[];
  notes?: string;
  coverage?: 'full' | 'partial';
  omitted?: string;
}

export type ReportValidation = { ok: true; report: FileReport } | { ok: false; message: string };

const REASON_CODE = /^[A-Z][A-Z_]{1,39}$/;

export function validateFileReport(input: unknown): ReportValidation {
  if (!input || typeof input !== 'object') return { ok: false, message: 'The report is not an object.' };
  const raw = input as Partial<Record<keyof FileReport, unknown>>;

  const verdict = FILE_VERDICTS.find((known) => known === raw.verdict);
  if (!verdict) return { ok: false, message: 'The report has no verdict.' };
  const agent = AGENT_KINDS.find((known) => known === raw.agent);
  const kind = FILE_KINDS.find((known) => known === raw.kind);

  if (verdict !== 'analyzed') {
    const reason = reasonOf(raw.reason);
    if (!reason) return { ok: false, message: 'A report that did not read the file has to say why.' };
    return { ok: true, report: { verdict, agent, kind, reason } };
  }

  const summary = line(raw.summary, REPORT_LIMITS.summary);
  if (!summary) return { ok: false, message: 'The report has no summary.' };
  const coverage = raw.coverage === 'partial' ? 'partial' : 'full';
  return {
    ok: true,
    report: {
      verdict,
      agent,
      kind,
      summary,
      outline: listOf(raw.outline, REPORT_LIMITS.outline, REPORT_LIMITS.outlineLine),
      facts: listOf(raw.facts, REPORT_LIMITS.facts, REPORT_LIMITS.fact),
      notes: scrubLines(raw.notes, REPORT_LIMITS.notes) || undefined,
      coverage,
      omitted: coverage === 'partial' ? line(raw.omitted, REPORT_LIMITS.omitted) || undefined : undefined,
    },
  };
}

export function refusal(
  verdict: Exclude<FileVerdict, 'analyzed'>,
  agent: AgentKind | undefined,
  code: string,
  message: string,
  kind?: FileKind,
): FileReport {
  return { verdict, agent, kind, reason: { code, message: line(message, REPORT_LIMITS.reason) } };
}

const REASON_LABELS: Record<string, string> = {
  UNSUPPORTED_TYPE: 'unsupported type',
  FILE_TOO_LARGE: 'too large',
  EMPTY: 'empty',
  UNREADABLE: 'unreadable',
  TIMEOUT: 'timed out',
  CANCELLED: 'cancelled',
};

/** “analyzed”, “rejected (unsupported type)”, “failed (timed out)” — one line for a notice or a list. */
export function verdictLabel(verdict: FileVerdict, code?: string): string {
  if (verdict === 'analyzed') return verdict;
  return `${verdict} (${(code && REASON_LABELS[code]) ?? (verdict === 'failed' ? 'analysis failed' : 'not read')})`;
}

/** A report counts as handed over only to the agent session that received it; a new one gets it again. */
export function isDelivered(deliveredTo: string | undefined, agentSessionId: string | undefined): boolean {
  return agentSessionId !== undefined && deliveredTo === agentSessionId;
}

/** One line, cut with an ellipsis rather than mid-word. */
function line(value: unknown, limit: number): string {
  return clip(scrub(value, limit * 2), limit);
}

function reasonOf(value: unknown): FileReport['reason'] | null {
  const raw = value as { code?: unknown; message?: unknown } | null;
  const code = typeof raw?.code === 'string' ? raw.code.trim() : '';
  const message = line(raw?.message, REPORT_LIMITS.reason);
  return REASON_CODE.test(code) && message ? { code, message } : null;
}

function listOf(value: unknown, count: number, length: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .slice(0, count)
    .map((item) => line(item, length))
    .filter(Boolean);
  return items.length ? items : undefined;
}
