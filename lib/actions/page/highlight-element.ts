import { z } from 'zod';
import { defineAction } from '../core';
import { describeElement, resolveTarget, targetSchema } from './dom';

export const highlightElement = defineAction({
  name: 'page.highlightElement',
  description: 'Visually highlight an element with a temporary outline overlay and optional caption.',
  input: z.object({
    target: targetSchema.describe('Element to highlight'),
    durationMs: z
      .number()
      .int()
      .positive()
      .max(30000)
      .default(2000)
      .describe('How long the highlight stays visible'),
    label: z.string().optional().describe('Small caption rendered above the highlight'),
  }),
  execute({ target, durationMs, label }) {
    const element = resolveTarget(target);
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      pointerEvents: 'none',
      zIndex: '2147483647',
      border: '2px solid #8b5cf6',
      borderRadius: '6px',
      boxShadow: '0 0 0 4px rgba(139,92,246,.25)',
    });
    if (label) {
      const chip = document.createElement('span');
      chip.textContent = label;
      Object.assign(chip.style, {
        position: 'absolute',
        top: '-22px',
        left: '0',
        background: '#8b5cf6',
        color: '#fff',
        font: '11px/1.4 system-ui',
        padding: '1px 6px',
        borderRadius: '4px',
        whiteSpace: 'nowrap',
      });
      overlay.append(chip);
    }
    // body can carry CSS transforms that would make position: fixed resolve against it
    document.documentElement.append(overlay);
    setTimeout(() => overlay.remove(), durationMs);
    return { element: describeElement(element), durationMs };
  },
});
