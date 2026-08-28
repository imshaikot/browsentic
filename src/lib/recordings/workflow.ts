import { byteLength } from '@/lib/skills/format';
import { clip, looksLikeInstruction, looksLikeSelector, scrub } from '@/lib/skills/scrub';

export const MAX_STEPS = 80;
export const MAX_VARIABLES = 20;
export const MAX_CAVEATS = 8;
export const MAX_WORKFLOW_BYTES = 12 * 1024;

export const STEP_LIMITS = {
  goal: 160,
  summary: 400,
  intent: 120,
  note: 160,
  value: 200,
  text: 80,
  variable: 40,
  field: 80,
  kind: 24,
  caveat: 200,
} as const;

export const REPLAYABLE_ACTIONS = [
  'page.navigate',
  'page.clickElement',
  'page.fillInput',
  'page.selectOption',
  'page.pressKey',
  'page.submitForm',
  'page.scrollTo',
  'page.hoverElement',
  'page.focusInput',
  'page.selectText',
  'page.waitForElement',
  'page.extractText',
  'page.getPageInfo',
] as const;

export interface RecordingStep {
  ordinal: number;
  intent: string;
  action: string;
  target?: { selector?: string; text?: string; role?: string };
  value?: string;
  url?: string;
  note?: string;
}

export interface RecordingVariable {
  name: string;
  field: string;
  kind: string;
}

export interface RecordingWorkflow {
  goal: string;
  summary: string;
  steps: RecordingStep[];
  variables: RecordingVariable[];
  caveats: string[];
}

export type WorkflowValidation =
  | { ok: true; workflow: RecordingWorkflow; warnings: string[] }
  | { ok: false; message: string };

export function validateRecordingWorkflow(input: unknown, opts: { origin: string }): WorkflowValidation {
  if (!input || typeof input !== 'object') return { ok: false, message: 'The workflow must be an object.' };
  const raw = input as Partial<RecordingWorkflow>;
  const warnings: string[] = [];

  const goal = scrub(raw.goal ?? '', STEP_LIMITS.goal);
  if (!goal) return { ok: false, message: 'The workflow needs a one-line goal.' };
  const summary = scrub(raw.summary ?? '', STEP_LIMITS.summary);

  const steps: RecordingStep[] = [];
  for (const candidate of Array.isArray(raw.steps) ? raw.steps.slice(0, MAX_STEPS) : []) {
    const step = normalizeStep(candidate, opts.origin, warnings);
    if (step) steps.push({ ...step, ordinal: steps.length + 1 });
  }
  if (!steps.length) return { ok: false, message: 'The workflow lists no replayable steps.' };

  const seen = new Set<string>();
  const variables: RecordingVariable[] = [];
  for (const candidate of Array.isArray(raw.variables) ? raw.variables.slice(0, MAX_VARIABLES) : []) {
    const name = scrub(candidate?.name ?? '', STEP_LIMITS.variable).replace(/[{}]/g, '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    variables.push({
      name,
      field: scrub(candidate?.field ?? '', STEP_LIMITS.field) || name,
      kind: scrub(candidate?.kind ?? '', STEP_LIMITS.kind) || 'text',
    });
  }

  const caveats = (Array.isArray(raw.caveats) ? raw.caveats : [])
    .slice(0, MAX_CAVEATS)
    .map((caveat) => scrub(caveat, STEP_LIMITS.caveat))
    .filter(Boolean);

  const workflow: RecordingWorkflow = { goal, summary, steps, variables, caveats };
  trimToBudget(workflow, warnings);

  for (const text of promptStrings(workflow)) {
    if (looksLikeInstruction(text)) {
      warnings.push(`Reads like an instruction rather than an observation: “${clip(text, 80)}”`);
    }
  }
  return { ok: true, workflow, warnings };
}

function normalizeStep(
  candidate: Partial<RecordingStep> | undefined,
  origin: string,
  warnings: string[],
): RecordingStep | null {
  const action = typeof candidate?.action === 'string' ? candidate.action.trim() : '';
  if (!(REPLAYABLE_ACTIONS as readonly string[]).includes(action)) {
    if (action) warnings.push(`Dropped a step naming an action that cannot be replayed: ${clip(action, 40)}`);
    return null;
  }

  const intent = scrub(candidate?.intent ?? '', STEP_LIMITS.intent);
  if (!intent) return null;

  const target = normalizeTarget(candidate?.target, warnings);
  const url = sameOrigin(candidate?.url, origin);

  if (action === 'page.navigate' && !url) return null;
  if (action !== 'page.navigate' && action !== 'page.getPageInfo' && !target) return null;

  return {
    ordinal: 0,
    intent,
    action,
    target,
    value: scrub(candidate?.value ?? '', STEP_LIMITS.value) || undefined,
    url: url || undefined,
    note: scrub(candidate?.note ?? '', STEP_LIMITS.note) || undefined,
  };
}

function normalizeTarget(
  target: RecordingStep['target'],
  warnings: string[],
): RecordingStep['target'] | undefined {
  if (!target || typeof target !== 'object') return undefined;
  let selector = typeof target.selector === 'string' ? target.selector.trim() : '';
  if (selector && !looksLikeSelector(selector)) {
    warnings.push(`Dropped a step selector that did not look like a selector: ${clip(selector, 40)}`);
    selector = '';
  }
  const text = scrub(target.text ?? '', STEP_LIMITS.text);
  const role = scrub(target.role ?? '', STEP_LIMITS.kind);
  if (!selector && !text) return undefined;
  return {
    selector: selector || undefined,
    text: text || undefined,
    role: role || undefined,
  };
}

function sameOrigin(value: unknown, origin: string): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const base = new URL(origin);
    const url = new URL(value.trim(), origin);
    if (url.origin !== base.origin) return '';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return clip(url.href, 300);
  } catch {
    return '';
  }
}

function promptStrings(workflow: RecordingWorkflow): string[] {
  return [
    workflow.goal,
    workflow.summary,
    ...workflow.steps.flatMap((step) => [step.intent, step.note ?? '', step.target?.text ?? '']),
    ...workflow.variables.map((variable) => variable.field),
    ...workflow.caveats,
  ].filter(Boolean);
}

function promptBytes(workflow: RecordingWorkflow): number {
  return promptStrings(workflow).reduce((total, text) => total + byteLength(text), 0);
}

function trimToBudget(workflow: RecordingWorkflow, warnings: string[]): void {
  if (promptBytes(workflow) <= MAX_WORKFLOW_BYTES) return;

  const shed = (label: string, cut: () => void) => {
    if (promptBytes(workflow) <= MAX_WORKFLOW_BYTES) return;
    cut();
    warnings.push(`The workflow was over its size budget, so ${label} was left out.`);
  };

  shed('the per-step notes', () => {
    for (const step of workflow.steps) step.note = undefined;
  });
  shed('some of the caveats', () => {
    workflow.caveats = workflow.caveats.slice(0, 3);
  });
  shed('the longer step descriptions', () => {
    for (const step of workflow.steps) step.intent = clip(step.intent, 60);
  });

  while (promptBytes(workflow) > MAX_WORKFLOW_BYTES && workflow.steps.length > 1) {
    workflow.steps.pop();
  }
  if (workflow.steps.length === 1) warnings.push('Only the first step fitted in the workflow.');
}
