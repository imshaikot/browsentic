import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { failure, success, type ActionResult, type SocketFrame } from '@/lib/actions/protocol';
import { log } from '../log';
import type { AgentConfig } from './config';
import { RunError, runAgentJson, taskDir } from './runner';

type AnalyzeFileFrame = Extract<SocketFrame, { t: 'analyzeFile' }>;

const MAX_BYTES = 10 * 1024 * 1024;
const SUMMARIZE_TIMEOUT_MS = 60_000;

export async function summarizeFile(
  req: AnalyzeFileFrame,
  config: AgentConfig,
): Promise<ActionResult<{ summary: string; digest?: string }>> {
  const bytes = Buffer.from(req.content, 'base64');
  if (bytes.length === 0) return failure('INVALID_INPUT', 'The file is empty.');
  if (bytes.length > MAX_BYTES) {
    return failure('FILE_TOO_LARGE', `Files over ${Math.round(MAX_BYTES / 1024 / 1024)} MB are not summarized.`);
  }

  const tmpDir = taskDir(config);
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const path = join(tmpDir, `${randomUUID()}-${safeName(req.name)}`);
  writeFileSync(path, bytes, { mode: 0o600 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUMMARIZE_TIMEOUT_MS);
  log(`summarizing ${req.name} (${bytes.length} bytes, ${req.mime || 'unknown type'})`);
  try {
    const output = await runAgentJson(promptFor(path, req), config, controller.signal, {
      reads: true,
      timedOut: 'Summarizing the file took too long.',
      empty: 'The agent returned an empty summary.',
    });
    const { summary, digest } = split(output);
    log(`summarized ${req.name}${digest ? ` (+${digest.length} chars of notes)` : ''}`);
    return success({ summary, digest });
  } catch (error) {
    const { code, message } = error instanceof RunError ? error : new RunError('AGENT_FAILED', String(error));
    log(`summarizing ${req.name} failed: ${code}: ${message}`);
    return failure(code, message);
  } finally {
    clearTimeout(timer);
    try {
      unlinkSync(path);
    } catch {
    }
  }
}

const MAX_DIGEST_CHARS = 4_000;
const MAX_SUMMARY_CHARS = 500;

const SUMMARY_HEADING = '=== SUMMARY ===';
const NOTES_HEADING = '=== NOTES ===';

function promptFor(path: string, req: AnalyzeFileFrame): string {
  return (
    `Read the file at ${path}. Its original name is "${req.name}"${req.mime ? ` (type: ${req.mime})` : ''}.\n\n` +
    `Output exactly two sections, in this order, with these headings on their own lines and ` +
    `nothing before or after them:\n\n` +
    `${SUMMARY_HEADING}\n` +
    `2-4 sentences on what this file is and what it contains, enough to recognize it later.\n\n` +
    `${NOTES_HEADING}\n` +
    `Up to ${MAX_DIGEST_CHARS} characters capturing what is actually in the file, for an ` +
    `assistant that will have to answer questions about it without being able to open it. Keep ` +
    `the structure (headings, sections, columns) and the specifics that cannot be re-derived — ` +
    `figures, names, dates, totals, identifiers, key wording. Prefer terse lines over prose. If ` +
    `the file is too large to cover, say what you covered and what you left out.`
  );
}

function split(output: string): { summary: string; digest?: string } {
  const marker = output.indexOf(NOTES_HEADING);
  const head = (marker === -1 ? output : output.slice(0, marker)).replace(SUMMARY_HEADING, '').trim();
  const notes = marker === -1 ? '' : output.slice(marker + NOTES_HEADING.length).trim();
  return {
    summary: (head || notes || output.trim()).slice(0, MAX_SUMMARY_CHARS),
    digest: notes ? notes.slice(0, MAX_DIGEST_CHARS) : undefined,
  };
}

function safeName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 100);
  return cleaned || 'file';
}
