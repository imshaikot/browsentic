import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelRight, SlidersHorizontal } from 'lucide-react';
import { browser } from 'wxt/browser';

import { AgentChip } from '@/extension/components/agent-chip';
import { AgentPicker } from '@/extension/components/agent-picker';
import { Logo, Wordmark } from '@/extension/components/brand';
import { Composer, type AttachedSkill } from '@/extension/components/composer';
import { DaemonLink } from '@/extension/components/daemon-link';
import { DropMask } from '@/extension/components/drop-mask';
import { FrequentSites } from '@/extension/components/frequent-sites';
import { HomeCustomize } from '@/extension/components/home-customize';
import { Popover } from '@/extension/components/popover';
import { RecentConversations } from '@/extension/components/recent-conversations';
import { RunCard } from '@/extension/components/run-card';
import { SavedToolList } from '@/extension/components/saved-tools';
import { StatusPill, describeStatus, type StatusBlocker } from '@/extension/components/status-pill';
import { Button } from '@/extension/components/ui/button';
import { BRIDGE_CHANNEL } from '@/lib/actions/protocol';
import { isRemoveToolsCommand } from '@/lib/bridge/commands';
import { showPanelTab } from '@/lib/bridge/panel-view';
import { hasSidePanel, openSidePanel } from '@/lib/bridge/side-panel';
import { useOwnTab } from '@/lib/bridge/use-active-tab';
import { useAttachFiles } from '@/lib/bridge/use-attach-files';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import { useActionCues, useNewTabChoice } from '@/lib/bridge/use-extension-settings';
import { useFileDrop } from '@/lib/bridge/use-file-drop';
import { useFrequentSites } from '@/lib/bridge/use-frequent-sites';
import { useRun } from '@/lib/bridge/use-run';
import { useStoredFiles } from '@/lib/bridge/use-stored-files';
import { useStoredSessions } from '@/lib/bridge/use-stored-sessions';
import { useVoiceComposer } from '@/lib/bridge/use-voice-composer';
import { MAX_STORED_FILE_BYTES } from '@/lib/files/report';
import { greeting } from '@/lib/home/greeting';
import { summarize } from '@/lib/home/run-summary';
import { suggestionsFor } from '@/lib/home/suggestions';
import { hideSite } from '@/lib/settings/new-tab';

type Sheet = 'connection' | 'agent' | 'customize';

const RECENT = 4;

const SETUP: Record<StatusBlocker, { text: string; action: string; sheet: Sheet }> = {
  unpaired: { text: 'This browser isn’t connected to Browsentic Bridge yet.', action: 'Set up the link', sheet: 'connection' },
  offline: { text: 'Browsentic Bridge isn’t answering. Start it and this reconnects on its own.', action: 'Check the link', sheet: 'connection' },
  agent: { text: 'The chosen agent can’t run on this computer.', action: 'Choose another agent', sheet: 'agent' },
};

const composerField = () => document.querySelector<HTMLTextAreaElement>('textarea[data-slot="textarea"]');

const TYPING_TARGETS = 'input, textarea, select, button, a, [contenteditable="true"]';

