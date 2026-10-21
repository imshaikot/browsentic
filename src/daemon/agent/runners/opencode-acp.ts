import { acpConversation, type TurnModel } from './acp';
import { MCP_SERVER_NAME } from './claude';
import type { Conversation, Plan, StreamContext } from './types';

export type { TurnModel } from './acp';

/**
 * OpenCode connects MCP servers in the background and reads its tool list afresh at each step, so a
 * prompt sent at once is answered by a model offered no browser tools. A run's tools are listed to
 * OpenCode when its server starts, and OpenCode registers them within a 100 ms debounce; this waits
 * out that debounce with room to spare. Measured on 2.0.32: 120 ms was always enough, 60 ms never.
 */
const SETTLE_MS = 600;

const WEB_TOOLS = ['webfetch', 'websearch'];

export interface AcpTurn {
  plan: Plan;
  /** The agent the config defines, which every session has to be in. */
  agent: string;
  declined: (reason: string) => void;
  explain: (message: string | undefined, model?: TurnModel) => string;
  stoppedFor: (tool: string) => string;
}

/**
 * One turn with OpenCode 2 over the Agent Client Protocol, `opencode acp`. The run's config, its MCP
 * server included, comes from its environment as it would for `opencode run`, so the session opens
 * with no servers of its own. A session found in any agent but the run's own is refused.
 */
export function acpTurn(context: StreamContext, turn: AcpTurn): Conversation {
  return acpConversation(context, {
    plan: turn.plan,
    label: 'OpenCode',
    mcpServers: [],
    declined: turn.declined,
    explain: turn.explain,
    stoppedFor: turn.stoppedFor,
    refuses: (options) => {
      const mode = options?.find((candidate) => candidate.id === 'mode')?.currentValue;
      return mode === turn.agent ? null : `OpenCode opened this session as its "${mode ?? 'unnamed'}" agent rather than Browsentic's, so the run was stopped.`;
    },
    effortOption: 'effort',
    models: (choice) => (choice?.options ?? []).flatMap((offered) => (offered.value ? [{ id: offered.value, value: offered.value }] : [])),
    spelled: 'spelled provider/model',
    own: (name) => name.startsWith(`${MCP_SERVER_NAME}_`),
    drawn: WEB_TOOLS,
    // OpenCode refuses a tool its rules deny, which reads as failed: only one that completed ran.
    ran: (update) => update.status === 'completed',
    settleMs: SETTLE_MS,
  });
}
