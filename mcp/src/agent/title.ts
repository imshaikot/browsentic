import { failure, success, type ActionResult, type SocketFrame } from '@/lib/actions/protocol';
import { log } from '../log';
import type { AgentConfig } from './config';
import { RunError, runClaudeJson } from './runner';

type NameSessionFrame = Extract<SocketFrame, { t: 'nameSession' }>;

/** A name is one line on a narrow list row. The extension clamps it again on arrival. */
const MAX_TITLE_CHARS = 60;

/** How much of the conversation to read. Names come from what was asked, not from every word of it. */
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 400;

/** A name is a handful of words from a tiny prompt; a spawn this slow has gone wrong. */
const NAME_TIMEOUT_MS = 30_000;

/**
 * Name one saved conversation with a one-shot `claude -p`, outside the agent conversation and with
 * no tools at all — it reads what it is given and answers.
 *
 * What it is given is only the user's own messages, chosen by the extension. That is the whole
 * safety story here: an assistant turn is a restatement of whatever page the agent was reading, so
 * feeding one in would let a site decide what a conversation in the user's own history is called.
 */
export async function nameSession(
  req: NameSessionFrame,
  config: AgentConfig,
): Promise<ActionResult<{ title: string }>> {
  const messages = (Array.isArray(req.messages) ? req.messages : [])
    .filter((message): message is string => typeof message === 'string' && message.trim().length > 0)
    .slice(-MAX_MESSAGES)
    .map((message) => message.trim().slice(0, MAX_MESSAGE_CHARS));
  if (!messages.length) return failure('INVALID_INPUT', 'Nothing was said in that conversation yet.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAME_TIMEOUT_MS);
  try {
    const output = await runClaudeJson(promptFor(messages, req.host), config, controller.signal, {
      timedOut: 'Naming the conversation took too long.',
      empty: 'Claude Code returned an empty name.',
    });
    const title = clamp(output);
    if (!title) return failure('AGENT_FAILED', 'Claude Code returned an empty name.');
    log(`named session: ${title}`);
    return success({ title });
  } catch (error) {
    const { code, message } = error instanceof RunError ? error : new RunError('AGENT_FAILED', String(error));
    log(`naming a session failed: ${code}: ${message}`);
    return failure(code, message);
  } finally {
    clearTimeout(timer);
  }
}

function promptFor(messages: string[], host?: string): string {
  return (
    `Below are the requests someone made to a browser assistant, in order, in one sitting` +
    `${host ? ` while on ${host}` : ''}.\n\n` +
    messages.map((message, index) => `${index + 1}. ${message}`).join('\n') +
    `\n\nReply with a title for this conversation and nothing else — no quotes, no punctuation at ` +
    `the end, no preamble. At most ${MAX_TITLE_CHARS} characters, in the style of a short headline ` +
    `("Refund a Stripe charge"). Name what the person was trying to do, not what the assistant did. ` +
    (host
      ? `End it with " — ${host}" so the site is visible at a glance, and count that in the limit.`
      : `Do not invent a site name.`)
  );
}

/**
 * One line, bounded. A name goes straight into a row in the user's own history, so its shape is
 * enforced here rather than trusted: newlines flattened (the extension stores it as a single field),
 * the wrapping quotes a model reaches for stripped, and the length cut.
 */
function clamp(output: string): string {
  return output
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”']+|["'“”']+$/g, '')
    .trim()
    .slice(0, MAX_TITLE_CHARS)
    .trim();
}
