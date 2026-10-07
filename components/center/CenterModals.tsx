import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { RequestCreateDialog } from '../request/RequestCreateDialog';
import LeaveCreateDialog from '../hrm/LeaveCreateDialog';
import { StateBox } from '../procurement/hub/hubUi';
import { leaveService, type LeaveSettings, type LeaveTypeOption } from '../../lib/leaveService';
import type { CenterModal } from '../../lib/center/centerActions';

// Form thật của module mở ngay trên Trung tâm điều hành (tải lười). Gửi bằng RPC sẵn có của module.

const Frame: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div className="w-full max-w-md rounded-3xl bg-card p-5 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-black text-foreground">{title}</h3>
        <button type="button" onClick={onClose} className="rounded-xl p-1.5 hover:bg-muted" aria-label="Đóng"><X size={18} /></button>
      </div>
      {children}
    </div>
  </div>
);

const LeaveModal: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const { employees, user } = useApp();
  useModuleData('hrm');
  const me = useMemo(() => employees.find(employee => employee.userId === user.id && employee.status === 'Đang làm việc'), [employees, user.id]);
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; types: LeaveTypeOption[]; settings: LeaveSettings | null }>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    Promise.all([leaveService.listTypes(), leaveService.getSettings()])
      .then(([types, settings]) => { if (alive) setState({ status: 'ready', types: types.filter(type => type.isActive), settings }); })
      .catch(error => { if (alive) setState({ status: 'error', message: error instanceof Error ? error.message : 'Không tải được loại đơn.' }); });
    return () => { alive = false; };
  }, [attempt]);

  if (state.status === 'loading') return <Frame title="Xin nghỉ phép" onClose={onClose}><StateBox kind="loading" title="Đang mở form…" /></Frame>;
  if (state.status === 'error') return <Frame title="Xin nghỉ phép" onClose={onClose}><StateBox kind="error" message={state.message} onRetry={() => setAttempt(value => value + 1)} /></Frame>;
  if (!me) {
    return (
      <Frame title="Xin nghỉ phép" onClose={onClose}>
        <StateBox kind="denied" title="Tài khoản chưa gắn với hồ sơ nhân viên" message="Nhờ HR gắn hồ sơ để gửi đơn nghỉ phép." />
      </Frame>
    );
  }
  return (
    <LeaveCreateDialog
      employeeId={me.id}
      types={state.types}
      settings={state.settings}
      onClose={onClose}
      onSubmitted={async () => { onDone(); onClose(); }}
    />
  );
};

const CenterModalHost: React.FC<{ modal: CenterModal; onClose: () => void; onDone: () => void }> = ({ modal, onClose, onDone }) => {
  if (modal === 'request') return <RequestCreateDialog isOpen onClose={onClose} />;
  return <LeaveModal onClose={onClose} onDone={onDone} />;
};

export default CenterModalHost;
