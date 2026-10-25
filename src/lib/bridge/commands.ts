import type { TokenUsage } from '@/lib/actions/protocol';
import type { AgentKind } from '@/lib/agents/catalog';
import type { FileStatus } from './file-store';

export const CONTEXT_COMMAND = '/context';

export const REMOVE_TOOLS_COMMAND = '/remove-tools';

export const REMOVE_TOOLS_DESCRIPTION = 'Review the tools you saved, and delete any you are done with.';

export const isRemoveToolsCommand = (text: string): boolean =>
  text.trim().toLowerCase() === REMOVE_TOOLS_COMMAND;

export const HANDS_FREE_COMMAND = '/hands-free';

export const HANDS_FREE_ALIASES = ['hand-free', 'handsfree'];

export const HANDS_FREE_DESCRIPTION = 'Put the panel away and talk to the page — a floating mic you can drag anywhere.';

export const isHandsFreeCommand = (text: string): boolean => {
  const typed = text.trim().toLowerCase();
  return typed === HANDS_FREE_COMMAND || HANDS_FREE_ALIASES.some((alias) => typed === `/${alias}`);
};

export const TABS_COMMAND = '/tabs';

export const TABS_DESCRIPTION = 'Add other open tabs to this conversation, or see the ones it has.';

export const isTabsCommand = (text: string): boolean => text.trim().toLowerCase() === TABS_COMMAND;

export const ANDROID_COMMAND = '/android';

export const ANDROID_ALIASES = ['phone'];

export const ANDROID_DESCRIPTION = 'Switch to Chrome on your Android phone, mirrored in a tab here.';

export const ANDROID_LEAVE_DESCRIPTION = 'Leave the phone and go back to this browser.';

export const isAndroidCommand = (text: string): boolean => {
  const typed = text.trim().toLowerCase();
  return typed === ANDROID_COMMAND || ANDROID_ALIASES.some((alias) => typed === `/${alias}`);
};

export const CONTEXT_COMMAND_DESCRIPTION =
  'See what this conversation carries — messages, files, recordings, tabs.';

export const isContextCommand = (text: string): boolean => text.trim().toLowerCase() === CONTEXT_COMMAND;

export interface ContextBreakdown {
  agent?: AgentKind;
  /** The agent can pick its own conversation back up — an agent session id is held. */
  resumes: boolean;
  /** Token counts from the agent CLI's own reporting; absent until it reports, or when it never does. */
  usage?: TokenUsage;
  turns: number;
  tabCount: number;
  host?: string;
  messages: { user: number; assistant: number; tools: number; notices: number; chars: number };
  files: { name: string; size: number; status: FileStatus }[];
  /** Attached beyond the ride-along cap — stored, but not sent with the next message. */
  filesOmitted: number;
  recordings: { name: string; steps?: number }[];
  recordingsOmitted: number;
  capturedAt: number;
}
