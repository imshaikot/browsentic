import { describe, expect, test } from 'vitest';
import { isDelivered, refusal, validateFileReport, verdictLabel } from './report';

const analyzed = {
  verdict: 'analyzed',
  agent: 'claude',
  kind: 'text',
  summary: 'A two-row expense sheet.',
  outline: ['date', 'amount'],
  facts: ['12.50 on 2026-08-01'],
  notes: 'date,amount\n2026-08-01,12.50',
  coverage: 'full',
};

describe('checking a report', () => {
  test('a well-formed report comes back as it was written', () => {
    expect(validateFileReport(analyzed)).toEqual({ ok: true, report: { ...analyzed, omitted: undefined } });
  });

  test('every field is cut to its limit, and lists to their length', () => {
    const checked = validateFileReport({
      ...analyzed,
      summary: 's'.repeat(600),
      outline: Array.from({ length: 30 }, () => 'o'.repeat(200)),
      facts: Array.from({ length: 40 }, () => 'f'.repeat(300)),
      notes: 'n'.repeat(5_000),
    });
    const report = checked.ok ? checked.report : null;
    expect([
      report?.summary?.length,
      report?.outline?.length,
      report?.outline?.[0].length,
      report?.facts?.length,
      report?.facts?.[0].length,
      report?.notes?.length,
    ]).toEqual([500, 20, 160, 30, 200, 4_000]);
  });

  test('notes keep their lines, but lose control characters and runs of blank lines', () => {
    const checked = validateFileReport({ ...analyzed, notes: 'a\r\nb\u0007\n\n\n\nc' });
    expect(checked.ok && checked.report.notes).toBe('a\nb\n\nc');
  });

  test('what was left out is kept only when the report says it covered part of the file', () => {
    const partial = validateFileReport({ ...analyzed, coverage: 'partial', omitted: 'pages 40-90' });
    const full = validateFileReport({ ...analyzed, omitted: 'pages 40-90' });
    expect([partial.ok && partial.report.omitted, full.ok && full.report.omitted]).toEqual(['pages 40-90', undefined]);
  });

  test('empty lists are left out rather than kept empty', () => {
    const checked = validateFileReport({ ...analyzed, outline: ['  '], facts: [] });
    expect(checked.ok && [checked.report.outline, checked.report.facts]).toEqual([undefined, undefined]);
  });

  test.each([
    ['not an object', 'report', 'The report is not an object.'],
    ['no verdict', { ...analyzed, verdict: 'maybe' }, 'The report has no verdict.'],
    ['no summary', { ...analyzed, summary: ' ' }, 'The report has no summary.'],
    ['a refusal without a reason', { verdict: 'rejected', agent: 'claude' }, 'A report that did not read the file has to say why.'],
    ['a reason code that is not a code', { verdict: 'failed', agent: 'claude', reason: { code: 'oops', message: 'x' } }, 'A report that did not read the file has to say why.'],
  ])('%s is refused', (_, input, message) => {
    expect(validateFileReport(input)).toEqual({ ok: false, message });
  });

  test('a refusal carries only its reason, whatever else it was sent with', () => {
    expect(validateFileReport({ verdict: 'rejected', agent: 'codex', kind: 'pdf', summary: 'ignored', reason: { code: 'UNSUPPORTED_TYPE', message: 'No PDFs.' } })).toEqual({
      ok: true,
      report: { verdict: 'rejected', agent: 'codex', kind: 'pdf', reason: { code: 'UNSUPPORTED_TYPE', message: 'No PDFs.' } },
    });
  });

  test('a report the browser wrote itself names no agent, and one naming an unknown agent loses the name', () => {
    const local = refusal('failed', undefined, 'EXTENSION_OFFLINE', 'No Browsentic daemon is attached.');
    const unknown = validateFileReport({ ...analyzed, agent: 'someone' });
    expect([validateFileReport(local), unknown.ok && unknown.report.agent]).toEqual([{ ok: true, report: local }, undefined]);
  });

  test('a refusal built here passes the same check', () => {
    const built = refusal('failed', 'claude', 'TIMEOUT', 'Reading the file took too long.', 'text');
    expect(validateFileReport(built)).toEqual({ ok: true, report: built });
  });
});

describe('naming a verdict', () => {
  test.each([
    ['analyzed', undefined, 'analyzed'],
    ['rejected', 'UNSUPPORTED_TYPE', 'rejected (unsupported type)'],
    ['rejected', 'SOMETHING_NEW', 'rejected (not read)'],
    ['failed', 'TIMEOUT', 'failed (timed out)'],
    ['failed', 'AGENT_FAILED', 'failed (analysis failed)'],
  ] as const)('%s with %s reads “%s”', (verdict, code, label) => {
    expect(verdictLabel(verdict, code)).toBe(label);
  });
});

describe('whether an agent already holds a report', () => {
  test('only the agent session it was handed to holds it', () => {
    expect([
      isDelivered('session-1', 'session-1'),
      isDelivered('session-1', 'session-2'),
      isDelivered(undefined, 'session-1'),
      isDelivered(undefined, undefined),
    ]).toEqual([true, false, false, false]);
  });
});
