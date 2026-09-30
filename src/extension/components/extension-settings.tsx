import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';

import { Button } from '@/extension/components/ui/button';
import { Switch } from '@/extension/components/ui/switch';
import { HANDS_FREE_SHORTCUT } from '@/lib/settings/shortcuts';
import { openShortcutSettings, useContextMenuChoice, usePushToTalk, useShortcuts } from '@/lib/bridge/use-extension-settings';
import { useHandsFreeSupported } from '@/lib/bridge/use-speech';
import { cn } from '@/lib/utils';

export function ExtensionSettings() {
  const handsFree = useHandsFreeSupported();
  return (
    <>
      <ContextMenuItems handsFree={handsFree} />
      <KeyboardShortcuts handsFree={handsFree} />
      {handsFree && <HandsFree />}
    </>
  );
}

function ContextMenuItems({ handsFree }: { handsFree: boolean }) {
  const [choice, setChoice] = useContextMenuChoice();
  return (
    <SettingsGroup
      title="Right-click menu"
      note="What a right-click anywhere on a page offers. With more than one item on, the browser gathers them under Browsentic."
    >
      <Row title="Open Browsentic" note="Opens the side panel, or closes it while it is open.">
        <Switch
          checked={choice.panel}
          label="Show Open Browsentic in the right-click menu"
          onChange={(panel) => setChoice({ ...choice, panel })}
        />
      </Row>
      {handsFree && (
        <Row
          title="Open Browsentic (Hands Free)"
          note="Puts the mic on the page instead of the panel, or takes it away while it is there."
        >
          <Switch
            checked={choice.handsFree}
            label="Show Open Browsentic (Hands Free) in the right-click menu"
            onChange={(on) => setChoice({ ...choice, handsFree: on })}
          />
        </Row>
      )}
    </SettingsGroup>
  );
}

function KeyboardShortcuts({ handsFree }: { handsFree: boolean }) {
  const shortcuts = useShortcuts()?.filter(({ name }) => handsFree || name !== HANDS_FREE_SHORTCUT);
  return (
    <SettingsGroup
      title="Keyboard shortcuts"
      note="The browser keeps these keys, not Browsentic: it hands out the suggested ones unless something else already has them, and changes them on its own shortcuts page."
    >
      {shortcuts === undefined ? (
        <Row title="Reading the shortcuts…" />
      ) : (
        shortcuts.map(({ name, label, keys }) => (
          <Row key={name} title={label}>
            {keys.length ? (
              <span className="flex gap-1">
                {keys.map((key, index) => (
                  <kbd
                    key={index}
                    className="min-w-6 rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-center text-xs font-medium text-ink-dim"
                  >
                    {key}
                  </kbd>
                ))}
              </span>
            ) : (
              <span className="font-mono text-[10px] tracking-[0.1em] text-ink-faint uppercase">Not set</span>
            )}
          </Row>
        ))
      )}
      <div className="px-4 py-3">
        <Button variant="outline" size="sm" onClick={openShortcutSettings}>
          <ExternalLink /> Change shortcuts
        </Button>
      </div>
    </SettingsGroup>
  );
}

function HandsFree() {
  const [pushToTalk, setPushToTalk] = usePushToTalk();
  return (
    <SettingsGroup title="Hands-free" note="How the mic on the page listens. Its own menu switches the same setting.">
      <Row
        title="Hold to talk"
        note="The mic listens only while you hold left Control — control on a Mac — and sends what you said the moment you let go."
      >
        <Switch checked={pushToTalk} label="Hold to talk" onChange={setPushToTalk} />
      </Row>
    </SettingsGroup>
  );
}

export function SettingsGroup({
  title,
  note,
  card = true,
  children,
}: {
  title: string;
  note?: string;
  card?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <header className="space-y-1">
        <h3 className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">{title}</h3>
        {note && <p className="text-xs leading-relaxed text-ink-faint">{note}</p>}
      </header>
      {card ? <div className="panel-card divide-y divide-line overflow-hidden rounded-xl">{children}</div> : children}
    </section>
  );
}

function Row({ title, note, children }: { title: string; note?: string; children?: ReactNode }) {
  return (
    <div className={cn('flex gap-6 px-4 py-3.5', note ? 'items-start' : 'items-center')}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {note && <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{note}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center pt-0.5">{children}</div>}
    </div>
  );
}
