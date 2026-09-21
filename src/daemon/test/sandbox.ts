import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// stateDir is read once at import and ~/browsentic only moves with HOME, so both have to be
// in place before a test file imports anything from the daemon.
const realHome = homedir();
const home = realpathSync(mkdtempSync(join(tmpdir(), 'browsentic-test-')));

process.env.HOME = home;
process.env.BROWSENTIC_HOME = join(home, '.browsentic');
delete process.env.BROWSENTIC_AGENT_RUN;

if (homedir() === realHome) throw new Error(`the test sandbox did not move HOME away from ${realHome}`);

afterAll(() => rmSync(home, { recursive: true, force: true }));
