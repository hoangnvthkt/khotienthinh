import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ProcurementHubView } from '../../components/procurement/hub/ProcurementHubView';
import { useApp } from '../../context/AppContext';

// Old workbench links (?view=…, ?demandId=…) keep working on the legacy screen.
const LEGACY_PARAMS = ['view', 'stage', 'demandId'];

const ProcurementHub: React.FC = () => {
  const { user } = useApp();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  if (LEGACY_PARAMS.some(key => params.has(key))) return <Navigate to={`/procurement/legacy${search}`} replace />;
  return <ProcurementHubView currentUserId={user.id} initialOrderId={params.get('po')} initialContractId={params.get('contract')} />;
};

export default ProcurementHub;
