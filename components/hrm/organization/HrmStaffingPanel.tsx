import React, { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  BriefcaseBusiness,
  Calendar,
  Crown,
  PencilLine,
  Plus,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react';
import type {
  HrmEmployeeSlotAssignment,
  HrmOrgPositionSlot,
  HrmSharedEmployee,
  HrmSharedOrgUnit,
  HrmSharedPosition,
  HrmStaffingRow,
} from '../../../types/hrmSharedCatalog';
import { getHrmSlotOccupancy } from '../../../lib/hrmSharedCatalogModel';

export interface HrmStaffingPanelProps {
  unit: HrmSharedOrgUnit;
  rows: HrmStaffingRow[];
  positions: HrmSharedPosition[];
  assignments?: HrmEmployeeSlotAssignment[];
  employees?: HrmSharedEmployee[];
  canManage: boolean;
  onAdjust(row?: HrmStaffingRow): void;
  onAssign(row: HrmStaffingRow): void;
  onSetManager(row: HrmStaffingRow): void;
}

const Metric: React.FC<{ label: string; value: number; emphasis?: boolean }> = ({ label, value, emphasis }) => (
  <div className="min-w-0">
    <p className="text-[11px] font-bold text-slate-500">{label}</p>
    <p className={`mt-0.5 text-xl font-black tabular-nums ${emphasis ? 'text-indigo-700' : 'text-slate-800'}`}>{value}</p>
  </div>
);

const HrmStaffingPanel: React.FC<HrmStaffingPanelProps> = ({
  unit,
  rows,
  positions,
  assignments = [],
  employees = [],
  canManage,
  onAdjust,
  onAssign,
  onSetManager,
}) => {
  const [selectedOccupantsRow, setSelectedOccupantsRow] = useState<HrmStaffingRow | null>(null);
  const positionById = useMemo(() => new Map(positions.map(position => [position.id, position])), [positions]);
  const employeeById = useMemo(() => new Map(employees.map(emp => [emp.id, emp])), [employees]);

  const totals = rows.reduce((result, row) => ({
    planned: result.planned + row.plannedCount,
    occupied: result.occupied + row.occupiedCount,
    vacant: result.vacant + row.vacantCount,
  }), { planned: 0, occupied: 0, vacant: 0 });

  const getRowOccupants = (row: HrmStaffingRow) => {
    return row.slots
      .map(slot => {
        const occupancy = getHrmSlotOccupancy(slot.id, assignments);
        if (occupancy.status === 'OCCUPIED' && occupancy.assignment) {
          const emp = employeeById.get(occupancy.assignment.employeeId);
          return {
            slot,
            assignment: occupancy.assignment,
            employee: emp || null,
          };
        }
        return null;
      })
      .filter((item): item is { slot: HrmOrgPositionSlot; assignment: HrmEmployeeSlotAssignment; employee: HrmSharedEmployee | null } => Boolean(item));
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="Định biên và nhân sự">
      <header className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-indigo-600">Định biên &amp; nhân sự</p>
            <h2 className="mt-1 truncate text-xl font-black text-slate-900">{unit.name}</h2>
            <p className="mt-1 text-xs font-medium text-slate-500">
              Mỗi dòng là một vị trí nghiệp vụ. Hệ thống tự quản lý slot kỹ thuật phía sau.
            </p>
          </div>
          {canManage && rows.length > 0 && (
            <button
              type="button"
              onClick={() => onAdjust()}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-black text-white transition hover:bg-indigo-700 active:scale-[0.98]"
            >
              <Plus size={15} /> Thêm định biên
            </button>
          )}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 px-4 py-3">
          <Metric label="Định biên" value={totals.planned} />
          <Metric label="Đã bố trí" value={totals.occupied} emphasis />
          <Metric label="Còn trống" value={totals.vacant} />
        </div>
      </header>

      {!rows.length ? (
        <div className="flex flex-col items-center px-5 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <BriefcaseBusiness size={22} />
          </span>
          <h3 className="mt-4 text-base font-black text-slate-800">Chưa có định biên chính thức</h3>
          <p className="mt-1 max-w-sm text-sm font-medium text-slate-500">
            Chọn vị trí công việc và số lượng cần có cho đơn vị này.
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => onAdjust()}
              className="mt-5 inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-indigo-700 active:scale-[0.98]"
            >
              <Plus size={16} /> Thiết lập định biên đầu tiên
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[minmax(220px,1.6fr)_90px_110px_minmax(220px,1fr)] gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5 text-[11px] font-black text-slate-500">
              <span>Vị trí công việc</span>
              <span>Cấp bậc</span>
              <span>Đã bố trí</span>
              <span className="text-right">Thao tác</span>
            </div>
            <div>
              {rows.map(row => {
                const position = positionById.get(row.positionId);
                const hasOccupants = row.occupiedCount > 0;
                return (
                  <div
                    key={row.key}
                    className="grid grid-cols-[minmax(220px,1.6fr)_90px_110px_minmax(220px,1fr)] items-center gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-black text-slate-800">
                          {position?.name || 'Vị trí chưa xác định'}
                        </p>
                        {row.isManager && (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-800">
                            <Crown size={12} /> Quản lý trực tiếp
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        Định biên {row.plannedCount}, còn trống {row.vacantCount}
                      </p>
                    </div>
                    <span className="text-sm font-black text-indigo-700">{row.levelCode || position?.levelCode || 'Chưa đặt'}</span>
                    <div>
                      <button
                        type="button"
                        onClick={() => setSelectedOccupantsRow(row)}
                        title="Nhấp để xem danh sách nhân sự đã bố trí"
                        className={`group inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-sm font-black tabular-nums transition-all active:scale-95 ${
                          hasOccupants
                            ? 'border border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm hover:border-indigo-300 hover:bg-indigo-100'
                            : 'border border-transparent text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <UsersRound size={15} className={hasOccupants ? 'text-indigo-600 transition-transform group-hover:scale-110' : 'text-slate-400'} />
                        <span>{row.occupiedCount} / {row.plannedCount}</span>
                      </button>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {canManage && (
                        <>
                          <button
                            type="button"
                            onClick={() => onAdjust(row)}
                            className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                            title="Điều chỉnh định biên"
                          >
                            <PencilLine size={15} />
                          </button>
                          {!row.isManager && row.plannedCount === 1 && (
                            <button
                              type="button"
                              onClick={() => onSetManager(row)}
                              className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"
                              title="Đặt làm quản lý trực tiếp"
                            >
                              <Crown size={15} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onAssign(row)}
                            disabled={!hasOccupants && row.vacantCount === 0}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                          >
                            {hasOccupants ? <ArrowRightLeft size={14} /> : <UserPlus size={14} />}
                            {hasOccupants ? 'Chuyển vị trí' : 'Phân bổ nhân sự'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {selectedOccupantsRow && (
        <div
          className="fixed inset-0 z-[1210] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          onClick={() => setSelectedOccupantsRow(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                  <UsersRound size={20} />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-black text-slate-900">
                    {positionById.get(selectedOccupantsRow.positionId)?.name || 'Vị trí công việc'}
                  </h3>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">
                    {unit.name} · Đã bố trí {selectedOccupantsRow.occupiedCount}/{selectedOccupantsRow.plannedCount}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOccupantsRow(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                aria-label="Đóng"
              >
                <X size={18} />
              </button>
            </header>

            <div className="max-h-[60vh] space-y-3 overflow-y-auto p-5">
              {(() => {
                const occupants = getRowOccupants(selectedOccupantsRow);
                if (occupants.length === 0) {
                  return (
                    <div className="py-8 text-center">
                      <UsersRound size={32} className="mx-auto mb-2 text-slate-300" />
                      <p className="text-xs font-bold text-slate-500">Chưa có nhân sự nào được phân bổ</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Vị trí này hiện còn trống {selectedOccupantsRow.vacantCount} chỉ tiêu.
                      </p>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => {
                            const target = selectedOccupantsRow;
                            setSelectedOccupantsRow(null);
                            onAssign(target);
                          }}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-black text-white transition hover:bg-indigo-700 active:scale-95"
                        >
                          <UserPlus size={14} /> Phân bổ nhân sự ngay
                        </button>
                      )}
                    </div>
                  );
                }

                return occupants.map(({ employee, assignment, slot }) => {
                  const initials = (employee?.fullName || 'N S')
                    .split(' ')
                    .map(part => part[0])
                    .filter(Boolean)
                    .slice(-2)
                    .join('')
                    .toUpperCase();

                  return (
                    <div
                      key={slot.id}
                      className="flex items-center gap-3.5 rounded-2xl border border-slate-100 bg-slate-50/80 p-3.5 transition hover:border-indigo-100 hover:bg-indigo-50/30"
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-black text-white shadow-sm">
                        {employee?.avatarUrl ? (
                          <img src={employee.avatarUrl} alt={employee.fullName} className="h-full w-full object-cover" />
                        ) : (
                          <span>{initials}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-black text-slate-900">
                            {employee?.fullName || 'Nhân sự'}
                          </p>
                          {employee?.employeeCode && (
                            <span className="shrink-0 rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10px] font-black text-indigo-700">
                              {employee.employeeCode}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs font-medium text-slate-500">
                          {employee?.title || 'Nhân viên'}
                        </p>
                        {assignment?.effectiveFrom && (
                          <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-slate-400">
                            <Calendar size={11} />
                            Bắt đầu: {new Date(assignment.effectiveFrom).toLocaleDateString('vi-VN')}
                            {assignment.assignmentType === 'ACTING' && ' · Kiêm nhiệm'}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <footer className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-5 py-3.5">
              <span className="text-xs font-semibold text-slate-400">
                Đã bố trí: {selectedOccupantsRow.occupiedCount} / {selectedOccupantsRow.plannedCount}
              </span>
              <div className="flex items-center gap-2">
                {canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = selectedOccupantsRow;
                      setSelectedOccupantsRow(null);
                      onAssign(target);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-black text-white transition hover:bg-slate-800 active:scale-95"
                  >
                    <ArrowRightLeft size={13} />
                    {selectedOccupantsRow.occupiedCount > 0 ? 'Chuyển / Gỡ vị trí' : 'Phân bổ nhân sự'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedOccupantsRow(null)}
                  className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100"
                >
                  Đóng
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
};

export default HrmStaffingPanel;
