import type { ListedTool, ToolReply } from '../../tool-host';
import type { AgentSettings } from '../config';
import { CONVERSATION_REFUSED, type Conversation, type ConversationIO, type Plan, type StreamContext, type StreamSink } from './types';

/** JSON-RPC's own codes for a method or parameters the server does not know: an older app-server, not a failed turn. */
const UNKNOWN = [-32601, -32602];

const ASK = { initialize: 1, config: 2, thread: 3, turn: 4 } as const;

/** Codex's word for each of its own actions that a run has switched off. */
const OFF_LIMITS: Record<string, string> = {
  commandExecution: 'ran a shell command',
  fileChange: 'changed a file',
  mcpToolCall: 'called an MCP server',
};

interface Message {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown> & { threadId?: string };
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

interface Item {
  id?: string;
  type?: string;
  text?: string;
}

interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface AppServerTurn {
  plan: Plan;
  settings: AgentSettings;
  effort?: string;
  developerInstructions: string;
  /** Called once the app-server has turned the conversation down, so later turns go straight to the plain plan. */
  declined: (reason: string) => void;
  explain: (message: string | undefined) => string | undefined;
  stoppedFor: (what: string) => string;
}

/**
 * One turn with Codex's app-server. The browser tools go to it as its own tools — listed in the
 * model's first request, not deferred behind a search — and each call comes back here to be made
 * through the run's gate. Its words arrive as they are written, and its token counts are the
 * request's own rather than a sum. No MCP server starts: the run registers none, every one the user
 * configured is switched off for the thread, and one that starts anyway stops the run.
 */
export function appServerTurn(context: StreamContext, turn: AppServerTurn): Conversation {
  let thread: string | undefined;
  let holding = false;
  let generated = 0;
  const said = new Map<string, string>();
  const searches = new Set<string>();

  const refuse = (sink: StreamSink, reason: string) => {
    turn.declined(reason);
    sink.fail(CONVERSATION_REFUSED, reason);
  };

  const threadParams = (disabled: string[]) => ({
    cwd: turn.plan.cwd,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    developerInstructions: turn.developerInstructions,
    ...(turn.settings.model ? { model: turn.settings.model } : {}),
    config: {
      ...Object.fromEntries(disabled.map((name) => [`mcp_servers.${name}.enabled`, false])),
      ...(turn.effort ? { model_reasoning_effort: turn.effort } : {}),
    },
  });

  const startThread = (io: ConversationIO, sink: StreamSink, disabled: string[]) => {
    if (context.sessionId) {
      io.write({ jsonrpc: '2.0', id: ASK.thread, method: 'thread/resume', params: { threadId: context.sessionId, ...threadParams(disabled) } });
      return;
    }
    // A tool list is fixed when the thread begins, so what is withheld now is listed out of sight, for later turns.
    context
      .tools()
      .then((host) => host.list())
      .then(({ tools, withheld }) =>
        io.write({
          jsonrpc: '2.0',
          id: ASK.thread,
          method: 'thread/start',
          params: {
            ...threadParams(disabled),
            dynamicTools: [...tools.map((tool) => dynamicTool(tool, false)), ...(withheld.length ? [outOfSight(withheld)] : [])],
          },
        }),
      )
      .catch((error: unknown) => sink.fail('AGENT_FAILED', `Browsentic could not list its browser tools for Codex: ${String(error)}`));
  };

  // A call the daemon cannot be reached for is answered as failed, in the `CODE: message` shape every tool failure takes.
  const answerToolCall = (io: ConversationIO, id: Message['id'], params: Message['params']) => {
    const tool = String(params?.tool ?? '');
    const args = (params?.arguments ?? {}) as Record<string, unknown>;
    context
      .tools()
      .then((host) => host.call(tool, args))
      .then(
        (reply) => io.write({ jsonrpc: '2.0', id, result: toolResult(reply) }),
        (error: unknown) =>
          io.write({ jsonrpc: '2.0', id, result: { contentItems: [{ type: 'inputText', text: `DAEMON_UNREACHABLE: ${String(error)}` }], success: false } }),
      );
  };

  const onResponse = (message: Message, io: ConversationIO, sink: StreamSink) => {
    const failed = message.error;
    switch (message.id) {
      case ASK.initialize:
        if (failed) return refuse(sink, `its app-server would not start a session: ${failed.message}`);
        io.write({ jsonrpc: '2.0', method: 'initialized' });
        return io.write({ jsonrpc: '2.0', id: ASK.config, method: 'config/read', params: {} });

      case ASK.config: {
        if (failed) return refuse(sink, `its app-server would not show its config: ${failed.message}`);
        const config = message.result?.config as { mcp_servers?: Record<string, unknown> } | undefined;
        return startThread(io, sink, Object.keys(config?.mcp_servers ?? {}));
      }

      case ASK.thread: {
        if (failed) {
          const reason = `its app-server would not ${context.sessionId ? 'resume' : 'start'} the thread: ${failed.message}`;
          return UNKNOWN.includes(failed.code ?? 0) ? refuse(sink, reason) : sink.fail('AGENT_FAILED', turn.explain(failed.message) ?? reason);
        }
        thread = (message.result?.thread as { id?: string } | undefined)?.id;
        if (!thread) return sink.fail('AGENT_FAILED', 'Codex started a thread without naming it.');
        holding = true;
        sink.session(thread);
        return io.write({
          jsonrpc: '2.0',
          id: ASK.turn,
          method: 'turn/start',
          params: { threadId: thread, input: [{ type: 'text', text: context.instruction, text_elements: [] }] },
        });
      }

      case ASK.turn:
        if (failed) return sink.fail('AGENT_FAILED', turn.explain(failed.message) ?? 'Codex would not start the turn.');
        return;
    }
  };

  const onItem = (item: Item | undefined, finished: boolean, sink: StreamSink) => {
    const kind = item?.type;
    if (!kind) return;
    if (OFF_LIMITS[kind]) return sink.fail('AGENT_UNSAFE', turn.stoppedFor(OFF_LIMITS[kind]));
    if (kind === 'webSearch' && item.id) {
      if (!searches.has(item.id)) {
        searches.add(item.id);
        sink.tool(item.id, 'web_search');
      }
      if (finished) sink.toolResult(item.id, true);
      return;
    }
    // A message that came whole, without deltas, is said here; one that streamed says only what is left.
    if (kind === 'agentMessage' && finished && item.id && item.text) {
      const before = said.get(item.id) ?? '';
      if (item.text.startsWith(before) && item.text.length > before.length) sink.text(item.text.slice(before.length));
      said.set(item.id, item.text);
    }
  };

  const onNotification = (message: Message, sink: StreamSink) => {
    const params = message.params ?? {};
    // Any thread's, and even before the thread is named: a server announces itself while the thread starts.
    if (message.method === 'mcpServer/startupStatus/updated') return sink.fail('AGENT_UNSAFE', turn.stoppedFor('started an MCP server'));
    // Only the run's own thread speaks to the panel; a sub-agent's thread works through the same tools.
    if (thread && params.threadId && params.threadId !== thread) return;

    switch (message.method) {
      case 'item/agentMessage/delta': {
        const id = String(params.itemId ?? '');
        const delta = String(params.delta ?? '');
        said.set(id, (said.get(id) ?? '') + delta);
        return sink.text(delta);
      }
      case 'item/started':
        return onItem(params.item as Item | undefined, false, sink);
      case 'item/completed':
        return onItem(params.item as Item | undefined, true, sink);
      case 'thread/tokenUsage/updated': {
        const last = (params.tokenUsage as { last?: Usage } | undefined)?.last;
        if (!last) return;
        generated += last.outputTokens ?? 0;
        return sink.usage({ contextTokens: (last.inputTokens ?? 0) + (last.outputTokens ?? 0), outputTokens: generated });
      }
      case 'error': {
        const error = params.error as { message?: string } | undefined;
        if (params.willRetry) return;
        return sink.fail('AGENT_FAILED', turn.explain(error?.message) ?? 'Codex reported an error');
      }
      case 'turn/completed': {
        const done = params.turn as { status?: string; error?: { message?: string } | null } | undefined;
        if (done?.status === 'completed') return sink.done('end_turn');
        if (done?.status === 'failed') return sink.fail('AGENT_FAILED', turn.explain(done.error?.message) ?? 'Codex could not finish the turn');
        return sink.fail('AGENT_FAILED', `Codex ended the turn ${done?.status ?? 'without saying how'}.`);
      }
    }
  };

  return {
    plan: turn.plan,
    get holding() {
      return holding;
    },
    declined: turn.declined,
    open(io) {
      io.write({
        jsonrpc: '2.0',
        id: ASK.initialize,
        method: 'initialize',
        params: { clientInfo: { name: 'browsentic', title: 'Browsentic', version: '1' }, capabilities: { experimentalApi: true, requestAttestation: false } },
      });
    },
    read(line, sink, io) {
      let message: Message;
      try {
        message = JSON.parse(line) as Message;
      } catch {
        return;
      }
      if (message.method === 'item/tool/call' && message.id !== undefined) return answerToolCall(io, message.id, message.params);
      // Anything else it asks of the client — an approval, a question for the user — has no one to answer it.
      if (message.method && message.id !== undefined) {
        return io.write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Browsentic does not answer ${message.method}` } });
      }
      if (message.method) return onNotification(message, sink);
      return onResponse(message, io, sink);
    },
  };
}

const dynamicTool = (tool: ListedTool, deferLoading: boolean) => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  deferLoading,
});

/** Codex keeps a deferred tool only inside a namespace, where the model finds it by searching. */
const outOfSight = (tools: ListedTool[]) => ({
  type: 'namespace',
  name: 'browsentic',
  description: 'Browsentic tools that answer only once the user has switched them on for a message.',
  tools: tools.map((tool) => dynamicTool(tool, true)),
});

/** A browser tool's result as Codex takes one: text as text, a picture as a data URL it shows the model. */
function toolResult(reply: ToolReply) {
  return {
    contentItems: reply.content.map((block) =>
      block.type === 'image' ? { type: 'inputImage', imageUrl: `data:${block.mimeType};base64,${block.data}` } : { type: 'inputText', text: block.text },
    ),
    success: reply.isError !== true,
  };
}
