import type { BridgeStatus, SessionSummary } from '@/daemon/control';
import type { AgentDescriptor, AgentState } from '@/lib/agents/catalog';
import type { Preferences } from '@/lib/settings/preferences';

export type { BridgeStatus, SessionSummary };

export interface NodeInstall {
  path: string;
  version: string;
  isPrivate: boolean;
}

export interface PathsView {
  home: string;
  state: string;
  extensionDir: string;
  log: string;
  shim: string;
  mcpShim: string;
  bin: string;
  config: string;
  separator: string;
}

export interface AppInfo {
  version: string;
  system: { name: string; architecture: string };
  paths: PathsView;
  payload: { bundled: string | null; installed: string | null; current: boolean };
}

export interface CliOutput {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface Lockfile {
  pid: number;
  port: number;
  token: string;
  daemonVersion?: string;
}

export interface Browser {
  name: string;
  path: string;
}

export interface InstallStamp {
  version: string;
  installedAt: string;
}

export interface CommandLink {
  linkedIn: string | null;
  foreign: string | null;
}

export interface Release {
  version: string;
  notes: string | null;
}

export interface TrayStatus {
  summary: string;
  toggle: string;
  canToggle: boolean;
  canRestart: boolean;
}

export interface Progress {
  fraction: number;
  label: string;
}

export interface Skill {
  name: string;
  description: string;
  triggers: string[];
  isDefault: boolean;
  category: string;
  domains: string[];
  source: string;
  provenance: string;
  path?: string;
}

export interface SkillListing {
  skills: Skill[];
  dirs: string[];
  agent: string;
  agentSkills: { name: string; description?: string }[];
}

export interface Grant {
  action: string;
  host: string;
  at: string;
}

export interface DownloadRecord {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  host?: string;
  notes: string;
  savedTo: string;
  capturedAt: string;
}

export interface DownloadListing {
  dir: string;
  downloads: DownloadRecord[];
}

export type AgentListing = AgentState & { catalog?: AgentDescriptor[] };

export interface PairingCode {
  code: string;
  expiresAt: number;
}

export type { Preferences };

/** Everything the window asks of the machine, so the same views run on Tauri or on a stand-in. */
export interface Backend {
  appInfo(): Promise<AppInfo>;
  locateNode(): Promise<NodeInstall | null>;
  installNode(onProgress: (progress: Progress) => void): Promise<NodeInstall>;
  installPayload(): Promise<void>;
  cli(args: string[], timeoutSecs?: number): Promise<CliOutput>;
  npmInstall(pkg: string): Promise<CliOutput>;
  extensionStamp(): Promise<InstallStamp | null>;
  browsers(): Promise<Browser[]>;
  openExtensionsPage(browser: Browser): Promise<void>;
  agentsOnPath(bins: string[]): Promise<string[]>;
  readLock(): Promise<Lockfile | null>;
  logTail(): Promise<string>;
  commandLink(): Promise<CommandLink>;
  setCommandLink(on: boolean): Promise<CommandLink>;
  controlConnect(): Promise<boolean>;
  controlRequest(frame: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  controlClose(): Promise<void>;
  trayStatus(status: TrayStatus): Promise<void>;
  checkUpdate(): Promise<Release | null>;
  installUpdate(onProgress: (fraction: number) => void): Promise<void>;
  onControlEvent(listener: (event: string) => void): () => void;
  onTray(listener: (action: string) => void): () => void;
  openUrl(url: string): Promise<void>;
  reveal(path: string): Promise<void>;
  setWindowTheme(theme: 'light' | 'dark' | null): Promise<void>;
}

const unlisten = (pending: Promise<() => void>) => () => void pending.then((stop) => stop());

export async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const opener = await import('@tauri-apps/plugin-opener');

  return {
    appInfo: () => invoke('app_info'),
    locateNode: () => invoke('locate_node'),
    installNode: async (onProgress) => {
      const stop = await listen<Progress>('node-progress', (event) => onProgress(event.payload));
      try {
        return await invoke<NodeInstall>('install_node');
      } finally {
        stop();
      }
    },
    installPayload: () => invoke('install_payload'),
    cli: (args, timeoutSecs) => invoke('cli', { args, timeoutSecs }),
    npmInstall: (pkg) => invoke('npm_install', { package: pkg }),
    extensionStamp: () => invoke('extension_stamp'),
    browsers: () => invoke('browsers'),
    openExtensionsPage: (browser) => invoke('open_extensions_page', { path: browser.path }),
    agentsOnPath: (bins) => invoke('agents_on_path', { bins }),
    readLock: () => invoke('read_lock'),
    logTail: () => invoke('log_tail'),
    commandLink: () => invoke('command_link'),
    setCommandLink: (on) => invoke('set_command_link', { on }),
    controlConnect: () => invoke('control_connect'),
    controlRequest: (frame, timeoutMs) => invoke('control_request', { frame, timeoutMs }),
    controlClose: () => invoke('control_close'),
    trayStatus: (status) => invoke('tray_status', { status }),
    checkUpdate: () => invoke('check_update'),
    installUpdate: async (onProgress) => {
      const stop = await listen<{ received: number; total: number | null }>('update-progress', ({ payload }) =>
        onProgress(payload.total ? payload.received / payload.total : 0),
      );
      try {
        await invoke('install_update');
      } finally {
        stop();
      }
    },
    onControlEvent: (listener) => unlisten(listen<string>('control-event', (event) => listener(event.payload))),
    onTray: (listener) => unlisten(listen<string>('tray', (event) => listener(event.payload))),
    openUrl: (url) => opener.openUrl(url),
    reveal: (path) => opener.revealItemInDir(path),
    setWindowTheme: (theme) => getCurrentWindow().setTheme(theme),
  };
}

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
