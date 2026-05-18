import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ContractItemType, CustomerContract, SubcontractorContract } from '../../types';
import { customerContractService, subcontractorContractService } from '../../lib/hdService';
import ContractWorkspace from '../../components/project/ContractWorkspace';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

type LoadedContract = CustomerContract | SubcontractorContract;

const ContractWorkspacePage: React.FC<{ contractType: ContractItemType }> = ({ contractType }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [contract, setContract] = useState<LoadedContract | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = contractType === 'customer'
        ? await customerContractService.getById(id)
        : await subcontractorContractService.getById(id);
      setContract(data);
    } catch (error) {
      logApiError('contractWorkspacePage.load', error);
      toast.error('Không thể tải hợp đồng', getApiErrorMessage(error, 'Không thể tải chi tiết hợp đồng.'));
    } finally {
      setLoading(false);
    }
  }, [contractType, id, toast]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="p-12 text-center text-sm text-slate-400 font-bold">
        <Loader2 size={18} className="inline animate-spin mr-2" />Đang tải workspace hợp đồng...
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <p className="text-sm font-bold text-slate-500 mb-3">Không tìm thấy hợp đồng.</p>
        <button onClick={() => navigate(contractType === 'customer' ? '/hd/customer' : '/hd/subcontractor')} className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-indigo-600">
          Quay lại danh sách
        </button>
      </div>
    );
  }

  return (
    <ContractWorkspace
      contract={contract}
      contractType={contractType}
      onBack={() => navigate(contractType === 'customer' ? '/hd/customer' : '/hd/subcontractor')}
    />
  );
};

export default ContractWorkspacePage;
