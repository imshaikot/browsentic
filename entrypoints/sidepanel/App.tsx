import { useEffect, useRef, useState } from 'react';
import { AudioLines, Bot, BookOpen, FileText, FileUp, Loader2, Mic, MicOff, Paperclip, RotateCcw, Send, Square, X } from 'lucide-react';
import { browser } from 'wxt/browser';

import { invokeInActiveTab } from '@/lib/actions/client';
import { getPageInfo } from '@/lib/actions/page/get-page-info';
import { BRIDGE_CHANNEL } from '@/lib/actions/protocol';
import { RunTimeline } from '@/components/run-timeline';
import { SiteMapReview } from '@/components/site-map-review';
import { SkillsPanel } from '@/components/skills-panel';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { putFile, removeFile, type StoredFileMeta } from '@/lib/bridge/file-store';
import { useActiveTabUrl } from '@/lib/bridge/use-active-tab-url';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import { useRun } from '@/lib/bridge/use-run';
import { useStoredFiles } from '@/lib/bridge/use-stored-files';
import { useVoiceComposer } from '@/lib/bridge/use-voice-composer';
import { useVoiceEnabled } from '@/lib/bridge/use-speech';
import { cn } from '@/lib/utils';

/** Files larger than this are refused before storing — the daemon rejects them anyway. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export default function App() {
  const daemon = useDaemonState();
  const run = useRun();
  const [voiceEnabled, setVoiceEnabled] = useVoiceEnabled();
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const files = useStoredFiles();
  const tabUrl = useActiveTabUrl();
  const [attachError, setAttachError] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);

  const connected = daemon?.connected ?? false;

  const voice = useVoiceComposer({
    // Audio by default: listen whenever the switch is on and there is nothing else to wait on.
    // Pause while a run works — the daemon takes one instruction at a time — then resume.
    active: voiceEnabled && connected && !run.running,
    onSubmit: (text) => run.send(text),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [run.items, run.running]);

  function handleSend() {
    if (run.running || !connected) return;
    voice.submitNow();
  }

  async function attachPageContext() {
    const result = await invokeInActiveTab(getPageInfo, {});
    if (!result.ok) {
      voice.setInput(`${voice.input}\n[couldn't read this page: ${result.error.message}]\n`);
      return;
    }
    const { document: doc, selection } = result.data;
    const snippet = selection ? `\nSelection: "${selection}"` : '';
    voice.setInput(`${voice.input ? `${voice.input}\n\n` : ''}[Page: ${doc.title} — ${doc.url}${snippet}]\n`);
  }

  // Store the picked file and hand it to the background, which sends it to the daemon to
  // summarize and writes the result back to the file index (see file-store.ts / background.ts).
  async function onPickFile() {
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    if (input) input.value = ''; // let the same file be picked again later
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setAttachError(`"${file.name}" is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
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
    // On when a mic error is standing: this click is a gesture, so retry the prompt, don't mute.
    if (voice.error) {
      voice.retry();
      return;
    }
    setVoiceEnabled(false);
  }

  const status = run.running ? 'Working…' : voice.listening ? 'Listening…' : connected ? 'Ready' : 'Not connected';

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
          <AudioLines className="size-4" />
        </div>
        <div className="flex-1">
          <h1 className="text-sm leading-none font-semibold">VoiceLink</h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                run.running
                  ? 'animate-pulse bg-violet-500'
                  : voice.listening
                    ? 'animate-pulse bg-rose-500'
                    : connected
                      ? 'bg-emerald-500'
                      : 'bg-muted-foreground/40',
              )}
            />
            {status}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Clear conversation" onClick={run.clear}>
          <RotateCcw />
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        {run.items.length === 0 ? (
          <Greeting connected={connected} voiceOn={voiceEnabled && voice.supported} />
        ) : (
          <RunTimeline items={run.items} onDecide={run.decide} />
        )}
        <div ref={bottomRef} className="h-4" />
      </ScrollArea>

      <footer className="border-t p-3">
        {attachError && (
          <p className="mb-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            {attachError}
          </p>
        )}
        {run.draft && (
          <SiteMapReview draft={run.draft} onActivate={run.activateMap} onDiscard={run.discardMap} />
        )}
        {skillsOpen && (
          <SkillsPanel
            tabUrl={tabUrl}
            connected={connected}
            onMapSite={() => {
              setSkillsOpen(false);
              run.mapSite();
            }}
            mapping={run.running}
          />
        )}
        <FilesList files={files} onRemove={(id) => void removeFile(id)} />
        <VoiceStatus voice={voice} voiceEnabled={voiceEnabled} connected={connected} />

        <div className="flex items-end gap-2">
          <Textarea
            value={voice.input}
            onChange={(e) => voice.setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={connected ? 'Speak, or type what to do on this page…' : 'Pair the browser to get started'}
            disabled={!connected}
            className="max-h-32 min-h-10 flex-1 resize-none"
          />
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Attach page context"
              onClick={attachPageContext}
              disabled={!connected}
            >
              <Paperclip />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Attach a file"
              onClick={() => fileInputRef.current?.click()}
              disabled={!connected}
            >
              <FileUp />
            </Button>
            <Button
              variant={skillsOpen ? 'default' : 'ghost'}
              size="icon"
              aria-label={skillsOpen ? 'Hide skills' : 'Show skills'}
              onClick={() => setSkillsOpen(!skillsOpen)}
            >
              <BookOpen />
            </Button>
            <Button
              variant={voiceEnabled && !voice.error ? 'default' : 'ghost'}
              size="icon"
              aria-label={voiceEnabled ? 'Turn voice off' : 'Turn voice on'}
              title={voice.supported ? undefined : 'Voice input is not available in this browser'}
              onClick={toggleVoice}
              disabled={!voice.supported}
              className={cn(voiceEnabled && voice.listening && 'relative')}
            >
              {voiceEnabled && voice.listening && (
                <span className="absolute inset-0 animate-ping rounded-md bg-primary/30" />
              )}
              {voiceEnabled && !voice.error ? <Mic /> : <MicOff />}
            </Button>
            {run.running ? (
              <Button size="icon" variant="destructive" aria-label="Stop the agent" onClick={run.cancel}>
                <Square />
              </Button>
            ) : (
              <Button
                size="icon"
                aria-label="Send message"
                onClick={handleSend}
                disabled={!voice.input.trim() || !connected}
              >
                <Send />
              </Button>
            )}
          </div>
        </div>
        <input ref={fileInputRef} type="file" className="hidden" onChange={onPickFile} />
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          {voiceEnabled && voice.supported
            ? 'Speak and pause to send · Enter to send now · Shift+Enter for a new line'
            : 'Enter to send · Shift+Enter for a new line'}
        </p>
      </footer>
    </div>
  );
}

/** The strip above the composer: mic errors, the live transcript, and the auto-send countdown. */
function VoiceStatus({
  voice,
  voiceEnabled,
  connected,
}: {
  voice: ReturnType<typeof useVoiceComposer>;
  voiceEnabled: boolean;
  connected: boolean;
}) {
  if (voiceEnabled && voice.error) {
    return (
      <p className="mb-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
        {voice.error}
      </p>
    );
  }

  if (voice.pendingSend) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
        <span className="relative flex-1 overflow-hidden rounded-full bg-primary/20">
          <span
            className="block h-1 rounded-full bg-primary"
            style={{ animation: `voicelink-countdown ${voice.autoSendMs}ms linear forwards` }}
          />
        </span>
        <span className="shrink-0">Sending…</span>
        <button
          type="button"
          onClick={voice.cancelPending}
          className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 hover:bg-primary/15"
          aria-label="Cancel sending"
        >
          <X className="size-3" /> Edit
        </button>
      </div>
    );
  }

  if (voiceEnabled && voice.listening) {
    return (
      <p className="mb-2 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <span className="inline-flex size-1.5 shrink-0 animate-pulse rounded-full bg-rose-500" />
        {voice.interim ? <span className="truncate italic">{voice.interim}</span> : <span>Listening…</span>}
      </p>
    );
  }

  if (voiceEnabled && connected && !voice.supported) {
    return (
      <p className="mb-2 px-1 text-xs text-muted-foreground">Voice input isn&apos;t available in this browser.</p>
    );
  }

  return null;
}

