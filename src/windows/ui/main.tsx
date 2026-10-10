import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './app.css';
import { App } from './app';
import { isTauri, tauriBackend } from './backend';
import { isSettingsSection, Model, type Tab } from './model';

const backend = isTauri() ? await tauriBackend() : await import('./mock-backend').then(({ mockBackend }) => mockBackend());
const model = new Model(backend);

const previewTab = !isTauri() && new URLSearchParams(location.search).get('tab');
if (previewTab) {
  const stop = model.subscribe(() => {
    if (model.snapshot().phase !== 'main') return;
    stop();
    if (isSettingsSection(previewTab)) model.openSettings(previewTab);
    else model.setTab(previewTab as Tab);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App model={model} backend={backend} />
  </StrictMode>,
);
