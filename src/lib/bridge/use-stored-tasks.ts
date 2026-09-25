import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { TaskList } from '@/lib/schedules/task';
import { TASKS_KEY } from './socket';

export function useStoredTasks(): TaskList | null {
  const [tasks, setTasks] = useState<TaskList | null>(null);

  useEffect(() => {
    let live = true;
    void browser.storage.local.get(TASKS_KEY).then((stored) => {
      if (live) setTasks((stored[TASKS_KEY] as TaskList | undefined) ?? null);
    });
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (TASKS_KEY in changes) setTasks((changes[TASKS_KEY].newValue as TaskList | undefined) ?? null);
    };
    browser.storage.local.onChanged.addListener(listener);
    return () => {
      live = false;
      browser.storage.local.onChanged.removeListener(listener);
    };
  }, []);

  return tasks;
}
