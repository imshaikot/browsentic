import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { mountTheme } from '@/lib/bridge/theme';
import '@/extension/assets/globals.css';

mountTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
