import { startDaemon } from './daemon';
import { log } from './log';
import pkg from './package.json';

const daemon = await startDaemon({
  version: pkg.version,
  idleExit: !process.argv.includes('--no-idle-exit'),
}).catch((error) => {
  log('daemon failed to start', error);
  process.stderr.write(`browsentic-mcpd: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void daemon.stop().then(() => process.exit(0));
  });
}
