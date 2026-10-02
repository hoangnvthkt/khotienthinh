import React from 'react';
import { useLocation } from 'react-router-dom';
import { FinanceHubView } from '../../components/finance/FinanceHubView';
import { useApp } from '../../context/AppContext';

const FinanceHub: React.FC = () => {
  const { user } = useApp();
  const params = new URLSearchParams(useLocation().search);
  return <FinanceHubView currentUserId={user.id} initialSection={params.get('section')} initialSupplierId={params.get('supplier')} initialRequestId={params.get('request')} />;
};

export default FinanceHub;
