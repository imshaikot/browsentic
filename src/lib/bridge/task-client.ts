import { browser } from 'wxt/browser';
import { BRIDGE_CHANNEL, failure, type ActionResult } from '@/lib/actions/protocol';
import type { TaskList } from '@/lib/schedules/task';

export type TaskRequest =
  | { op: 'tasks' }
  | { op: 'saveTask'; task: unknown }
  | { op: 'deleteTask'; taskId: string }
  | { op: 'runTaskNow'; taskId: string }
  | { op: 'pauseTasks'; paused: boolean };

export async function askTasks(request: TaskRequest): Promise<ActionResult<TaskList>> {
  const result = (await browser.runtime
    .sendMessage({ channel: BRIDGE_CHANNEL, ...request })
    .catch(() => null)) as ActionResult<TaskList> | null;
  return result ?? failure('BRIDGE_ERROR', 'The extension did not answer — reload it and try again.');
}
