/**
 * Firefox on Windows runs a native host inside a job object and terminates the whole job once the host
 * exits (subprocess_win.worker.js), and libuv's detached spawn does not ask to break away from it. So a
 * Bridge the host starts there would die a moment after it came up. A per-user scheduled task is started
 * by Task Scheduler, outside any job, in the user's own session.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './lockfile';
import { log } from './log';

/**
 * In the root folder, named for the user: without elevation Windows lets a user create tasks there but
 * not a folder of their own, and every user of the computer needs a task of their own.
 */
export const BRIDGE_TASK = `Browsentic Bridge for ${process.env.USERNAME || 'this user'}`;

export interface TaskScheduler {
  register(xmlFile: string): void;
  run(): void;
  remove(): void;
  exists(): boolean;
}

const schtasks = (args: string[]) => execFileSync('schtasks', args, { stdio: 'ignore', windowsHide: true });

export const windowsTasks: TaskScheduler = {
  register: (xmlFile) => schtasks(['/Create', '/TN', BRIDGE_TASK, '/XML', xmlFile, '/F']),
  run: () => schtasks(['/Run', '/TN', BRIDGE_TASK]),
  remove: () => schtasks(['/Delete', '/TN', BRIDGE_TASK, '/F']),
  exists: () => {
    try {
      schtasks(['/Query', '/TN', BRIDGE_TASK]);
      return true;
    } catch {
      return false;
    }
  },
};

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** No trigger: it runs only when asked. `conhost --headless` keeps Node's console window from showing. */
export function bridgeTaskXml(nodePath: string, daemonMain: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo><Description>Starts Browsentic Bridge when Firefox asks for it.</Description></RegistrationInfo>',
    '  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Hidden>true</Hidden>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <Priority>5</Priority>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    '      <Command>conhost.exe</Command>',
    `      <Arguments>--headless "${escapeXml(nodePath)}" "${escapeXml(daemonMain)}"</Arguments>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
    '',
  ].join('\r\n');
}

export function registerBridgeTask(nodePath: string, daemonMain: string, tasks: TaskScheduler = windowsTasks): boolean {
  const dir = join(stateDir, 'native-host');
  const file = join(dir, 'bridge-task.xml');
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(bridgeTaskXml(nodePath, daemonMain), 'utf16le')]));
    tasks.register(file);
    return true;
  } catch (error) {
    log(`native host: could not register the ${BRIDGE_TASK} task: ${String(error)}`);
    return false;
  } finally {
    rmSync(file, { force: true });
  }
}

export function runBridgeTask(tasks: TaskScheduler = windowsTasks): boolean {
  try {
    tasks.run();
    return true;
  } catch (error) {
    log(`native host: could not run the ${BRIDGE_TASK} task: ${String(error)}`);
    return false;
  }
}

export function removeBridgeTask(tasks: TaskScheduler = windowsTasks): boolean {
  try {
    tasks.remove();
    return true;
  } catch {
    return false;
  }
}
