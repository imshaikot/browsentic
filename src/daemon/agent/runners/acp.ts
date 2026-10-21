import { CONVERSATION_REFUSED, type Conversation, type ConversationIO, type Plan, type StreamContext, type StreamSink } from './types';
import { browserToolsDidNotStart } from './util';

const ASK = { initialize: 1, session: 2, fresh: 3, model: 4, effort: 5, prompt: 6 } as const;

/** JSON-RPC's own code for a method the agent does not know: a CLI without this protocol, not a failed turn. */
const UNKNOWN = -32601;

/** ACP's answer to a parameter it cannot use, which for `session/resume` is a session the CLI no longer holds. */
const INVALID = -32602;

/** How long a run's browser tools may take to reach the CLI before the turn is given up. */
const LISTED_WITHIN_MS = 20_000;

interface Message {
  id?: number | string;
  method?: string;
  params?: { sessionId?: string; update?: Update };
  result?: { sessionId?: string; configOptions?: ConfigOption[]; stopReason?: string; usage?: { outputTokens?: number } };
  error?: { code?: number; message?: string };
}

export interface ConfigOption {
  id?: string;
  currentValue?: string;
  /** Flat values, or groups of them, as DeepSeek Harness lists its models under each provider. */
  options?: { value?: string; name?: string; options?: { value?: string; name?: string }[] }[];
}

export interface Update {
  sessionUpdate?: string;
  toolCallId?: string;
  messageId?: string;
  name?: string;
  title?: string;
  status?: string;
  content?: unknown;
  used?: number;
}

/** The model a turn ran on, and whether it was picked in Browsentic or left to the CLI. */
export interface TurnModel {
  id: string;
  picked: boolean;
}

/** A model a session offers: the id a Browsentic setting names it by, and the value ACP is sent. */
export interface ModelEntry {
  id: string;
  value: string;
}

export interface AcpAgent {
  plan: Plan;
  /** The CLI's name, in what the user reads. */
  label: string;
  /** The MCP servers a session opens with. A resumed session reconnects only those it is given. */
  mcpServers: unknown[];
  declined: (reason: string) => void;
  explain: (message: string | undefined, model?: TurnModel) => string;
  stoppedFor: (tool: string) => string;
  /** Why a session the CLI opened is not the run's own, or null when it is. */
  refuses?: (options: ConfigOption[] | undefined) => string | null;
  effortOption: string;
  /** Each model the session offers, the one the CLI would pick for a setting first. */
  models: (choice: ConfigOption | undefined) => ModelEntry[];
  /** How a model is spelled in the side panel, for the message naming one the CLI lacks. */
  spelled?: string;
  /** A tool of the run's own browser server, whose calls the daemon draws as they happen. */
  own: (name: string) => boolean;
  /** Built-ins the panel draws as they run. */
  drawn: string[];
  /** Built-ins that may run without a row of their own. */
  quiet?: string[];
  /** Whether a finished call to any other tool ran, which means the run's containment did not hold. */
  ran: (update: Update) => boolean;
  /** How long after the browser tools are listed the prompt waits, for a CLI that registers them late. */
  settleMs: number;
  /** Assistant text arrives as whole messages, each needing a paragraph of its own. */
  paragraphs?: boolean;
}

/**
 * One turn over the Agent Client Protocol with a CLI that keeps its own server for as long as the
 * turn holds it. The prompt goes only once the browser tools have reached the session, a session the
 * CLI opened as anything but the run's own is refused, and a built-in that runs stops the run.
 */
