import { useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

import { GuardrailPolicy } from '@/extension/components/guardrail-policy';
import { ThemePicker } from '@/extension/components/theme-picker';
import { Switch } from '@/extension/components/ui/switch';
import { DEFAULT_THEME } from '@/lib/settings/theme';
import { Card, ConfirmDialog, CopyButton, OfflineHint, PathRow, PrimaryButton, QuietButton, SectionTitle, Segmented, Spinner } from '../components';
import { short, type Appearance, type Model, type State } from '../model';
import { UpdateCard } from './update-card';

export function SettingsView({ model, state }: { model: Model; state: State }) {
  const [confirming, setConfirming] = useState(false);
  const [keepSkills, setKeepSkills] = useState(true);
  const info = state.info;
  const mcpCommand = `claude mcp add browsentic -- ${info?.paths.mcpShim ?? 'browsentic-mcp'}`;
  const link = state.commandLink;

  return (
    <div className="space-y-4.5">
      <UpdateCard model={model} state={state} />

      <Card>
        <div className="space-y-3.5">
          <SectionTitle title="Appearance" />
          <Segmented<Appearance>
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={state.appearance}
            onSelect={(appearance) => model.setAppearance(appearance)}
          />
          <div className="border-t border-line" />
          <SwitchRow
            title="Turn Browsentic Bridge on when the app opens"
            subtitle="It keeps running after the window closes, so the side panel and MCP clients still work."
            checked={state.startDaemonOnLaunch}
            onChange={(on) => model.setStartDaemonOnLaunch(on)}
          />
        </div>
      </Card>

      <BrowserSettings model={model} state={state} />

      <Card>
        <div className="space-y-3">
          <SwitchRow
            title="“browsentic” in your terminal"
            subtitle={
              link?.linkedIn
                ? `On your PATH, in ${short(link.linkedIn, info)}. Everything this window does, the command does too. Terminals opened from now on have it.`
                : 'Adds its folder to your user PATH. No administrator, and only terminals opened afterwards see it.'
            }
            checked={!!link?.linkedIn}
            onChange={(on) => void model.setCommandLink(on)}
          />
          {link?.foreign && (
            <p className="flex gap-1.5 text-[11.5px] text-amber">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              Another browsentic is already on your PATH at {link.foreign}. Remove it with “npm rm -g browsentic” so the two cannot disagree.
            </p>
          )}
          {info && <PathRow path={info.paths.shim} model={model} info={info} />}
        </div>
      </Card>

      <Card>
        <div className="space-y-3">
          <SectionTitle
            title="Optional: use it from an MCP client"
            subtitle="The same browser tools, handed to Claude Code or any other MCP client. The side panel does not need this."
          />
          <div className="flex items-center gap-2 rounded-[10px] border border-line bg-ground-2 py-1.5 pr-1.5 pl-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink select-text">{mcpCommand}</span>
            <CopyButton value={mcpCommand} />
          </div>
          {state.lock && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-dim">Control token</span>
              <span className="font-mono text-[11px] text-ink-faint">{'•'.repeat(24)}</span>
              <div className="flex-1" />
              <CopyButton value={state.lock.token} label="Copy token" />
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <SectionTitle
              title="Uninstall"
              subtitle="Stops Browsentic Bridge, unpairs every browser, and removes the command, the unpacked extension, keys, approvals and logs."
            />
          </div>
          <QuietButton tint="danger" onClick={() => setConfirming(true)}>
            Uninstall…
          </QuietButton>
        </div>
      </Card>

      {confirming && (
        <ConfirmDialog
          title="Uninstall Browsentic?"
          message={
            'This stops Browsentic Bridge, unpairs every browser, and removes %USERPROFILE%\\.browsentic and %USERPROFILE%\\browsentic: the command, the unpacked extension, keys, approvals and logs.\n\nRemove Browsentic from each browser first: right-click its toolbar icon and choose Remove. Afterwards, uninstall the app itself in Settings › Apps › Installed apps.'
          }
          action="Uninstall"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void model.uninstall(keepSkills);
          }}
        >
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input type="checkbox" checked={keepSkills} onChange={(event) => setKeepSkills(event.target.checked)} className="accent-[var(--brand)]" />
            Keep my skills and site maps
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}

function SwitchRow({ title, subtitle, checked, onChange }: { title: string; subtitle: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <SectionTitle title={title} subtitle={subtitle} />
      </div>
      <Switch checked={checked} label={title} onChange={onChange} />
    </div>
  );
}

/** The settings every paired browser shares, kept by the daemon in config.json. The extension's own settings page edits the same values. */
function BrowserSettings({ model, state }: { model: Model; state: State }) {
  if (state.daemon !== 'on') return <OfflineHint what="The browser theme and the guardrails" model={model} daemonOff={state.daemon === 'off'} />;
  if (state.preferencesUnsupported) {
    return (
      <Card>
        <div className="flex items-center gap-3.5">
          <RefreshCw className="size-5 shrink-0 text-amber" strokeWidth={2.5} />
          <div className="min-w-0 flex-1">
            <SectionTitle
              title="Browsentic Bridge predates this app"
              subtitle="It is still running from before the last update, so it cannot share the browser theme or the guardrails yet."
            />
          </div>
          <PrimaryButton onClick={() => void model.restartDaemon()}>Restart it</PrimaryButton>
        </div>
      </Card>
    );
  }
  const preferences = state.preferences;
  if (!preferences) {
    return (
      <Card>
        <div className="flex justify-center">
          <Spinner />
        </div>
      </Card>
    );
  }
  const guardrailBusy = state.busy.find((key) => key.startsWith('guardrail:'))?.slice('guardrail:'.length) ?? null;

  return (
    <>
      <Card>
        <div className="space-y-3.5">
          <SectionTitle
            title="Browser theme"
            subtitle="How the side panel, the popup and the extension’s settings page look in every paired browser. This window keeps its own appearance."
          />
          <ThemePicker theme={preferences.theme ?? DEFAULT_THEME} onSelect={(theme) => void model.setBrowserTheme(theme)} />
        </div>
      </Card>
      <Card>
        <div className="space-y-4">
          <SectionTitle
            title="Guardrails"
            subtitle="What the agent may do without asking you first. A run takes its policy when it starts, and every paired browser follows the same rules."
          />
          <GuardrailPolicy
            settings={preferences.guardrails}
            busy={guardrailBusy}
            error={null}
            onWrite={(setting, value) => void model.setGuardrail(setting, value)}
            onReload={() => void model.loadPreferences()}
          />
        </div>
      </Card>
    </>
  );
}
