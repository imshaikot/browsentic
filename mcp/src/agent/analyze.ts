import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { failure, success, type ActionResult, type SocketFrame } from '@/lib/actions/protocol';
import { stateDir } from '../lockfile';
import { log } from '../log';
import type { AgentConfig } from './config';
import { RunError, spawnClaude } from './runner';

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
): Promise<ActionResult<{ summary: string }>> {
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
    const summary = await runClaudeJson(promptFor(path, req), config, controller.signal);
    log(`summarized ${req.name}`);
    return success({ summary });
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

function promptFor(path: string, req: AnalyzeFileFrame): string {
  return (
    `Read the file at ${path} and write a concise 2-4 sentence summary of what it is and its ` +
    `key contents, so it can be recognized later. The file's original name is "${req.name}"` +
    `${req.mime ? ` (type: ${req.mime})` : ''}. Output only the summary, with no preamble.`
  );
}

/** One run of `claude -p --output-format json`; resolves the `result` text or rejects RunError. */
function runClaudeJson(prompt: string, config: AgentConfig, signal: AbortSignal): Promise<string> {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    // Read is the whole point; everything else stays off so a file can't talk the agent out of its lane.
    '--allowedTools',
    'Read',
    '--disallowedTools',
    'Bash',
    'Edit',
    'Write',
    'NotebookEdit',
    'Glob',
    'Grep',
    'WebFetch',
    'WebSearch',
    'Task',
    ...(config.model ? ['--model', config.model] : []),
    ...(config.effort ? ['--effort', config.effort] : []),
  ];

  return new Promise<string>((resolve, reject) => {
    const { child, release } = spawnClaude(args, config, signal);
    let stdout = '';
    let stderrTail = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2_000);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      release();
      if (error.code === 'ENOENT') {
        reject(
          new RunError(
            'NO_CLAUDE',
            `Could not find "${config.claudeBin}". Install Claude Code, or set {"claudeBin": "/path/to/claude"} in the daemon's config.json.`,
          ),
        );
      } else {
        reject(new RunError('AGENT_FAILED', error.message));
      }
    });

    child.on('close', () => {
      release();
      if (signal.aborted) return reject(new RunError('TIMEOUT', 'Summarizing the file took too long.'));
      let parsed: { is_error?: boolean; subtype?: string; result?: unknown };
      try {
        parsed = JSON.parse(stdout) as typeof parsed;
      } catch {
        return reject(
          new RunError(
            'AGENT_FAILED',
            `Claude Code returned no parseable result${stderrTail ? `: ${stderrTail.trim()}` : ''}`,
          ),
        );
      }
      if (parsed.is_error) {
        return reject(new RunError('AGENT_FAILED', String(parsed.result || parsed.subtype || 'Claude Code reported an error')));
      }
      const summary = typeof parsed.result === 'string' ? parsed.result.trim() : '';
      if (!summary) return reject(new RunError('AGENT_FAILED', 'Claude Code returned an empty summary.'));
      resolve(summary);
    });
  });
}

/** Strip anything that could escape the temp dir or upset the filesystem. */
function safeName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 100);
  return cleaned || 'file';
}