export default function App({ onTurnOff }: { onTurnOff: () => void }) {
  const daemon = useDaemonState();
  const own = useOwnTab();
  const run = useRun(own);
  const [choice, setChoice] = useNewTabChoice();
  const frequent = useFrequentSites(choice.sites, choice.hidden);
  const stored = useStoredSessions();
  const storedFiles = useStoredFiles();
  const [micOn, setMicOn] = useState(false);
  const [actionCues, setActionCues] = useActionCues();
  const [liveTools, setLiveTools] = useState(false);
  const [attachedSkill, setAttachedSkill] = useState<AttachedSkill | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachFiles = useAttachFiles(run.attachFile, setAttachError);
  const [showTools, setShowTools] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const toggle = (next: Sheet) => setSheet((open) => (open === next ? null : next));

  const panel = hasSidePanel();
  const connected = daemon?.connected ?? false;

  /** Must run first in a click or key press: the browser opens a side panel only while the gesture is fresh. */
  function reveal() {
    if (panel && own.windowId != null) void openSidePanel(own.windowId).catch(() => undefined);
  }

  /* Per page, not the panel's stored switch: new tabs open all day, and none may start listening on its own. */
  const voice = useVoiceComposer({
    active: micOn && connected && !run.running,
    onSubmit: (text) => {
      reveal();
      run.send(text, { agentSkillId: attachedSkill?.id, liveTools });
      setAttachedSkill(null);
    },
  });

  const dragging = useFileDrop({ active: connected, onDrop: (dropped) => void attachFiles(dropped) });

  useEffect(() => {
    if (!connected || daemon?.skillCatalog) return;
    void browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'listSkills' });
  }, [connected, daemon?.skillCatalog]);

  useEffect(() => {
    const typed = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      if ((event.target as HTMLElement).closest(TYPING_TARGETS)) return;
      composerField()?.focus();
    };
    document.addEventListener('keydown', typed);
    return () => document.removeEventListener('keydown', typed);
  }, []);

  const status = describeStatus(daemon, { running: run.running, listening: voice.listening });
  const files = useMemo(
    () => storedFiles.filter((file) => file.sessionId !== undefined && file.sessionId === run.sessionId),
    [storedFiles, run.sessionId],
  );
  const summary = useMemo(
    () => summarize(run.items.filter((item) => !(item.kind === 'tool' && item.source === 'external')), run.running),
    [run.items, run.running],
  );
  const ideas = useMemo(() => suggestionsFor(frequent.sites.map((site) => site.host)), [frequent.sites]);
  const running = run.sessions.filter((session) => session.runId && session.sessionId !== run.sessionId);
  const recent = stored
    .filter((session) => session.id !== run.sessionId && !running.some((live) => live.sessionId === session.id))
    .slice(0, RECENT);
  const hello = greeting(new Date().getHours(), daemon?.preferences?.profile.fields.givenName);
  const setup = status.blocker && SETUP[status.blocker];

  function send() {
    if (!connected || run.running) return;
    voice.submitNow();
  }

  function command(text: string) {
    if (isRemoveToolsCommand(text)) {
      setShowTools(true);
      return;
    }
    reveal();
    run.send(text);
  }

  function use(text: string) {
    voice.setInput(text);
    composerField()?.focus();
  }

  function toggleVoice() {
    if (micOn && voice.error) voice.retry();
    else setMicOn(!micOn);
  }

  function openConversation(sessionId: string) {
    reveal();
    void run.restore(sessionId);
  }

  function watch(sessionId: string) {
    reveal();
    run.focusSession(sessionId);
  }

  function showAll() {
    reveal();
    void showPanelTab('history');
  }

  function turnOff() {
    setChoice({ ...choice, home: false });
    onTurnOff();
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip">
      <div aria-hidden className="dot-grid fade-radial pointer-events-none fixed inset-0" />

      <header className="relative z-20 flex items-center gap-2 px-5 py-4">
        <Wordmark />
        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <StatusPill tone={status.tone} expanded={sheet === 'connection'} onClick={() => toggle('connection')}>
              {status.label}
            </StatusPill>
            <Popover open={sheet === 'connection'} label="Connection" onClose={closeSheet}>
              <div className="space-y-4">
                <DaemonLink />
                <AgentPicker />
              </div>
            </Popover>
          </div>
          {panel && (
            <Button variant="ghost" size="icon-sm" title="Open the side panel" aria-label="Open the side panel" onClick={reveal}>
              <PanelRight className="size-3.5" />
            </Button>
          )}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Customize"
              aria-label="Customize this page"
              aria-expanded={sheet === 'customize'}
              onClick={() => toggle('customize')}
            >
              <SlidersHorizontal className="size-3.5" />
            </Button>
            <Popover open={sheet === 'customize'} label="Customize" onClose={closeSheet}>
              <HomeCustomize choice={choice} onChange={setChoice} onTurnOff={turnOff} />
            </Popover>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[44rem] flex-1 flex-col px-5 pt-[9vh] pb-16">
        <div className="flex flex-col items-center text-center">
          <Logo drawn className="size-11 text-brand" />
          <h1 className="mt-4 font-display text-[2rem] leading-tight font-semibold tracking-tight text-ink sm:text-[2.5rem]">
            {hello}
          </h1>
        </div>

        <div className="relative mt-8">
          <div aria-hidden className="home-halo pointer-events-none absolute -inset-x-24 -inset-y-16" />
          <div className="relative">
            <Composer
              size="hero"
              voice={voice}
              voiceEnabled={micOn}
              connected={connected}
              running={run.running}
              files={files}
              attachError={attachError}
              catalog={daemon?.skillCatalog}
              tabUrl=""
              attachedSkill={attachedSkill}
              focus={null}
              picking={false}
              liveTools={liveTools}
              onToggleLiveTools={() => setLiveTools((on) => !on)}
              actionCues={actionCues}
              onToggleActionCues={() => setActionCues(!actionCues)}
              onAttachSkill={setAttachedSkill}
              handsFree={false}
              placeholder="Tell me what to do, or where to go…"
              accessory={
                <div className="relative min-w-0">
                  <AgentChip state={daemon?.agent} expanded={sheet === 'agent'} onClick={() => toggle('agent')} />
                  <Popover open={sheet === 'agent'} label="Agent" onClose={closeSheet}>
                    <AgentPicker />
                  </Popover>
                </div>
              }
              onCommand={command}
              tools={run.tools}
              onRunTool={(id) => {
                reveal();
                run.runTool(id);
              }}
              onSend={send}
              onStop={run.cancel}
              onToggleVoice={toggleVoice}
              onClearFocus={() => undefined}
              onAttachFile={(file) => void attachFiles([file])}
              onRemoveFile={run.detachFile}
              onRetryFile={run.reanalyzeFile}
            />
          </div>
        </div>

        <div className="mt-5">
          {setup ? (
            <div className="enters flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-2xl border border-amber/30 bg-amber/8 px-4 py-3 text-center">
              <p className="text-sm text-ink">{setup.text}</p>
              <Button size="sm" variant="outline" onClick={() => setSheet(setup.sheet)}>
                {setup.action}
              </Button>
            </div>
          ) : summary.phase !== 'idle' ? (
            <RunCard
              summary={summary}
              onOpenPanel={panel ? reveal : undefined}
              onDecide={(toolId, allow) => run.decide(toolId, allow)}
              onDismiss={run.clear}
            />
          ) : (
            <ul aria-label="Suggestions" className="flex flex-wrap justify-center gap-2">
              {ideas.map((text) => (
                <li key={text}>
                  <button
                    type="button"
                    onClick={() => use(text)}
                    className="rounded-full border border-line bg-ground-2/60 px-3 py-1.5 text-xs text-ink-dim transition-colors hover:border-brand/40 hover:text-ink"
                  >
                    {text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {choice.sites && (
          <div className="mt-12">
            <FrequentSites frequent={frequent} onHide={(host) => setChoice(hideSite(choice, host))} />
          </div>
        )}

        <div className="mt-10">
          <RecentConversations
            running={running}
            recent={recent}
            onWatch={watch}
            onOpen={openConversation}
            onShowAll={panel ? showAll : undefined}
          />
        </div>
      </main>

      {showTools && (
        <SavedToolList
          tools={run.tools}
          autoRunReady={run.autoRunReady}
          onAutoRun={run.setAutoRun}
          onForget={run.forgetTool}
          onClose={() => setShowTools(false)}
        />
      )}
      {dragging && <DropMask connected={connected} maxBytes={MAX_STORED_FILE_BYTES} />}
    </div>
  );
}
