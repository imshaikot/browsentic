import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { failure, success, type ActionResult, type SocketFrame } from '@/lib/actions/protocol';
import { stateDir } from '../lockfile';
import { log } from '../log';
import type { AgentConfig } from './config';
import { RunError, runClaudeJson } from './runner';

type AnalyzeFileFrame = Extract<SocketFrame, { t: 'analyzeFile' }>;

/** Files larger than this are rejected before we spend a summarizer run on them. */
const MAX_BYTES = 10 * 1024 * 1024;
/** Bound the summarizer so a stuck child cannot hold a file "Analyzing…" forever. */
const SUMMARIZE_TIMEOUT_MS = 60_000;

const tmpDir = join(stateDir, 'tmp');

/**
 * Summarize one attached file with a one-shot `claude -p`, outside the agent conversation.
 *
 * We write the bytes to a temp file under the state dir and let Claude Code's own `Read` tool
 * open it — Read natively parses text, PDFs, images and notebooks, so rich documents summarize
 * with no extra dependency. Read is the only allowed tool and only reaches inside the state dir
 * (its working directory); everything else (Bash/Edit/Write/web/subagents) stays denied.
 * `.docx`/`.xlsx` are the known gap Read does not parse.
 */
export async function summarizeFile(
  req: AnalyzeFileFrame,
  config: AgentConfig,
): Promise<ActionResult<{ summary: string; digest?: string }>> {
  const bytes = Buffer.from(req.content, 'base64');
  if (bytes.length === 0) return failure('INVALID_INPUT', 'The file is empty.');
  if (bytes.length > MAX_BYTES) {
    return failure('FILE_TOO_LARGE', `Files over ${Math.round(MAX_BYTES / 1024 / 1024)} MB are not summarized.`);
  }

  mkdirSync(tmpDir, { recursive: true });
  const path = join(tmpDir, `${randomUUID()}-${safeName(req.name)}`);
  writeFileSync(path, bytes);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUMMARIZE_TIMEOUT_MS);
  log(`summarizing ${req.name} (${bytes.length} bytes, ${req.mime || 'unknown type'})`);
  try {
    const output = await runClaudeJson(promptFor(path, req), config, controller.signal, {
      // Read is the whole point of this one — it natively parses text, PDFs, images and notebooks.
      allowedTools: ['Read'],
      timedOut: 'Summarizing the file took too long.',
      empty: 'Claude Code returned an empty summary.',
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
      // Best effort — a leftover temp file is harmless.
    }
  }
}

/** How much of the file's contents to keep. This is the whole of what a later run gets to see. */
const MAX_DIGEST_CHARS = 4_000;
/** The summary is one line in the panel's file chip, so it is capped like one. */
const MAX_SUMMARY_CHARS = 500;

const SUMMARY_HEADING = '=== SUMMARY ===';
const NOTES_HEADING = '=== NOTES ===';

/**
 * Two things are wanted from one read, because the file is only on disk during this call: the
 * line the panel shows, and the extract that later runs are given as their only view of the file
 * (see `filesBlock` in agent/service.ts). Asking for both in one pass keeps it to one spawn.
 */
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

/**
 * Split the two sections back apart. A misbehaving child that ignored the format still gives a
 * usable summary — the whole reply becomes one, which is what the old single-section prompt
 * returned anyway — so this never fails the analysis over its shape.
 */
function split(output: string): { summary: string; digest?: string } {
  const marker = output.indexOf(NOTES_HEADING);
  const head = (marker === -1 ? output : output.slice(0, marker)).replace(SUMMARY_HEADING, '').trim();
  const notes = marker === -1 ? '' : output.slice(marker + NOTES_HEADING.length).trim();
  // Capped even in the no-heading case: the prompt asks for thousands of characters of notes, so an
  // ignored format would otherwise put all of them in the field every consumer treats as one line.
  return {
    summary: (head || notes || output.trim()).slice(0, MAX_SUMMARY_CHARS),
    digest: notes ? notes.slice(0, MAX_DIGEST_CHARS) : undefined,
  };
}

/** Strip anything that could escape the temp dir or upset the filesystem. */
function safeName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 100);
  return cleaned || 'file';
}
