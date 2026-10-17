import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PlainNewTab } from '@/extension/components/plain-new-tab';
import { browserOwnNewTab, handTabTo, homeLooksOff, readNewTabChoice, rememberHome } from '@/lib/bridge/new-tab';
import { mountTheme } from '@/lib/bridge/theme';
import '@/extension/assets/globals.css';

mountTheme();

const root = ReactDOM.createRoot(document.getElementById('root')!);

function showHome() {
  root.render(
    <React.StrictMode>
      <App onTurnOff={() => void handOn()} />
    </React.StrictMode>,
  );
}

/** Home is off: the browser's own page where it can be opened, a quiet page of frequent sites where it cannot. */
async function handOn() {
  const own = browserOwnNewTab();
  if (own && (await handTabTo(own).catch(() => false))) return;
  root.render(
    <React.StrictMode>
      <PlainNewTab onTurnOn={showHome} />
    </React.StrictMode>,
  );
}

const lookedOff = homeLooksOff();
if (!lookedOff) showHome();

void readNewTabChoice()
  .then(({ home }) => {
    rememberHome(home);
    if (!home) void handOn();
    else if (lookedOff) showHome();
  })
  .catch(() => {
    if (lookedOff) void handOn();
  });

window.addEventListener('pageshow', (event) => {
  if (event.persisted && homeLooksOff()) void handOn();
});
