import { MCP_SERVER_NAME } from './claude';
import { CONVERSATION_REFUSED, type Conversation, type ConversationIO, type Plan, type StreamContext, type StreamSink } from './types';
import { browserToolsDidNotStart } from './util';

const ASK = { initialize: 1, session: 2, fresh: 3, model: 4, effort: 5, prompt: 6 } as const;

/** JSON-RPC's own code for a method the agent does not know: an OpenCode without this protocol, not a failed turn. */
const UNKNOWN = -32601;

/** ACP's answer to a parameter it cannot use, which for `session/resume` is a session this database never held. */
const INVALID = -32602;

/**
 * OpenCode connects MCP servers in the background and reads its tool list afresh at each step, so a
 * prompt sent at once is answered by a model offered no browser tools. A run's tools are listed to
 * OpenCode when its server starts, and OpenCode registers them within a 100 ms debounce; this waits
 * out that debounce with room to spare. Measured on 2.0.32: 120 ms was always enough, 60 ms never.
 */
const SETTLE_MS = 600;

/** How long a run's browser tools may take to reach OpenCode before the turn is given up. */
const LISTED_WITHIN_MS = 20_000;

const WEB_TOOLS = ['webfetch', 'websearch'];

interface Message {
  id?: number | string;
  method?: string;
  params?: { sessionId?: string; update?: Update };
  result?: { sessionId?: string; configOptions?: ConfigOption[]; stopReason?: string; usage?: { outputTokens?: number } };
  error?: { code?: number; message?: string };
}

interface ConfigOption {
  id?: string;
  currentValue?: string;
  options?: { value?: string }[];
}

interface Update {
  sessionUpdate?: string;
  toolCallId?: string;
  name?: string;
  title?: string;
  status?: string;
  content?: { type?: string; text?: string };
  used?: number;
}

/** The model a turn ran on, and whether it was picked in Browsentic or left to OpenCode. */
export interface TurnModel {
  id: string;
  picked: boolean;
}

export interface AcpTurn {
  plan: Plan;
  /** The agent the config defines, which every session has to be in. */
  agent: string;
  declined: (reason: string) => void;
  explain: (message: string | undefined, model?: TurnModel) => string;
  stoppedFor: (tool: string) => string;
}

/**
 * One turn with OpenCode 2 over the Agent Client Protocol, `opencode acp`, which keeps its own server
 * for as long as the turn holds it. The run's config comes from its environment as it would for
 * `opencode run`, but the prompt goes only once the browser tools have reached the session. A session
 * found in any agent but the run's own is refused, and a built-in that runs stops the run.
 */
