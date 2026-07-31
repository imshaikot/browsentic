export const SUBMIT_ACTION = 'page.submitForm';

export function submitsForm(action: string, input: unknown): boolean {
  if (action === SUBMIT_ACTION) return true;
  const args = (input ?? {}) as { pressEnter?: unknown; key?: unknown };
  if (action === 'page.fillInput') return args.pressEnter === true;
  if (action === 'page.pressKey') return args.key === 'Enter';
  return false;
}

export function needsApproval(requireApproval: readonly string[], action: string, input: unknown): boolean {
  if (requireApproval.includes(action)) return true;
  return requireApproval.includes(SUBMIT_ACTION) && submitsForm(action, input);
}
