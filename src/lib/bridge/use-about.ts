import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

import { describeAgent, type VersionRow } from '@/lib/about';
import { SOCKET_PROTOCOL_VERSION } from '@/lib/actions/protocol';
import { browserRelease } from './identity';
import { useDaemonState } from './use-daemon-state';

const SYSTEMS: Record<string, string> = { mac: 'macOS', win: 'Windows', linux: 'Linux', cros: 'ChromeOS', openbsd: 'OpenBSD' };

const BUILD = import.meta.env.FIREFOX ? 'Firefox MV2' : 'Chrome MV3';

interface Host {
  browser?: string;
  system?: string;
}

async function readHost(): Promise<Host> {
  const [release, platform] = await Promise.all([browserRelease(), browser.runtime.getPlatformInfo().catch(() => undefined)]);
  return { browser: release, system: platform && `${SYSTEMS[platform.os] ?? platform.os} · ${platform.arch}` };
}

export function useAbout(): { versions: VersionRow[]; agent?: string } {
  const daemon = useDaemonState();
  const [host, setHost] = useState<Host>({});

  useEffect(() => {
    let live = true;
    void readHost().then((found) => live && setHost(found));
    return () => {
      live = false;
    };
  }, []);

  const connected = daemon?.connected ? daemon : undefined;
  const agent = describeAgent(connected?.agent);
  const versions = [
    { label: 'Extension', value: `${browser.runtime.getManifest().version} · ${BUILD}` },
    { label: 'Daemon', value: connected?.daemonVersion ? [connected.daemonVersion, connected.port && `port ${connected.port}`].filter(Boolean).join(' · ') : 'not connected' },
    { label: 'Protocol', value: String(SOCKET_PROTOCOL_VERSION) },
    agent && { label: 'Agent', value: agent },
    host.browser && { label: 'Browser', value: host.browser },
    host.system && { label: 'System', value: host.system },
  ].filter((row): row is VersionRow => !!row);

  return { versions, agent };
}
