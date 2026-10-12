// Harness cho bảng đo gợi ý in mờ (Cài đặt → Gợi ý nhập liệu) với component thật; RPC Supabase được Playwright mock.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import SettingsSuggestionStats from '../../pages/settings/SettingsSuggestionStats';

createRoot(document.getElementById('root')!).render(
  <div className="mx-auto max-w-5xl p-4 sm:p-6"><SettingsSuggestionStats /></div>,
);
