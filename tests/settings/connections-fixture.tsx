// Harness cho Cài đặt → Kết nối với component thật; RPC Supabase và edge function integrations được Playwright mock.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { ToastProvider } from '../../context/ToastContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import SettingsConnections from '../../pages/settings/SettingsConnections';

createRoot(document.getElementById('root')!).render(
  <ToastProvider><ConfirmProvider><div className="mx-auto max-w-5xl p-4 sm:p-6"><SettingsConnections /></div></ConfirmProvider></ToastProvider>,
);
