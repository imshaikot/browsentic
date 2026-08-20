import { useEffect, useRef, useState } from 'react';
import { ArrowDown, SquarePen } from 'lucide-react';
import { browser } from 'wxt/browser';

import { invokeInActiveTab } from '@/lib/actions/client';
import { getPageInfo } from '@/lib/actions/page/get-page-info';
import { BRIDGE_CHANNEL } from '@/lib/actions/protocol';
import { Wordmark } from '@/components/brand';
import { Composer } from '@/components/composer';
import { ConnectionSheet } from '@/components/connection-sheet';
import { Greeting } from '@/components/greeting';
import { MonitorBar } from '@/components/monitor-bar';
import { PanelNav, type PanelTab } from '@/components/panel-nav';
import { RecordingBar } from '@/components/recording-bar';
import { RecordingPanel } from '@/components/recording-panel';
import { RunTimeline } from '@/components/run-timeline';
import { SessionList } from '@/components/session-list';
import { SiteMapReview } from '@/components/site-map-review';
import { SkillsPanel } from '@/components/skills-panel';
import { StatusPill, describeStatus } from '@/components/status-pill';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { putFile, removeFile } from '@/lib/bridge/file-store';
import { removeRecording, type StoredRecordingMeta } from '@/lib/bridge/recording-store';
import { removeSession } from '@/lib/bridge/session-store';
import { useActiveTabUrl } from '@/lib/bridge/use-active-tab-url';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
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
  const run = useRun({ persist: true });
  const [voiceEnabled, setVoiceEnabled] = useVoiceEnabled();
  const files = useStoredFiles();
  const sessions = useStoredSessions();
  const recordings = useStoredRecordings();
  const skills = useStoredSkills();
  const tabUrl = useActiveTabUrl();
  const [attachError, setAttachError] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>('chat');
  const [connectionOpen, setConnectionOpen] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  const connected = daemon?.connected ?? false;

  const voice = useVoiceComposer({
    active: voiceEnabled && connected && !run.running,
    onSubmit: (text) => run.send(text),
  });

  const status = describeStatus(daemon, { running: run.running, listening: voice.listening });

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

  const offChatRun = run.running && tab !== 'chat';
  const hasBanners = offChatRun || !!run.recording || run.monitors.length > 0 || !!run.draft;

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
      </header>

      {connectionOpen && <ConnectionSheet onClose={() => setConnectionOpen(false)} />}

      <PanelNav
        tab={tab}
        counts={{ history: sessions.length, skills: skills.length, recordings: recordings.length }}
        onSelect={open}
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
              <span className="flex-1 text-xs text-ink">A run is in progress</span>
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
              currentId={run.sessionId}
              busy={run.running}
              onOpen={openSession}
              onRemove={(id) => void removeSession(id)}
            />
          ) : tab === 'skills' ? (
            <SkillsPanel tabUrl={tabUrl} connected={connected} onMapSite={mapSite} mapping={run.running} />
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

      {tab === 'chat' && (
        <footer className="shrink-0 border-t border-line p-3">
          <Composer
            voice={voice}
            voiceEnabled={voiceEnabled}
            connected={connected}
            running={run.running}
            files={files}
            attachError={attachError}
            onSend={handleSend}
            onStop={run.cancel}
            onToggleVoice={toggleVoice}
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