export function acpTurn(context: StreamContext, turn: AcpTurn): Conversation {
  let session: string | undefined;
  let model: TurnModel | undefined;
  let holding = false;
  let contextTokens = 0;
  const calls = new Map<string, string>();

  const refuse = (sink: StreamSink, reason: string) => {
    turn.declined(reason);
    sink.fail(CONVERSATION_REFUSED, reason);
  };

  const ask = (io: ConversationIO, id: number, method: string, params: Record<string, unknown>) => io.write({ jsonrpc: '2.0', id, method, params });

  const openSession = (io: ConversationIO, resuming: boolean) =>
    resuming
      ? ask(io, ASK.session, 'session/resume', { sessionId: context.sessionId, cwd: turn.plan.cwd, mcpServers: [] })
      : ask(io, ASK.fresh, 'session/new', { cwd: turn.plan.cwd, mcpServers: [] });

  const option = (options: ConfigOption[] | undefined, id: string) => options?.find((candidate) => candidate.id === id);
  const offers = (choice: ConfigOption | undefined, value: string) => choice?.options?.some((offered) => offered.value === value) === true;

  const prompt = (io: ConversationIO, sink: StreamSink) => {
    const late = new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), LISTED_WITHIN_MS).unref());
    void Promise.race([context.toolsListed(), late]).then((listed) => {
      if (listed === 'late') return sink.fail('AGENT_FAILED', browserToolsDidNotStart('OpenCode'));
      setTimeout(() => ask(io, ASK.prompt, 'session/prompt', { sessionId: session, prompt: [{ type: 'text', text: context.instruction }] }), SETTLE_MS);
    });
  };

  // OpenCode lists each level of effort only for a model that has it, and refuses a run asking for one it lacks.
  const chooseEffort = (options: ConfigOption[] | undefined, io: ConversationIO, sink: StreamSink) => {
    const effort = context.settings.effort;
    const choice = option(options, 'effort');
    if (effort && choice?.currentValue !== effort && offers(choice, effort)) {
      return ask(io, ASK.effort, 'session/set_config_option', { sessionId: session, configId: 'effort', value: effort });
    }
    return prompt(io, sink);
  };

  const modelOf = (options: ConfigOption[] | undefined): TurnModel | undefined => {
    const pinned = context.settings.model;
    if (pinned) return { id: pinned, picked: true };
    const current = option(options, 'model')?.currentValue;
    return current ? { id: current, picked: false } : undefined;
  };

  // A model OpenCode does not know is swapped for another without a word, so a pinned one is asked for by name.
  const chooseModel = (options: ConfigOption[] | undefined, io: ConversationIO, sink: StreamSink) => {
    const pinned = context.settings.model;
    const choice = option(options, 'model');
    if (!pinned || choice?.currentValue === pinned) return chooseEffort(options, io, sink);
    if (!offers(choice, pinned)) {
      const some = (choice?.options ?? []).flatMap((offered) => (offered.value ? [offered.value] : [])).slice(0, 6);
      return sink.fail(
        'AGENT_FAILED',
        `OpenCode offers no model "${pinned}" here.${some.length ? ` It offers ${some.join(', ')}, among others.` : ''} ` +
          'Pick one in the Browsentic side panel, spelled provider/model, then try again.',
      );
    }
    return ask(io, ASK.model, 'session/set_config_option', { sessionId: session, configId: 'model', value: pinned });
  };

  const onSession = (message: Message, io: ConversationIO, sink: StreamSink) => {
    const options = message.result?.configOptions;
    const mode = option(options, 'mode')?.currentValue;
    if (mode !== turn.agent) {
      return sink.fail('AGENT_UNSAFE', `OpenCode opened this session as its "${mode ?? 'unnamed'}" agent rather than Browsentic's, so the run was stopped.`);
    }
    session = message.result?.sessionId ?? context.sessionId ?? undefined;
    if (!session) return sink.fail('AGENT_FAILED', 'OpenCode opened a session without naming it.');
    holding = true;
    model = modelOf(options);
    sink.session(session);
    chooseModel(options, io, sink);
  };

  const onResponse = (message: Message, io: ConversationIO, sink: StreamSink) => {
    const failed = message.error;
    switch (message.id) {
      case ASK.initialize:
        if (failed) return refuse(sink, `its ACP server would not start: ${failed.message}`);
        return openSession(io, context.sessionId !== null);

      case ASK.session:
      case ASK.fresh:
        if (failed?.code === INVALID && message.id === ASK.session) return openSession(io, false);
        if (failed) {
          const reason = `OpenCode would not ${message.id === ASK.session ? 'resume' : 'start'} the session: ${failed.message}`;
          return failed.code === UNKNOWN ? refuse(sink, reason) : sink.fail('AGENT_FAILED', turn.explain(failed.message));
        }
        return onSession(message, io, sink);

      case ASK.model:
        if (failed) return sink.fail('AGENT_FAILED', turn.explain(failed.message, model));
        return chooseEffort(message.result?.configOptions, io, sink);

      case ASK.effort:
        return prompt(io, sink);

      case ASK.prompt: {
        if (failed) return sink.fail('AGENT_FAILED', turn.explain(failed.message, model));
        const output = message.result?.usage?.outputTokens;
        if (output !== undefined) sink.usage({ contextTokens, outputTokens: output });
        // Stopped from Browsentic, OpenCode ends the prompt itself before it exits.
        if (message.result?.stopReason === 'cancelled') return sink.fail('CANCELLED', 'Run cancelled.');
        return sink.done(message.result?.stopReason ?? 'end_turn');
      }
    }
  };

  const onToolCall = (update: Update, sink: StreamSink) => {
    const id = update.toolCallId;
    if (!id) return;
    const name = update.name ?? calls.get(id) ?? update.title ?? '';
    if (!calls.has(id)) {
      calls.set(id, name);
      if (WEB_TOOLS.includes(name)) sink.tool(id, name);
    }
    if (update.status !== 'completed' && update.status !== 'failed') return;
    if (WEB_TOOLS.includes(name)) return sink.toolResult(id, update.status === 'completed');
    // A refused call is the model reaching for a tool it was never offered; one that ran means the rules did not hold.
    if (update.status === 'completed' && !name.startsWith(`${MCP_SERVER_NAME}_`)) sink.fail('AGENT_UNSAFE', turn.stoppedFor(name));
  };

  const onUpdate = (update: Update | undefined, sink: StreamSink) => {
    switch (update?.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content?.type === 'text' && update.content.text) sink.text(update.content.text);
        return;
      case 'tool_call':
      case 'tool_call_update':
        return onToolCall(update, sink);
      case 'usage_update':
        if (typeof update.used === 'number') contextTokens = update.used;
        return;
    }
  };

  return {
    plan: turn.plan,
    get holding() {
      return holding;
    },
    declined: turn.declined,
    open(io) {
      ask(io, ASK.initialize, 'initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'browsentic', title: 'Browsentic', version: '1' },
      });
    },
    read(line, sink, io) {
      let message: Message;
      try {
        message = JSON.parse(line) as Message;
      } catch {
        return;
      }
      if (message.method && message.id !== undefined) {
        // Nobody is there to approve anything, and a denied tool is never asked about.
        if (message.method === 'session/request_permission') return io.write({ jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'cancelled' } } });
        return io.write({ jsonrpc: '2.0', id: message.id, error: { code: UNKNOWN, message: `Browsentic does not answer ${message.method}` } });
      }
      if (message.method === 'session/update') {
        if (session && message.params?.sessionId === session) onUpdate(message.params.update, sink);
        return;
      }
      if (!message.method) onResponse(message, io, sink);
    },
  };
}
