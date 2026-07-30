import type { z } from 'zod';

export interface Action<Input extends z.ZodType = z.ZodType, Output = unknown> {
  readonly name: string;
  readonly description: string;
  readonly input: Input;
  readonly execute: (input: z.output<Input>) => Output | Promise<Output>;
}

export type AnyAction = Action<any, any>;

export function defineAction<Input extends z.ZodType, Output>(
  action: Action<Input, Output>,
): Action<Input, Output> {
  return Object.freeze(action);
}

export class ActionError extends Error {
  constructor(
    message: string,
    readonly code = 'ACTION_FAILED',
  ) {
    super(message);
    this.name = 'ActionError';
  }
}
