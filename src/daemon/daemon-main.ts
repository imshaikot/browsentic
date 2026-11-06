import { startAndroid } from './android/service';
import { startDaemon } from './daemon';
import { log } from './log';
import pkg from './package.json';
import { dropQuarantinedBunLibraries } from './quarantine';

const daemon = await startDaemon({
  version: pkg.version,
  idleExit: !process.argv.includes('--no-idle-exit'),
  android: startAndroid(),
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

if (process.platform === 'darwin') {
  void dropQuarantinedBunLibraries().then((dropped) => {
    for (const file of dropped) log(`removed ${file}, a library an agent unpacked while the Bridge ran quarantined`);
  });
}
