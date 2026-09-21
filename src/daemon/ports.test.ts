import { afterEach, describe, expect, test, vi } from 'vitest';
import { DAEMON_PORTS } from '@/lib/actions/protocol';

const portsWith = async (value: string | undefined) => {
  vi.resetModules();
  vi.stubEnv('BROWSENTIC_PORTS', value);
  return (await import('./ports')).daemonPorts;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('daemonPorts', () => {
  test('unset, the daemon uses the ports the extension walks', async () => {
    expect(await portsWith(undefined)).toEqual(DAEMON_PORTS);
  });

  test('a list is taken in order', async () => {
    expect(await portsWith('9001, 9002')).toEqual([9001, 9002]);
  });

  test('0 leaves the choice to the OS', async () => {
    expect(await portsWith('0')).toEqual([0]);
  });

  test('anything that is not a port is refused rather than ignored', async () => {
    await expect(portsWith('8765,http')).rejects.toThrow('BROWSENTIC_PORTS');
    await expect(portsWith('70000')).rejects.toThrow('BROWSENTIC_PORTS');
  });
});
