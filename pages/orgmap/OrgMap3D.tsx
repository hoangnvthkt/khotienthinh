import React, { useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useOrgMapStore } from '../../components/orgmap/useOrgMapStore';
import Scene3D from '../../components/orgmap/Scene3D';
import RoomScene from '../../components/orgmap/RoomScene';
import OrgSidebar from '../../components/orgmap/OrgSidebar';
import EmployeePopup from '../../components/orgmap/EmployeePopup';
import {
  Globe, ChevronLeft, Home,
} from 'lucide-react';

const CAMERA_LABELS: Record<string, string> = {
  overview: 'Toàn cảnh',
  hq: 'Văn phòng trụ sở',
  floor: 'Chi tiết tầng',
};

const OrgMap3D: React.FC = () => {
  const { orgUnits, employees } = useApp();
  const {
    cameraMode, setCameraMode,
    selectedEmployee, setSelectedEmployee,
    selectedUnit, setSelectedUnit,
    setRoomWorldPos,
    activeRoomId, setActiveRoomId,
  } = useOrgMapStore();

  /* ── ESC: close popup or go up a camera level ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeRoomId) { setActiveRoomId(null); return; }
      if (selectedEmployee) { setSelectedEmployee(null); return; }
      if (typeof cameraMode === 'object' && cameraMode.type === 'branch') { setCameraMode('overview'); return; }
      if (cameraMode === 'hq') { setCameraMode('overview'); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cameraMode, selectedEmployee, activeRoomId, setCameraMode, setSelectedEmployee, setActiveRoomId]);

  const rootUnit = orgUnits.find(u => !u.parentId && u.type === 'company');

  const hqUnit = orgUnits.reduce<any>((best, u) => {
    if (u.type === 'company') return best;
    const c = orgUnits.filter(x => x.parentId === u.id).length;
    if (c < 2) return best;
    const bc = best ? orgUnits.filter(x => x.parentId === best.id).length : 0;
    return c > bc ? u : best;
  }, null);

  /* ── If a room is active → show dedicated RoomScene ── */
  if (activeRoomId) {
    const room = orgUnits.find(u => u.id === activeRoomId);
    if (room) {
      const roomEmployees = employees.filter(e => e.orgUnitId === room.id);
      return (
        <div
          className="relative w-full"
          style={{ height: 'calc(100vh - 80px)', minHeight: 500, overflow: 'hidden', borderRadius: 16 }}
        >
          <RoomScene
            room={room}
            employees={roomEmployees}
            onBack={() => {
              setActiveRoomId(null);
              // Return camera to hq view in the building scene
              setCameraMode('hq');
              setSelectedUnit(hqUnit ?? null);
              setRoomWorldPos(null);
            }}
          />

          {/* Employee popup still works inside room */}
          {selectedEmployee && (
            <EmployeePopup
              employee={selectedEmployee}
              orgUnits={orgUnits}
              onClose={() => setSelectedEmployee(null)}
            />
          )}
        </div>
      );
    }
  }

  /* ── Default: building scene ── */
  const cameraModeLabel = typeof cameraMode === 'string'
    ? CAMERA_LABELS[cameraMode] ?? cameraMode
    : cameraMode.type === 'branch'
      ? orgUnits.find(u => u.id === (cameraMode as any).unitId)?.name ?? 'Chi nhánh'
      : selectedUnit?.name ?? 'Chi tiết phòng';

  return (
    <div className="relative w-full" style={{ height: 'calc(100vh - 80px)', minHeight: 500, overflow: 'hidden', borderRadius: 16 }}>

      {/* 3D Building Canvas */}
      <Scene3D orgUnits={orgUnits} employees={employees} />

      {/* Top bar overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(5,10,20,0.9) 0%, transparent 100%)' }}>

        {/* Left: title + breadcrumb */}
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
            style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)' }}>
            <Globe size={16} className="text-indigo-400" />
            <span className="text-sm font-black text-white">Sơ đồ 3D</span>
          </div>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <button
              onClick={() => { setCameraMode('overview'); setSelectedUnit(null); setRoomWorldPos(null); }}
              className="hover:text-white transition-colors flex items-center gap-1"
            >
              <Home size={11} />
              {rootUnit?.name ?? 'Tổng công ty'}
            </button>
            {(cameraMode === 'hq' || typeof cameraMode === 'object') && (
              <>
                <span className="text-slate-600">/</span>
                <button
                  onClick={() => { setCameraMode('hq'); setSelectedUnit(null); setRoomWorldPos(null); }}
                  className="hover:text-white transition-colors"
                >
                  {hqUnit?.name ?? 'Trụ sở chính'}
                </button>
              </>
            )}
            {typeof cameraMode === 'object' && cameraMode.type === 'branch' && (
              <>
                <span className="text-slate-600">/</span>
                <span className="text-orange-400 font-semibold">{cameraModeLabel}</span>
              </>
            )}
          </div>
        </div>

        {/* Right: controls hint */}
        <div className="flex items-center gap-2 text-[10px] text-slate-500 pointer-events-none">
          <span>🖱 Xoay</span>
          <span>⚲ Zoom</span>
          <span>ESC Quay lại</span>
        </div>
      </div>

      {/* Back button */}
      {cameraMode !== 'overview' && (
        <button
          onClick={() => { setCameraMode('overview'); setSelectedUnit(null); setRoomWorldPos(null); }}
          className="absolute top-14 left-4 z-10 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:scale-105"
          style={{ background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.4)', backdropFilter: 'blur(8px)' }}
        >
          <ChevronLeft size={16} /> Quay lại
        </button>
      )}

      {/* Stats chips */}
      <div className="absolute bottom-4 left-4 z-10 flex flex-wrap gap-2">
        {[
          { label: 'Đơn vị', value: orgUnits.length, color: '#6366f1' },
          { label: 'Nhân viên', value: employees.filter(e => e.status === 'Đang làm việc').length, color: '#10b981' },
          { label: 'Chi nhánh', value: orgUnits.filter(u => u.type !== 'company' && !orgUnits.some(c => c.parentId === u.id)).length, color: '#f97316' },
        ].map(chip => (
          <div
            key={chip.label}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white"
            style={{ background: `${chip.color}22`, border: `1px solid ${chip.color}44`, backdropFilter: 'blur(8px)' }}
          >
            <span style={{ color: chip.color }}>{chip.value}</span>
            <span className="text-slate-400">{chip.label}</span>
          </div>
        ))}
      </div>

      {/* Sidebar */}
      <OrgSidebar orgUnits={orgUnits} employees={employees} />

      {/* Employee popup */}
      {selectedEmployee && (
        <EmployeePopup
          employee={selectedEmployee}
          orgUnits={orgUnits}
          onClose={() => setSelectedEmployee(null)}
        />
      )}
    </div>
  );
};

export default OrgMap3D;
