import type { RecordingStep, RecordingVariable, RecordingWorkflow } from './workflow';

export interface ReplayCall {
  ordinal: number;
  intent: string;
  action: string;
  input: Record<string, unknown>;
}

export type ReplayPlan = { ok: true; calls: ReplayCall[] } | { ok: false; message: string };

const SECRET_KIND = /pass|secret|token|otp|pin\b|cvv|cvc|card|credential|2fa|mfa/i;

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

export const isSecretVariable = (variable: RecordingVariable): boolean =>
  SECRET_KIND.test(variable.kind) || SECRET_KIND.test(variable.name) || SECRET_KIND.test(variable.field);

const placeholdersIn = (text: string | undefined): string[] =>
  text ? [...text.matchAll(PLACEHOLDER)].map((match) => match[1]) : [];

const fill = (text: string, values: Record<string, string>) => text.replace(PLACEHOLDER, (_, name: string) => values[name] ?? '');

type InputOf = (step: RecordingStep, value: string | undefined) => Record<string, unknown>;

const onTarget: InputOf = (step) => ({ target: step.target });

const INPUTS: Record<string, InputOf> = {
  'page.navigate': (step) => ({ url: step.url }),
  'page.clickElement': onTarget,
  'page.submitForm': onTarget,
  'page.hoverElement': onTarget,
  'page.focusInput': onTarget,
  'page.selectText': onTarget,
  'page.waitForElement': onTarget,
  'page.extractText': onTarget,
  'page.scrollTo': onTarget,
  'page.fillInput': (step, value) => ({ target: step.target, value: value ?? '' }),
  'page.selectOption': (step, value) => ({ target: step.target, label: value ?? '' }),
  'page.pressKey': (step, value) => ({ key: value ?? 'Enter', ...(step.target ? { target: step.target } : {}) }),
  'page.getPageInfo': () => ({}),
};

export function planReplay(workflow: RecordingWorkflow, values: Record<string, string> = {}): ReplayPlan {
  const byName = new Map(workflow.variables.map((variable) => [variable.name, variable]));
  const needed = new Set(workflow.steps.flatMap((step) => [...placeholdersIn(step.value), ...placeholdersIn(step.url)]));

  for (const name of needed) {
    const variable = byName.get(name);
    const label = variable?.field ?? name;
    if (variable && isSecretVariable(variable)) {
      return {
        ok: false,
        message: `“${label}” is a secret, and a schedule does not hold secrets. Give the task as an instruction instead, so the agent can use your saved credentials.`,
      };
    }
    if (!values[name]?.trim()) return { ok: false, message: `The recording needs “${label}” — fill it in on the task.` };
  }

  const calls: ReplayCall[] = [];
  for (const step of workflow.steps) {
    const inputOf = INPUTS[step.action];
    if (!inputOf) return { ok: false, message: `Step ${step.ordinal} uses ${step.action}, which cannot be replayed.` };
    const value = step.value === undefined ? undefined : fill(step.value, values);
    const url = step.url === undefined ? undefined : fill(step.url, values);
    calls.push({ ordinal: step.ordinal, intent: step.intent, action: step.action, input: inputOf({ ...step, url }, value) });
  }
  return { ok: true, calls };
}

export function variablesNeeded(workflow: RecordingWorkflow): RecordingVariable[] {
  const used = new Set(workflow.steps.flatMap((step) => [...placeholdersIn(step.value), ...placeholdersIn(step.url)]));
  return workflow.variables.filter((variable) => used.has(variable.name));
}
