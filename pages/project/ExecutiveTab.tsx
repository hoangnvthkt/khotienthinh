import React from 'react';
import FastConsDashboard from '../../components/project/FastConsDashboard';

interface ExecutiveTabProps {
  constructionSiteId: string;
  projectId?: string;
}

const ExecutiveTab: React.FC<ExecutiveTabProps> = ({ constructionSiteId, projectId }) => (
  <FastConsDashboard constructionSiteId={constructionSiteId} projectId={projectId} />
);

export default ExecutiveTab;
