import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { summarizeFile } from './analyze';
import { readAgentConfig } from './config';
import { RunError, runAgentJson, taskDir } from './runner';

vi.mock('./runner', async (importOriginal) => ({ ...(await importOriginal<typeof import('./runner')>()), runAgentJson: vi.fn() }));

const agent = vi.mocked(runAgentJson);
const config = readAgentConfig();
const csv = 'date,amount\n2026-08-01,12.50\n';
const summarize = (content: string | Buffer, name = 'expenses.csv', mime = 'text/csv') =>
  summarizeFile({ t: 'analyzeFile', id: 'f1', name, mime, size: content.length, content: Buffer.from(content).toString('base64') }, config);

/** The path the agent was told to read, and what was in it at that moment. */
let handed: { path: string; content: string; mode: number } | null;

beforeEach(() => {
  rmSync(taskDir(config), { recursive: true, force: true });
  handed = null;
  agent.mockReset();
  agent.mockImplementation(async (prompt) => {
    const path = /Read the file at (\S+)\. /.exec(prompt)?.[1] ?? '';
    handed = { path, content: readFileSync(path, 'utf8'), mode: statSync(path).mode & 0o777 };
    return '=== SUMMARY ===\nA two-row expense sheet.\n\n=== NOTES ===\ndate,amount — 12.50 on 2026-08-01';
  });
});

describe('summarizing an attached file', () => {
  test('the agent writes a summary to show and notes to answer questions from', async () => {
    expect(await summarize(csv)).toEqual({ ok: true, data: { summary: 'A two-row expense sheet.', digest: 'date,amount — 12.50 on 2026-08-01' } });
  });

  test("the file is put in the agent's own workspace for it to read, readable only by the user, and the agent may read", async () => {
    await summarize(csv);
    expect([dirname(handed?.path ?? ''), handed?.content, handed?.mode, agent.mock.calls[0][3].reads]).toEqual([taskDir(config), csv, 0o600, true]);
  });

  test('the copy is deleted afterwards, whether or not the agent managed', async () => {
    await summarize(csv);
    agent.mockRejectedValueOnce(new RunError('TIMEOUT', 'Summarizing the file took too long.'));
    await summarize(csv);
    expect(readdirSync(taskDir(config))).toEqual([]);
  });

  test("the file's own name cannot steer where its copy goes", async () => {
    await summarize(csv, '../../.ssh/authorized_keys');
    expect([dirname(handed?.path ?? ''), basename(handed?.path ?? '').endsWith('-ssh_authorized_keys')]).toEqual([taskDir(config), true]);
  });

  test('an empty file, or one over 10 MB, is not sent', async () => {
    expect([await summarize(''), await summarize(Buffer.alloc(10 * 1024 * 1024 + 1)), agent.mock.calls.length]).toEqual([
      { ok: false, error: { code: 'INVALID_INPUT', message: 'The file is empty.' } },
      { ok: false, error: { code: 'FILE_TOO_LARGE', message: 'Files over 10 MB are not summarized.' } },
      0,
    ]);
  });
});

describe('reading the answer', () => {
  const answering = async (output: string) => {
    agent.mockResolvedValue(output);
    const result = await summarize(csv);
    return result.ok ? result.data : result.error;
  };

  test('an answer without the headings is all summary', async () => {
    expect(await answering('Just a CSV.')).toEqual({ summary: 'Just a CSV.', digest: undefined });
  });

  test('an answer with only notes takes its summary from them', async () => {
    expect(await answering('=== NOTES ===\nTwo rows.')).toEqual({ summary: 'Two rows.', digest: 'Two rows.' });
  });

  test('the summary is cut to 500 characters and the notes to 4,000', async () => {
    const { summary, digest } = (await answering(`=== SUMMARY ===\n${'s'.repeat(600)}\n=== NOTES ===\n${'n'.repeat(5_000)}`)) as { summary: string; digest: string };
    expect([summary.length, digest.length]).toEqual([500, 4_000]);
  });

  test("the agent's failure is passed on as it was reported", async () => {
    agent.mockRejectedValue(new RunError('AGENT_NEEDS_PERMISSION', 'Antigravity soft-denies MCP tools.'));
    expect(await summarize(csv)).toEqual({ ok: false, error: { code: 'AGENT_NEEDS_PERMISSION', message: 'Antigravity soft-denies MCP tools.' } });
  });

  test('anything else that goes wrong is an agent failure', async () => {
    agent.mockRejectedValue('disk full');
    expect(await summarize(csv)).toEqual({ ok: false, error: { code: 'AGENT_FAILED', message: 'disk full' } });
  });
});
