import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { usePermission } from '../../hooks/usePermission';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import { Award, CheckCircle, CircleAlert, DollarSign, Download, Layers, Search, Settings2, Users } from 'lucide-react';

type Salary3pTab = 'matrix' | 'assignments' | 'import' | 'mappings';

const fmtMoney = (value?: number | null) => `${Math.round(Number(value || 0)).toLocaleString('vi-VN')}đ`;

const REVIEW_LABELS: Record<string, string> = {
  approved: 'Đã duyệt',
  pending: 'Chờ duyệt',
  needs_review: 'Cần rà soát',
};

const REVIEW_CLASSES: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  pending: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  needs_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

const Salary3p: React.FC = () => {
  const {
    employees,
    hrmPositions,
    orgUnits,
    salaryGrades,
    hrmCompensationPlans,
    hrm3pBands,
    hrm3pGradeBandRates,
    hrmPositionSalaryMappings,
    hrmEmployeeCompensationAssignments,
    hrmPayrollComponents,
    hrmPayrollImportBatches,
    hrmPayrollImportRows,
    updateHrmItem,
  } = useApp();
  useModuleData('hrm');
  const { canManage } = usePermission();
  const canCRUD = canManage('/hrm/salary-3p') || canManage('/hrm/payroll');
  const [activeTab, setActiveTab] = useState<Salary3pTab>('matrix');
  const [searchText, setSearchText] = useState('');

  const activePlan = useMemo(
    () => hrmCompensationPlans.find(plan => plan.code === '3P_2026') || hrmCompensationPlans.find(plan => plan.status === 'active') || hrmCompensationPlans[0],
    [hrmCompensationPlans],
  );
  const planId = activePlan?.id;
  const planGrades = useMemo(
    () => salaryGrades.filter(grade => !planId || grade.planId === planId || /^E\d+$/.test(grade.code)).sort((a, b) => b.level - a.level),
    [planId, salaryGrades],
  );
  const planBands = useMemo(
    () => hrm3pBands.filter(band => !planId || band.planId === planId).sort((a, b) => a.sortOrder - b.sortOrder),
    [hrm3pBands, planId],
  );
  const gradeById = useMemo(() => new Map(salaryGrades.map(grade => [grade.id, grade])), [salaryGrades]);
  const bandById = useMemo(() => new Map(hrm3pBands.map(band => [band.id, band])), [hrm3pBands]);
  const employeeById = useMemo(() => new Map(employees.map(employee => [employee.id, employee])), [employees]);
  const positionById = useMemo(() => new Map(hrmPositions.map(position => [position.id, position])), [hrmPositions]);
  const orgUnitById = useMemo(() => new Map(orgUnits.map(unit => [unit.id, unit])), [orgUnits]);
  const rateMap = useMemo(() => {
    const map = new Map<string, number>();
    hrm3pGradeBandRates.forEach(rate => map.set(`${rate.salaryGradeId}:${rate.p3BandId}`, rate.p3StandardAmount));
    return map;
  }, [hrm3pGradeBandRates]);

  const filteredAssignments = useMemo(() => {
    return hrmEmployeeCompensationAssignments
      .filter(item => !planId || item.planId === planId)
      .filter(item => {
        const employee = employeeById.get(item.employeeId);
        const grade = gradeById.get(item.salaryGradeId);
        const band = bandById.get(item.p3BandId);
        return matchesSearchQueryMultiple([
          item.employeeCodeSnapshot,
          item.employeeNameSnapshot,
          employee?.employeeCode,
          employee?.fullName,
          grade?.code,
          band?.code,
        ], searchText);
      })
      .sort((a, b) => a.employeeCodeSnapshot.localeCompare(b.employeeCodeSnapshot));
  }, [bandById, employeeById, gradeById, hrmEmployeeCompensationAssignments, planId, searchText]);

  const currentBatch = useMemo(
    () => [...hrmPayrollImportBatches].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0],
    [hrmPayrollImportBatches],
  );
  const importRows = useMemo(
    () => hrmPayrollImportRows
      .filter(row => !currentBatch || row.batchId === currentBatch.id)
      .sort((a, b) => a.sourceRowNumber - b.sourceRowNumber),
    [currentBatch, hrmPayrollImportRows],
  );

  const stats = useMemo(() => {
    const needsReview = filteredAssignments.filter(item => item.reviewStatus === 'needs_review').length;
    const approved = filteredAssignments.filter(item => item.reviewStatus === 'approved').length;
    const importErrors = importRows.filter(row => row.validationStatus === 'error').length;
    return { assignments: filteredAssignments.length, needsReview, approved, importErrors };
  }, [filteredAssignments, importRows]);

  const updateAssignmentField = async (assignmentId: string, patch: Record<string, unknown>) => {
    const assignment = hrmEmployeeCompensationAssignments.find(item => item.id === assignmentId);
    if (!assignment) return;
    await updateHrmItem('hrm_employee_compensation_assignments', {
      ...assignment,
      ...patch,
      reviewStatus: patch.reviewStatus || 'needs_review',
      updatedAt: new Date().toISOString(),
    });
  };

  const exportImportIssues = () => {
    const rows = importRows
      .filter(row => row.validationStatus !== 'valid' || row.reviewStatus === 'needs_review')
      .map(row => {
        const payload = row.normalizedPayload || {};
        return [
          row.sourceRowNumber,
          payload.employee_code || '',
          payload.employee_name || '',
          row.validationStatus,
          row.reviewStatus,
          (row.warningMessages || []).join('; '),
          (row.errorMessages || []).join('; '),
        ];
      });
    const csv = [
      ['Dòng', 'Mã NV', 'Họ tên', 'Validation', 'Review', 'Cảnh báo', 'Lỗi'],
      ...rows,
    ].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'hrm_3p_import_review.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <Award className="text-emerald-500" size={24} /> Lương 3P
          </h1>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">
            {activePlan?.name || 'Chưa có compensation plan active'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              className="pl-8 pr-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none w-56"
              placeholder="Tìm mã, tên, grade..."
            />
          </div>
          <button onClick={exportImportIssues} className="px-3 py-2 rounded-lg text-xs font-black bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 flex items-center gap-1.5">
            <Download size={14} /> Export review
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Assignment', value: stats.assignments, icon: Users, color: 'text-sky-600' },
          { label: 'Đã duyệt', value: stats.approved, icon: CheckCircle, color: 'text-emerald-600' },
          { label: 'Cần rà soát', value: stats.needsReview, icon: CircleAlert, color: 'text-amber-600' },
          { label: 'Import lỗi', value: stats.importErrors, icon: CircleAlert, color: 'text-red-600' },
        ].map(item => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="glass-card p-4 rounded-xl">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{item.label}</p>
                <Icon size={16} className={item.color} />
              </div>
              <p className={`text-2xl font-black mt-2 ${item.color}`}>{item.value}</p>
            </div>
          );
        })}
      </div>

      <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden w-fit">
        {[
          { key: 'matrix', label: 'Ma trận', icon: Layers },
          { key: 'assignments', label: 'Assignment', icon: Users },
          { key: 'import', label: 'Import review', icon: CircleAlert },
          { key: 'mappings', label: 'Mapping VTCV', icon: Settings2 },
        ].map(tab => {
          const Icon = tab.icon;
          const selected = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as Salary3pTab)}
              className={`px-3 py-2 text-xs font-black flex items-center gap-1.5 transition ${selected ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              <Icon size={14} /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'matrix' && (
        <div className="glass-panel rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-purple-600 dark:bg-purple-900/80 text-white">
                <tr>
                  <th className="px-3 py-3 text-left font-black text-white dark:text-purple-100 uppercase">Grade</th>
                  <th className="px-3 py-3 text-right font-black text-white dark:text-purple-100 uppercase whitespace-nowrap">P1</th>
                  {planBands.map(band => (
                    <th key={band.id} className="px-3 py-3 text-right font-black text-white dark:text-purple-100 uppercase whitespace-nowrap">
                      {band.code}
                      <div className="text-[9px] font-bold text-purple-200 dark:text-purple-300">{band.kpiPayMultiplier.toFixed(2)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {planGrades.map(grade => (
                  <tr key={grade.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-black text-slate-700 dark:text-slate-100">
                      {grade.code}
                      <div className="text-[10px] font-semibold text-slate-400 max-w-52 truncate">{grade.groupName}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-black text-blue-600 whitespace-nowrap">{fmtMoney(grade.p1SalaryAmount)}</td>
                    {planBands.map(band => (
                      <td key={band.id} className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {fmtMoney(rateMap.get(`${grade.id}:${band.id}`))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'assignments' && (
        <div className="glass-panel rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-purple-600 dark:bg-purple-900/80 text-white">
                <tr>
                  <th className="px-3 py-3 text-left font-black text-white dark:text-purple-100 uppercase">Nhân sự</th>
                  <th className="px-3 py-3 text-left font-black text-white dark:text-purple-100 uppercase">Vị trí</th>
                  <th className="px-3 py-3 text-center font-black text-white dark:text-purple-100 uppercase">Grade</th>
                  <th className="px-3 py-3 text-center font-black text-white dark:text-purple-100 uppercase">P3</th>
                  <th className="px-3 py-3 text-center font-black text-white dark:text-purple-100 uppercase">Review</th>
                  <th className="px-3 py-3 text-left font-black text-white dark:text-purple-100 uppercase">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssignments.map(assignment => {
                  const employee = employeeById.get(assignment.employeeId);
                  const position = assignment.positionId ? positionById.get(assignment.positionId) : undefined;
                  const orgUnit = assignment.orgUnitId ? orgUnitById.get(assignment.orgUnitId) : undefined;
                  return (
                    <tr key={assignment.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2">
                        <div className="font-black text-slate-800 dark:text-white">{employee?.fullName || assignment.employeeNameSnapshot}</div>
                        <div className="font-mono text-[10px] text-slate-400">{employee?.employeeCode || assignment.employeeCodeSnapshot}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-bold text-slate-600 dark:text-slate-300">{position?.name || '-'}</div>
                        <div className="text-[10px] text-slate-400">{orgUnit?.code || ''} {orgUnit?.name || ''}</div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {canCRUD ? (
                          <select value={assignment.salaryGradeId} onChange={event => updateAssignmentField(assignment.id, { salaryGradeId: event.target.value })} className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-black">
                            {planGrades.map(grade => <option key={grade.id} value={grade.id}>{grade.code}</option>)}
                          </select>
                        ) : <span className="font-black">{gradeById.get(assignment.salaryGradeId)?.code}</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {canCRUD ? (
                          <select value={assignment.p3BandId} onChange={event => updateAssignmentField(assignment.id, { p3BandId: event.target.value })} className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-black">
                            {planBands.map(band => <option key={band.id} value={band.id}>{band.code}</option>)}
                          </select>
                        ) : <span className="font-black">{bandById.get(assignment.p3BandId)?.code}</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          disabled={!canCRUD || assignment.reviewStatus === 'approved'}
                          onClick={() => updateAssignmentField(assignment.id, { reviewStatus: 'approved', reviewNote: assignment.reviewNote || 'HR approved in 3P manager' })}
                          className={`px-2 py-1 rounded-lg font-black ${REVIEW_CLASSES[assignment.reviewStatus] || REVIEW_CLASSES.pending} disabled:cursor-default`}
                        >
                          {REVIEW_LABELS[assignment.reviewStatus] || assignment.reviewStatus}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{assignment.reviewNote || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'import' && (
        <div className="glass-panel rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-slate-800 dark:text-white">{currentBatch?.sourceFileName || 'Chưa có batch import'}</p>
              <p className="text-[10px] text-slate-400 font-mono">{currentBatch?.sourceFileHash}</p>
            </div>
            <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[10px] font-black text-slate-500">{currentBatch?.status || '-'}</span>
          </div>
          <div className="overflow-x-auto max-h-[620px]">
            <table className="w-full text-xs">
              <thead className="bg-purple-600 dark:bg-purple-900/80 text-white sticky top-0">
                <tr>
                  <th className="px-3 py-3 text-left font-black text-white dark:text-purple-100 uppercase">Dòng</th>
                  <th className="px-3 py-3 text-left font-black text-white dark:text-purple-100 uppercase">Nhân sự</th>
                  <th className="px-3 py-3 text-left font-black text-white dark:text-purple-100 uppercase">Grade/P3</th>
                  <th className="px-3 py-3 text-left font-black text-white dark:text-purple-100 uppercase">Trạng thái</th>
                  <th className="px-3 py-3 text-left font-black text-white dark:text-purple-100 uppercase">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {importRows.map(row => {
                  const payload = row.normalizedPayload || {};
                  const notes = [...(row.errorMessages || []), ...(row.warningMessages || [])];
                  return (
                    <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 font-mono text-slate-400">{row.sourceRowNumber}</td>
                      <td className="px-3 py-2">
                        <div className="font-black text-slate-800 dark:text-white">{String(payload.employee_name || '')}</div>
                        <div className="font-mono text-[10px] text-slate-400">{String(payload.employee_code || '')}</div>
                      </td>
                      <td className="px-3 py-2 font-black text-slate-700 dark:text-slate-200">
                        {String(payload.grade_code || '-')} / {String(payload.p3_band_code || '-')}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-1 rounded-lg font-black ${row.validationStatus === 'error' ? 'bg-red-100 text-red-700' : row.validationStatus === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {row.validationStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500 max-w-xl">{notes.join('; ') || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'mappings' && (
        <div className="glass-panel rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-purple-600 dark:bg-purple-900/80 text-white">
                <tr>
                  <th className="px-3 py-3 text-left font-black text-white dark:text-purple-100 uppercase">Vị trí</th>
                  <th className="px-3 py-3 text-left font-black text-white dark:text-purple-100 uppercase">Org context</th>
                  <th className="px-3 py-3 text-center font-black text-white dark:text-purple-100 uppercase">Grade</th>
                  <th className="px-3 py-3 text-center font-black text-white dark:text-purple-100 uppercase">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {hrmPositionSalaryMappings
                  .filter(mapping => !planId || mapping.planId === planId)
                  .sort((a, b) => (positionById.get(a.positionId)?.sortOrder || 0) - (positionById.get(b.positionId)?.sortOrder || 0))
                  .map(mapping => {
                    const position = positionById.get(mapping.positionId);
                    const grade = gradeById.get(mapping.salaryGradeId);
                    return (
                      <tr key={mapping.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-2">
                          <div className="font-black text-slate-800 dark:text-white">{position?.name || mapping.positionCodeSnapshot}</div>
                          <div className="font-mono text-[10px] text-slate-400">{position?.code || mapping.positionCodeSnapshot}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-500">{mapping.orgUnitCodeSnapshot || position?.suggestedOrgUnitCode || '-'}</td>
                        <td className="px-3 py-2 text-center font-black text-blue-600">{grade?.code || '-'}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-black">{mapping.confidence}</span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'matrix' && hrmPayrollComponents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
          {hrmPayrollComponents
            .filter(component => !planId || component.planId === planId)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(component => (
              <div key={component.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-white/70 dark:bg-slate-900/60">
                <div className="flex items-center gap-2">
                  <DollarSign size={14} className="text-emerald-500" />
                  <span className="text-[10px] font-black text-slate-400">{component.code}</span>
                </div>
                <p className="text-xs font-black text-slate-700 dark:text-slate-200 mt-1">{component.name}</p>
                <p className="text-[10px] text-slate-400 truncate">{component.formulaKey || component.componentType}</p>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default Salary3p;
