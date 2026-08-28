import { z } from 'zod';
import { ActionError } from './core';
import { failure, success, type ActionResult } from './protocol';
import { actions } from './registry';

export async function dispatch(name: string, input: unknown): Promise<ActionResult> {
  const action = actions.get(name);
  if (!action) return failure('UNKNOWN_ACTION', `No action named "${name}"`);

  const parsed = action.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));

  try {
    return success(await action.execute(parsed.data));
  } catch (error) {
    return error instanceof ActionError
      ? failure(error.code, error.message)
      : failure('ACTION_FAILED', error instanceof Error ? error.message : String(error));
  }
}