export function acpConversation(context: StreamContext, agent: AcpAgent): Conversation {
  let session: string | undefined;
  let model: TurnModel | undefined;
  let holding = false;
  let contextTokens = 0;
  let message: string | undefined;
  const calls = new Map<string, string>();

  const refuse = (sink: StreamSink, reason: string) => {
    agent.declined(reason);
    sink.fail(CONVERSATION_REFUSED, reason);
  };

  const ask = (io: ConversationIO, id: number, method: string, params: Record<string, unknown>) => io.write({ jsonrpc: '2.0', id, method, params });

  const openSession = (io: ConversationIO, resuming: boolean) =>
    resuming
      ? ask(io, ASK.session, 'session/resume', { sessionId: context.sessionId, cwd: agent.plan.cwd, mcpServers: agent.mcpServers })
      : ask(io, ASK.fresh, 'session/new', { cwd: agent.plan.cwd, mcpServers: agent.mcpServers });

  const option = (options: ConfigOption[] | undefined, id: string) => options?.find((candidate) => candidate.id === id);
  const offers = (choice: ConfigOption | undefined, value: string) => choice?.options?.some((offered) => offered.value === value) === true;

  const prompt = (io: ConversationIO, sink: StreamSink) => {
    const late = new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), LISTED_WITHIN_MS).unref());
    void Promise.race([context.toolsListed(), late]).then((listed) => {
      if (listed === 'late') return sink.fail('AGENT_FAILED', browserToolsDidNotStart(agent.label));
      setTimeout(() => ask(io, ASK.prompt, 'session/prompt', { sessionId: session, prompt: [{ type: 'text', text: context.instruction }] }), agent.settleMs);
    });
  };

  // An effort is listed only for a model that has it, and a CLI may refuse a run asking for one it lacks.
  const chooseEffort = (options: ConfigOption[] | undefined, io: ConversationIO, sink: StreamSink) => {
    const effort = context.settings.effort;
    const choice = option(options, agent.effortOption);
    if (effort && choice?.currentValue !== effort && offers(choice, effort)) {
      return ask(io, ASK.effort, 'session/set_config_option', { sessionId: session, configId: agent.effortOption, value: effort });
    }
    return prompt(io, sink);
  };

  const modelOf = (options: ConfigOption[] | undefined): TurnModel | undefined => {
    const pinned = context.settings.model;
    if (pinned) return { id: pinned, picked: true };
    const choice = option(options, 'model');
    const current = choice?.currentValue;
    if (!current) return undefined;
    return { id: agent.models(choice).find((entry) => entry.value === current)?.id ?? current, picked: false };
  };

  // A model a CLI does not know may be swapped for another without a word, so a pinned one is asked for by name.
  const chooseModel = (options: ConfigOption[] | undefined, io: ConversationIO, sink: StreamSink) => {
    const pinned = context.settings.model;
    const choice = option(options, 'model');
    const offered = agent.models(choice);
    const entry = offered.find((candidate) => candidate.id === pinned);
    if (!pinned || choice?.currentValue === (entry?.value ?? pinned)) return chooseEffort(options, io, sink);
    if (!entry) {
      const some = [...new Set(offered.map((candidate) => candidate.id))].slice(0, 6);
      return sink.fail(
        'AGENT_FAILED',
        `${agent.label} offers no model "${pinned}" here.${some.length ? ` It offers ${some.join(', ')}, among others.` : ''} ` +
          `Pick one in the Browsentic side panel, ${agent.spelled ? `${agent.spelled}, ` : ''}then try again.`,
      );
    }
    return ask(io, ASK.model, 'session/set_config_option', { sessionId: session, configId: 'model', value: entry.value });
  };

  const onSession = (reply: Message, io: ConversationIO, sink: StreamSink) => {
    const options = reply.result?.configOptions;
    const refusal = agent.refuses?.(options);
    if (refusal) return sink.fail('AGENT_UNSAFE', refusal);
    session = reply.result?.sessionId ?? context.sessionId ?? undefined;
    if (!session) return sink.fail('AGENT_FAILED', `${agent.label} opened a session without naming it.`);
    holding = true;
    model = modelOf(options);
    sink.session(session);
    chooseModel(options, io, sink);
  };

  const onResponse = (reply: Message, io: ConversationIO, sink: StreamSink) => {
    const failed = reply.error;
    switch (reply.id) {
      case ASK.initialize:
        if (failed) return refuse(sink, `its ACP server would not start: ${failed.message}`);
        return openSession(io, context.sessionId !== null);

      case ASK.session:
      case ASK.fresh:
        if (failed?.code === INVALID && reply.id === ASK.session) return openSession(io, false);
        if (failed) {
          const reason = `${agent.label} would not ${reply.id === ASK.session ? 'resume' : 'start'} the session: ${failed.message}`;
          return failed.code === UNKNOWN ? refuse(sink, reason) : sink.fail('AGENT_FAILED', agent.explain(failed.message));
        }
        return onSession(reply, io, sink);

      case ASK.model:
        if (failed) return sink.fail('AGENT_FAILED', agent.explain(failed.message, model));
        return chooseEffort(reply.result?.configOptions, io, sink);

      case ASK.effort:
        return prompt(io, sink);

      case ASK.prompt: {
        if (failed) return sink.fail('AGENT_FAILED', agent.explain(failed.message, model));
        const output = reply.result?.usage?.outputTokens;
        if (output !== undefined) sink.usage({ contextTokens, outputTokens: output });
        // Stopped from Browsentic, the CLI ends the prompt itself before it exits.
        if (reply.result?.stopReason === 'cancelled') return sink.fail('CANCELLED', 'Run cancelled.');
        return sink.done(reply.result?.stopReason ?? 'end_turn');
      }
    }
  };

  const onToolCall = (update: Update, sink: StreamSink) => {
    const id = update.toolCallId;
    if (!id) return;
    const name = update.name ?? calls.get(id) ?? update.title ?? '';
    if (!calls.has(id)) {
      calls.set(id, name);
      if (agent.drawn.includes(name)) sink.tool(id, name);
    }
    if (update.status !== 'completed' && update.status !== 'failed') return;
    if (agent.drawn.includes(name)) return sink.toolResult(id, update.status === 'completed');
    if (agent.own(name) || agent.quiet?.includes(name)) return;
    // A refused call is the model reaching for a tool it was never offered; one that ran means the rules did not hold.
    if (agent.ran(update)) sink.fail('AGENT_UNSAFE', agent.stoppedFor(name));
  };

  const onText = (update: Update, sink: StreamSink) => {
    const content = update.content as { type?: string; text?: string } | undefined;
    if (content?.type !== 'text' || !content.text) return;
    if (agent.paragraphs && message !== undefined && update.messageId !== message) sink.text('\n\n');
    message = update.messageId;
    sink.text(content.text);
  };

  const onUpdate = (update: Update | undefined, sink: StreamSink) => {
    switch (update?.sessionUpdate) {
      case 'agent_message_chunk':
        return onText(update, sink);
      case 'tool_call':
      case 'tool_call_update':
        return onToolCall(update, sink);
      case 'usage_update':
        if (typeof update.used === 'number') contextTokens = update.used;
        return;
    }
  };

  return {
    plan: agent.plan,
    get holding() {
      return holding;
    },
    declined: agent.declined,
    open(io) {
      ask(io, ASK.initialize, 'initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'browsentic', title: 'Browsentic', version: '1' },
      });
    },
    read(line, sink, io) {
      let incoming: Message;
      try {
        incoming = JSON.parse(line) as Message;
      } catch {
        return;
      }
      if (incoming.method && incoming.id !== undefined) {
        // Nobody is there to approve anything, and a denied tool is never asked about.
        if (incoming.method === 'session/request_permission') return io.write({ jsonrpc: '2.0', id: incoming.id, result: { outcome: { outcome: 'cancelled' } } });
        return io.write({ jsonrpc: '2.0', id: incoming.id, error: { code: UNKNOWN, message: `Browsentic does not answer ${incoming.method}` } });
      }
      if (incoming.method === 'session/update') {
        if (session && incoming.params?.sessionId === session) onUpdate(incoming.params.update, sink);
        return;
      }
      if (!incoming.method) onResponse(incoming, io, sink);
    },
  };
}
