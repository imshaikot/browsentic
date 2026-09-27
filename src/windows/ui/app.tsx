import { useEffect, useSyncExternalStore } from 'react';

import { Backdrop, NoticeBanner } from './components';
import { TABS, useModelState, type Appearance, type Model } from './model';
import type { Backend } from './backend';
import { MainView } from './views/main';
import { PreflightView } from './views/preflight';

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function useSystemDark() {
  return useSyncExternalStore(
    (listener) => {
      const query = darkQuery();
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    },
    () => darkQuery().matches,
  );
}

/** Ember when dark and Daylight when light, as the macOS window does; the browsers keep their own theme. */
function useAppearance(appearance: Appearance, backend: Backend) {
  const systemDark = useSystemDark();
  const dark = appearance === 'dark' || (appearance === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'ember' : 'daylight';
    void backend.setWindowTheme(appearance === 'system' ? null : appearance).catch(() => undefined);
  }, [dark, appearance, backend]);
}

function useShortcuts(model: Model) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const state = model.snapshot();
      const digit = Number(event.key);
      if (!event.shiftKey && digit >= 1 && digit <= TABS.length) {
        event.preventDefault();
        model.setTab(TABS[digit - 1]);
        return;
      }
      if (!event.shiftKey || state.phase !== 'main') return;
      const key = event.key.toLowerCase();
      if (key === 'd' && (state.daemon === 'on' || state.daemon === 'off')) void model.setDaemon(state.daemon === 'off');
      else if (key === 'r' && state.daemon === 'on') void model.restartDaemon();
      else if (key === 'p' && state.daemon === 'on') {
        model.setTab('browsers');
        void model.newPairingCode();
      } else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [model]);
}

export function App({ model, backend }: { model: Model; backend: Backend }) {
  const state = useModelState(model);
  useAppearance(state.appearance, backend);
  useShortcuts(model);
  useEffect(() => model.start(), [model]);

  return (
    <div className="relative h-full text-ink">
      <Backdrop />
      <div className="relative h-full">
        {state.phase === 'preflight' ? <PreflightView model={model} state={state} /> : <MainView model={model} state={state} />}
      </div>
      {state.notice && (
        <div key={state.notice.id} className="enter pointer-events-auto fixed inset-x-0 bottom-5.5 flex justify-center px-6">
          <NoticeBanner text={state.notice.text} isError={state.notice.isError} />
        </div>
      )}
    </div>
  );
}
