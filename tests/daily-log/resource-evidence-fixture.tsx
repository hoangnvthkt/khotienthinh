import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '../../index.css';
import { ResourceUsageEvidencePanel } from '../../components/project/finance/ResourceUsageEvidencePanel';

createRoot(document.getElementById('root')!).render(<BrowserRouter><main className="mx-auto max-w-7xl p-3 sm:p-6 lg:p-8">
  <ResourceUsageEvidencePanel projectId="DL-WBS-PILOT-20260925" constructionSiteId={null} />
</main></BrowserRouter>);
