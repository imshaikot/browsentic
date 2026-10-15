import { describe, expect, test } from 'vitest';
import { TOOL_GROUPS } from '@/lib/actions/groups';
import { actions } from '@/lib/actions/registry';
import { bundledSkillNames } from './agent/skills';

const grouped = Object.fromEntries(
  Object.keys(TOOL_GROUPS).map((group) => [group, [...actions.values()].filter((action) => action.group === group).map((action) => action.name)]),
);

describe('the tool groups', () => {
  test('hold the less common actions, and every other action stays in the core', () => {
    expect(grouped).toEqual({
      captcha: ['page.findCaptcha', 'page.solveCaptcha'],
      theming: ['page.readTheme', 'page.auditContrast', 'page.applyTheme'],
      diagnostics: ['page.startDiagnostics', 'page.readConsole', 'page.readNetwork', 'page.stopDiagnostics'],
      monitoring: [
        'page.findProgress',
        'page.startMonitor',
        'page.monitorStatus',
        'page.awaitMonitor',
        'page.stopMonitor',
        'page.startTimer',
        'page.timerStatus',
        'page.stopTimer',
      ],
      downloads: ['page.captureDownload', 'page.listDownloads'],
      drag: ['page.dragElement'],
    });
  });

  test('open with skills Browsentic bundles', () => {
    const skills = Object.values(TOOL_GROUPS).flatMap((group) => group.skills);
    expect(skills.filter((name) => !bundledSkillNames().includes(name))).toEqual([]);
  });
});
