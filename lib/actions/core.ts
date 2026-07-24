import type { z } from 'zod';

/** A declarative, remotely-invokable browser capability. */
export interface Action<Input extends z.ZodType = z.ZodType, Output = unknown> {
  /** Namespaced semantic name, e.g. `page.scrollTo`. */
  readonly name: string;
  /** One line, human- and LLM-readable, describing the side effect. */
  readonly description: string;
  /** Declarative parameter schema — also the source of MCP tool schemas. */
  readonly input: Input;
  readonly execute: (input: z.output<Input>) => Output | Promise<Output>;
}

/** An action with its generics erased — the registry and dispatcher operate on these. */
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
