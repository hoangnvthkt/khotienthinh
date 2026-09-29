// Interaction harness only: the real panel and service, HTTP mocked in Playwright.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { DailyLogCrewLinkingPanel } from '../../components/project/daily-log/DailyLogCrewLinkingPanel';
createRoot(document.getElementById('root')!).render(<DailyLogCrewLinkingPanel projectId="project-1" constructionSiteId={null} />);
