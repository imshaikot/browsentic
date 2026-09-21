import { appendFileSync } from 'node:fs';
import { matchesGlob, relative } from 'node:path';
import type { Reporter, Vitest } from 'vitest/node';

/**
 * Line-coverage floors by area. Each is the coverage the area had when its floor was last set,
 * so a change can raise it but never lower it. Raise a floor when tests land; never lower one to
 * get a build through. UI code sits outside every area until UI tests exist.
 */
export const COVERAGE_AREAS = [
  { name: 'Guardrails, secrets, intent', glob: 'src/{daemon/guardrails,lib/secrets,lib/intent}/**', lines: 94 },
  { name: 'Daemon', glob: 'src/daemon/{*.ts,!(guardrails)/**/*.ts}', lines: 61 },
  { name: 'Shared lib', glob: 'src/lib/{*.ts,actions/*.ts,!(actions|bridge|intent|secrets)/**/*.ts}', lines: 37 },
  { name: 'Extension background', glob: 'src/lib/bridge/!(use-*).ts', lines: 1 },
  { name: 'Page actions', glob: 'src/lib/actions/page/**', lines: 12 },
];

interface CoverageMap {
  files(): string[];
  fileCoverageFor(file: string): { toSummary(): { lines: { total: number; covered: number } } };
}

/** Prints coverage per area, and adds it to the GitHub job summary when there is one. */
export class CoverageByArea implements Reporter {
  private root = process.cwd();

  onInit(vitest: Vitest) {
    this.root = vitest.config.root;
  }

  onCoverage(coverage: unknown) {
    const map = coverage as CoverageMap;
    const files = map.files().map((file) => ({ path: relative(this.root, file), ...map.fileCoverageFor(file).toSummary().lines }));
    const inArea = (glob: string) => files.filter((file) => matchesGlob(file.path, glob));
    const ungated = files.filter((file) => !COVERAGE_AREAS.some(({ glob }) => matchesGlob(file.path, glob)));

    const row = (name: string, members: typeof files, floor: string) => {
      const total = members.reduce((sum, file) => sum + file.total, 0);
      const covered = members.reduce((sum, file) => sum + file.covered, 0);
      const pct = total ? ((100 * covered) / total).toFixed(1) : '100.0';
      return `| ${name} | ${pct}% | ${covered} / ${total} | ${floor} |`;
    };
    const table = [
      '| Area | Lines | Covered | Floor |',
      '| --- | --- | --- | --- |',
      ...COVERAGE_AREAS.map(({ name, glob, lines }) => row(name, inArea(glob), `${lines}%`)),
      row('UI, not gated yet', ungated, '—'),
      row('**All**', files, '—'),
    ].join('\n');

    console.log(`\n${table}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Coverage\n\n${table}\n`);
  }
}
