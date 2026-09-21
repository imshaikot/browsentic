import { DAEMON_PORTS } from '@/lib/actions/protocol';

/**
 * The ports the daemon binds and its local clients probe. Relocatable like stateDir, so a test
 * daemon never contends with the one the user is running; `0` lets the OS pick. The extension
 * cannot read the environment and always walks DAEMON_PORTS.
 */
export const daemonPorts: readonly number[] = parsePorts(process.env.BROWSENTIC_PORTS) ?? DAEMON_PORTS;

function parsePorts(value: string | undefined): number[] | null {
  if (!value) return null;
  const ports = value.split(',').map((port) => Number(port.trim()));
  if (ports.some((port) => !Number.isInteger(port) || port < 0 || port > 65_535)) {
    throw new Error(`BROWSENTIC_PORTS must be a comma-separated list of ports, not "${value}"`);
  }
  return ports;
}
