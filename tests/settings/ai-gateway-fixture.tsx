// Harness cho Cài đặt → Cổng AI với component thật; RPC Supabase và edge function ai-gateway được Playwright mock.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { ToastProvider } from '../../context/ToastContext';
import SettingsAiGateway from '../../pages/settings/SettingsAiGateway';

createRoot(document.getElementById('root')!).render(
  <ToastProvider><div className="mx-auto max-w-5xl p-4 sm:p-6"><SettingsAiGateway /></div></ToastProvider>,
);