/** The stored-file repository: each file with its size and the daemon's summary or status. */
function FilesList({ files, onRemove }: { files: StoredFileMeta[]; onRemove: (id: string) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="mb-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
      {files.map((file) => (
        <div
          key={file.id}
          className="flex items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs"
        >
          <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{file.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(file.size)}</span>
            </div>
            {file.status === 'pending' && (
              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Analyzing…
              </span>
            )}
            {file.status === 'ready' && file.summary && (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{file.summary}</p>
            )}
            {file.status === 'error' && (
              <span className="mt-0.5 block text-[11px] text-destructive">{file.error ?? 'Analysis failed'}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onRemove(file.id)}
            aria-label={`Remove ${file.name}`}
            className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Read a File as raw base64 (no `data:` prefix), the encoding the store and daemon expect. */
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Greeting({ connected, voiceOn }: { connected: boolean; voiceOn: boolean }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
          <Bot className="size-4" />
        </div>
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm">
          {connected ? (
            <>
              Hi, I&apos;m VoiceLink.{' '}
              {voiceOn ? 'Just talk' : 'Tell me'} what to do on this page — read it, fill something in, click through a
              flow — and you&apos;ll see every action I take as I take it.
            </>
          ) : (
            <>
              This browser isn&apos;t paired yet. Run <code className="font-mono text-xs">voicelink-mcp pair</code> and
              enter the code in the VoiceLink popup.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
