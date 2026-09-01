import { useEffect, useRef, useState } from 'react';
import { ArrowDown, PanelRightClose, SquarePen } from 'lucide-react';
import { browser } from 'wxt/browser';

import { invokeInActiveTab } from '@/lib/actions/client';
import { isRemoveToolsCommand } from '@/lib/bridge/commands';
import { getPageInfo } from '@/lib/actions/page/get-page-info';
import { BRIDGE_CHANNEL, type FocusedElement } from '@/lib/actions/protocol';
import { Wordmark } from '@/extension/components/brand';
import { Composer, type AttachedSkill } from '@/extension/components/composer';
import { ConnectionSheet } from '@/extension/components/connection-sheet';
import { Greeting } from '@/extension/components/greeting';
import { MonitorBar } from '@/extension/components/monitor-bar';
import { PanelNav, type PanelTab } from '@/extension/components/panel-nav';
import { RecordingBar } from '@/extension/components/recording-bar';
import { RecordingPanel } from '@/extension/components/recording-panel';
import { RunTimeline } from '@/extension/components/run-timeline';
import { KeepToolPrompt, SavedToolList } from '@/extension/components/saved-tools';
import { SessionList } from '@/extension/components/session-list';
import { SessionRail } from '@/extension/components/session-rail';
import { SettingsPanel } from '@/extension/components/settings-panel';
import { SiteMapReview } from '@/extension/components/site-map-review';
import { SkillsPanel } from '@/extension/components/skills-panel';
import { StatusPill, describeStatus } from '@/extension/components/status-pill';
import { Button } from '@/extension/components/ui/button';
import { ScrollArea } from '@/extension/components/ui/scroll-area';
import { pickFocus } from '@/lib/bridge/aeye';
import { putFile, removeFile } from '@/lib/bridge/file-store';
import { removeRecording, type StoredRecordingMeta } from '@/lib/bridge/recording-store';
import { removeSession } from '@/lib/bridge/session-store';
import { useActiveTabUrl } from '@/lib/bridge/use-active-tab-url';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import { closeSidePanel } from '@/lib/bridge/side-panel';
import { usePanelCollapsed, usePanelTab } from '@/lib/bridge/use-panel-view';
import { useRun } from '@/lib/bridge/use-run';
import { useStoredFiles } from '@/lib/bridge/use-stored-files';
import { useStoredRecordings } from '@/lib/bridge/use-stored-recordings';
import { useStoredSessions } from '@/lib/bridge/use-stored-sessions';
import { useStoredSkills } from '@/lib/bridge/use-stored-skills';
import { useVoiceComposer } from '@/lib/bridge/use-voice-composer';
import { useVoiceEnabled } from '@/lib/bridge/use-speech';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PINNED_SLACK_PX = 56;

