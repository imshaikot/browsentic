import { ActionError } from './core';
import { FOCUS_SHOT_ACTION, RESERVED_PREFIX, SAVE_SITE_MAP_ACTION } from './reserved';

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export function toolNameFor(actionName: string): string {
  return actionName.replaceAll('.', '_');
}

export const STATUS_TOOL = toolNameFor(`${RESERVED_PREFIX}status`);

/** Every tool a side-panel run is offered, for a CLI that has to be told each one by name. */
export function agentRunToolNames(actionNames: Iterable<string>): string[] {
  return [...[...actionNames].map(toolNameFor), STATUS_TOOL, toolNameFor(SAVE_SITE_MAP_ACTION), toolNameFor(FOCUS_SHOT_ACTION)];
}

export function actionNameFor(toolName: string): string {
  return toolName.replace('_', '.');
}

export function assertToolNamesRoundTrip(actionNames: Iterable<string>): void {
  const seen = new Map<string, string>();
  for (const actionName of actionNames) {
    const tool = toolNameFor(actionName);
    if (!TOOL_NAME.test(tool)) {
      throw new ActionError(`Action "${actionName}" maps to an invalid MCP tool name "${tool}"`, 'INVALID_TOOL_NAME');
    }
    if (actionNameFor(tool) !== actionName) {
      throw new ActionError(
        `Action "${actionName}" does not survive the tool-name round trip (got "${actionNameFor(tool)}") — avoid underscores in action names`,
        'INVALID_TOOL_NAME',
      );
    }
    const clash = seen.get(tool);
    if (clash) {
      throw new ActionError(`Actions "${clash}" and "${actionName}" both map to tool "${tool}"`, 'INVALID_TOOL_NAME');
    }
    seen.set(tool, actionName);
  }
}
