// Harness tương tác cho gợi ý "Như đơn trước" trên màn Lập đơn chủ động thật; RPC Supabase được Playwright mock.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import ProactiveOrderEditor from '../../components/procurement/hub/ProactiveOrderEditor';

createRoot(document.getElementById('root')!).render(
  <ProactiveOrderEditor onClose={() => { document.title = 'closed'; }} onSaved={() => { document.title = 'saved'; }} />,
);