export default function App() {
  const daemon = useDaemonState();
  const run = useRun();
  const [voiceEnabled, setVoiceEnabled] = useVoiceEnabled();
  const files = useStoredFiles();
  const sessions = useStoredSessions();
  const recordings = useStoredRecordings();
  const skills = useStoredSkills();
  const tabUrl = useActiveTabUrl();
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachedSkill, setAttachedSkill] = useState<AttachedSkill | null>(null);
  const [focus, setFocus] = useState<FocusedElement | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [picking, setPicking] = useState(false);
  const [liveTools, setLiveTools] = useState(false);
  const [tab, setTab] = usePanelTab();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [, setCollapsed] = usePanelCollapsed();
  const viewport = useRef<HTMLDivElement>(null);
  const windowId = useRef<number | null>(null);
  const [pinned, setPinned] = useState(true);

  const connected = daemon?.connected ?? false;

  const voice = useVoiceComposer({
    active: voiceEnabled && connected && !run.running,
    onSubmit: (text) => {
      run.send(text, { agentSkillId: attachedSkill?.id, focus: focus ?? undefined, liveTools });
      setAttachedSkill(null);
      setFocus(null);
    },
  });

  const status = describeStatus(daemon, { running: run.running, listening: voice.listening });

  useEffect(() => {
    if (!connected || daemon?.skillCatalog) return;
    void browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'listSkills' });
  }, [connected, daemon?.skillCatalog]);

  useEffect(() => {
    void browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'panelOpened' });
    void browser.windows.getCurrent().then((win) => {
      windowId.current = win.id ?? null;
    });
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onScroll = () => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      setPinned(distance < PINNED_SLACK_PX);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!pinned || tab !== 'chat') return;
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [run.items, run.running, pinned, tab]);

  function goToLatest() {
    const element = viewport.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    setPinned(true);
  }

  function open(next: PanelTab) {
    setConnectionOpen(false);
    if (next === tab) return;
    setTab(next);
    setPinned(next === 'chat');
    if (viewport.current) viewport.current.scrollTop = 0;
  }

  function minimize() {
    setConnectionOpen(false);
    setCollapsed(true);
    void closeSidePanel(windowId.current);
  }

  function handleSend() {
    if (run.running || !connected) return;
    open('chat');
    voice.submitNow();
  }

  function openSession(sessionId: string) {
    open('chat');
    void run.restore(sessionId);
  }

  function replayRecording(recording: StoredRecordingMeta) {
    open('chat');
    run.send(`Replay my recording “${recording.name}” (id ${recording.id}).`);
  }

  function mapSite() {
    open('chat');
    run.mapSite();
  }

  async function pointAtElement() {
    if (picking) return;
    setAttachError(null);
    setPicking(true);
    const outcome = await pickFocus();
    setPicking(false);
    if ('focus' in outcome) setFocus(outcome.focus);
    else if ('error' in outcome) setAttachError(`A-Eye couldn’t read that element: ${outcome.error}`);
  }

  async function attachPageContext() {
    const result = await invokeInActiveTab(getPageInfo, {});
    if (!result.ok) {
      voice.setInput(`${voice.input}\n[couldn’t read this page: ${result.error.message}]\n`);
      return;
    }
    const { document: doc, selection } = result.data;
    const snippet = selection ? `\nSelection: “${selection}”` : '';
    voice.setInput(`${voice.input ? `${voice.input}\n\n` : ''}[Page: ${doc.title} — ${doc.url}${snippet}]\n`);
  }

  async function attachFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setAttachError(`“${file.name}” is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
      return;
    }
    setAttachError(null);
    const id = crypto.randomUUID();
    const content = await readAsBase64(file);
    await putFile(
      {
        id,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        status: 'pending',
        addedAt: Date.now(),
      },
      content,
    );
    await browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'analyzeFile', fileId: id });
  }

  function toggleVoice() {
    if (!voiceEnabled) {
      setVoiceEnabled(true);
      return;
    }
    if (voice.error) {
      voice.retry();
      return;
    }
    setVoiceEnabled(false);
  }

  const runningCount = run.sessions.filter((session) => session.runId).length;
  const offChatRun = runningCount > 0 && tab !== 'chat';
  const hasBanners = offChatRun || !!run.recording || run.monitors.length > 0 || !!run.draft;
  const counts = { history: sessions.length, skills: skills.length, recordings: recordings.length };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <Wordmark className="flex-1" />
        <StatusPill
          tone={status.tone}
          expanded={connectionOpen}
          onClick={() => setConnectionOpen((open) => !open)}
        >
          {status.label}
        </StatusPill>
        <Button
          variant="ghost"
          size="icon-sm"
          title="New chat"
          aria-label="Start a new conversation"
          onClick={() => {
            open('chat');
            run.clear();
          }}
        >
          <SquarePen className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Minimize to a rail on the page"
          aria-label="Minimize to a rail on the page"
          onClick={minimize}
        >
          <PanelRightClose className="size-3.5" />
        </Button>
      </header>

      {connectionOpen && <ConnectionSheet onClose={() => setConnectionOpen(false)} />}

      <PanelNav tab={tab} counts={counts} onSelect={open} />

      <SessionRail
        sessions={run.sessions}
        activeSessionId={run.sessionId}
        onFocus={(id) => {
          open('chat');
          run.focusSession(id);
        }}
        onEnd={run.endSession}
      />

      {hasBanners && (
        <div className="max-h-[45%] shrink-0 overflow-y-auto px-3 pt-2">
          {offChatRun && (
            <button
              type="button"
              onClick={() => open('chat')}
              className="enters mb-2 flex w-full items-center gap-2 rounded-xl border border-brand/35 bg-brand/8 px-2.5 py-2 text-left transition-colors hover:bg-brand/12"
            >
              <span className="glow-dot size-1.5 shrink-0 animate-pulse rounded-full bg-brand text-brand" />
              <span className="flex-1 text-xs text-ink">
                {runningCount === 1 ? 'A run is in progress' : `${runningCount} runs are in progress`}
              </span>
              <span className="shrink-0 font-mono text-[10px] tracking-[0.12em] text-brand uppercase">Watch</span>
            </button>
          )}
          {run.recording && <RecordingBar state={run.recording} onStop={run.stopRecording} />}
          {run.monitors.map((monitor) => (
            <MonitorBar key={monitor.monitorId} state={monitor} onStop={() => run.stopMonitor(monitor.monitorId)} />
          ))}
          {run.draft && <SiteMapReview draft={run.draft} onActivate={run.activateMap} onDiscard={run.discardMap} />}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <ScrollArea viewportRef={viewport} className="h-full">
          {tab === 'chat' ? (
            run.items.length === 0 ? (
              <Greeting
                blocker={status.blocker}
                voiceOn={voiceEnabled && voice.supported}
                onGo={open}
                onFix={() => setConnectionOpen(true)}
                onUse={voice.setInput}
              />
            ) : (
              <RunTimeline items={run.items} running={run.running} onDecide={run.decide} />
            )
          ) : tab === 'history' ? (
            <SessionList
              sessions={sessions}
              currentId={run.sessionId ?? undefined}
              busy={run.running}
              onOpen={openSession}
              onRemove={(id) => void removeSession(id)}
            />
          ) : tab === 'skills' ? (
            <SkillsPanel tabUrl={tabUrl} connected={connected} onMapSite={mapSite} mapping={run.running} />
          ) : tab === 'settings' ? (
            <SettingsPanel />
          ) : (
            <RecordingPanel
              tabUrl={tabUrl}
              recordings={recordings}
              recording={run.recording}
              busy={run.running}
              onStart={run.startRecording}
              onStop={run.stopRecording}
              onReplay={replayRecording}
              onRemove={(id) => void removeRecording(id)}
            />
          )}
          <div className="h-3" />
        </ScrollArea>

        {tab === 'chat' && !pinned && run.items.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="enters absolute bottom-3 left-1/2 -translate-x-1/2 backdrop-blur"
            onClick={goToLatest}
          >
            <ArrowDown className="size-3" /> Latest
          </Button>
        )}
      </div>

      {showTools && (
        <SavedToolList tools={run.tools} onForget={run.forgetTool} onClose={() => setShowTools(false)} />
      )}

      {tab === 'chat' && (
        <footer className="shrink-0 border-t border-line p-3">
          {run.toolOffer && (
            <KeepToolPrompt offer={run.toolOffer} onKeep={run.keepTool} onDismiss={run.dismissTool} />
          )}
          <Composer
            voice={voice}
            voiceEnabled={voiceEnabled}
            connected={connected}
            running={run.running}
            files={files}
            attachError={attachError}
            catalog={daemon?.skillCatalog}
            tabUrl={tabUrl}
            attachedSkill={attachedSkill}
            focus={focus}
            picking={picking}
            liveTools={liveTools}
            onToggleLiveTools={() => setLiveTools((on) => !on)}
            onAttachSkill={setAttachedSkill}
            onCommand={(command) => {
              if (isRemoveToolsCommand(command)) {
                setShowTools(true);
                return;
              }
              open('chat');
              run.send(command);
            }}
            tools={run.tools}
            onRunTool={(id) => {
              open('chat');
              run.runTool(id);
            }}
            onSend={handleSend}
            onStop={run.cancel}
            onToggleVoice={toggleVoice}
            onPick={() => void pointAtElement()}
            onClearFocus={() => setFocus(null)}
            onAttachPage={() => void attachPageContext()}
            onAttachFile={(file) => void attachFile(file)}
            onRemoveFile={(id) => void removeFile(id)}
          />
        </footer>
      )}
    </div>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(typeof result === 'string' ? result.slice(result.indexOf(',') + 1) : '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
