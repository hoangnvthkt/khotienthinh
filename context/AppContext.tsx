
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  InventoryItem, Transaction, User, Warehouse, Supplier,
  Role, TransactionStatus, TransactionType, MaterialRequest,
  RequestStatus, AuditLog, GlobalActivity, ActivityType,
  ItemCategory, ItemUnit, Employee, MaterialLossNorm, AuditSession,
  HrmArea, HrmOffice, HrmEmployeeType, HrmPosition, HrmSalaryPolicy, HrmWorkSchedule, HrmConstructionSite,
  OrgUnit, ProjectFinance, ProjectTransaction,
  Asset, AssetCategory, AssetAssignment, AssetMaintenance, AssetStatus,
  AttendanceRecord, LeaveRequest, PayrollRecord, LaborContract, LeaveBalance, PayrollTemplate, HrmHoliday, HrmSalaryHistory,
  BudgetCategory, BudgetEntry, ExpenseRecord, AttendanceProposal, LeaveLog, LeaveApprover
} from '../types';
import {
  MOCK_USERS, MOCK_WAREHOUSES, MOCK_ITEMS,
  MOCK_SUPPLIERS, MOCK_TRANSACTIONS
} from '../constants';

interface AppSettings {
  name: string;
  logo: string;
}

interface AppContextType {
  user: User;
  users: User[];
  appSettings: AppSettings;
  setUser: (user: User) => void;
  switchUser: (user: User) => void;
  login: (username: string, password: string) => Promise<User | null>;
  logout: () => void;
  addUser: (user: User) => void;
  updateUser: (user: User) => void;
  removeUser: (userId: string) => void;
  items: InventoryItem[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  transactions: Transaction[];
  requests: MaterialRequest[];
  activities: GlobalActivity[];
  categories: ItemCategory[];
  units: ItemUnit[];
  employees: Employee[];
  // HRM Master Data
  hrmAreas: HrmArea[];
  hrmOffices: HrmOffice[];
  hrmEmployeeTypes: HrmEmployeeType[];
  hrmPositions: HrmPosition[];
  hrmSalaryPolicies: HrmSalaryPolicy[];
  hrmWorkSchedules: HrmWorkSchedule[];
  hrmConstructionSites: HrmConstructionSite[];
  addHrmItem: (table: string, item: any) => void;
  updateHrmItem: (table: string, item: any) => void;
  removeHrmItem: (table: string, id: string) => void;
  // HRM 5A — Chấm công & Lương
  attendanceRecords: AttendanceRecord[];
  leaveRequests: LeaveRequest[];
  leaveLogs: LeaveLog[];
  approveLeave: (id: string, userId: string, comment?: string) => void;
  rejectLeave: (id: string, userId: string, comment?: string, reason?: string) => void;
  addLeaveLog: (log: Omit<LeaveLog, 'id' | 'createdAt'>) => void;
  leaveBalances: LeaveBalance[];
  payrollRecords: PayrollRecord[];
  payrollTemplates: PayrollTemplate[];
  holidays: HrmHoliday[];
  salaryHistory: HrmSalaryHistory[];
  attendanceProposals: AttendanceProposal[];
  // Budget
  budgetCategories: BudgetCategory[];
  budgetEntries: BudgetEntry[];
  expenseRecords: ExpenseRecord[];
  laborContracts: LaborContract[];
  // Org Chart
  orgUnits: OrgUnit[];
  addOrgUnit: (unit: OrgUnit) => void;
  updateOrgUnit: (unit: OrgUnit) => void;
  removeOrgUnit: (id: string) => void;
  addItem: (item: InventoryItem) => void;
  addItems: (items: InventoryItem[]) => void;
  updateItem: (item: InventoryItem) => void;
  removeItem: (itemId: string) => void;
  addTransaction: (transaction: Transaction) => void;
  updateTransactionStatus: (id: string, status: TransactionStatus, approverId?: string) => void;
  clearTransactionHistory: () => void;
  addWarehouse: (warehouse: Warehouse) => void;
  updateWarehouse: (warehouse: Warehouse) => void;
  removeWarehouse: (warehouseId: string) => void;
  addRequest: (request: MaterialRequest) => void;
  updateRequestStatus: (id: string, status: RequestStatus, note?: string, approvedItems?: { itemId: string, qty: number }[], sourceWarehouseId?: string) => void;
  logActivity: (type: ActivityType, action: string, description: string, status?: GlobalActivity['status'], warehouseId?: string) => void;
  addCategory: (name: string) => void;
  updateCategory: (category: ItemCategory) => void;
  removeCategory: (id: string) => void;
  addUnit: (name: string) => void;
  updateUnit: (unit: ItemUnit) => void;
  removeUnit: (id: string) => void;
  addSupplier: (supplier: Supplier) => void;
  updateSupplier: (supplier: Supplier) => void;
  removeSupplier: (id: string) => void;
  addEmployee: (employee: Employee) => void;
  updateEmployee: (employee: Employee) => void;
  removeEmployee: (id: string) => void;
  updateAppSettings: (settings: AppSettings) => void;
  approvePartialTransaction: (id: string, selectedItemIds: string[], approverId: string) => void;
  clearAllData: () => void;
  // Digital Signature
  saveSignature: (userId: string, dataUrl: string) => Promise<boolean>;
  deleteSignature: (userId: string) => Promise<boolean>;
  // Loss Management
  lossNorms: MaterialLossNorm[];
  addLossNorm: (norm: MaterialLossNorm) => void;
  updateLossNorm: (norm: MaterialLossNorm) => void;
  removeLossNorm: (id: string) => void;
  // Audit Sessions
  auditSessions: AuditSession[];
  addAuditSession: (session: AuditSession) => void;
  // Project Finances (DA)
  projectFinances: ProjectFinance[];
  addProjectFinance: (pf: ProjectFinance) => void;
  updateProjectFinance: (pf: ProjectFinance) => void;
  removeProjectFinance: (id: string) => void;
  // Project Transactions
  projectTransactions: ProjectTransaction[];
  addProjectTransaction: (tx: ProjectTransaction) => void;
  addProjectTransactions: (txs: ProjectTransaction[]) => void;
  updateProjectTransaction: (tx: ProjectTransaction) => void;
  removeProjectTransaction: (id: string) => void;
  // Assets (TS)
  assets: Asset[];
  assetCategories: AssetCategory[];
  assetAssignments: AssetAssignment[];
  assetMaintenances: AssetMaintenance[];
  addAsset: (asset: Asset) => void;
  updateAsset: (asset: Asset) => void;
  removeAsset: (id: string) => void;
  addAssetCategory: (cat: AssetCategory) => void;
  updateAssetCategory: (cat: AssetCategory) => void;
  removeAssetCategory: (id: string) => void;
  addAssetAssignment: (a: AssetAssignment) => void;
  addAssetMaintenance: (m: AssetMaintenance) => void;
  updateAssetMaintenance: (m: AssetMaintenance) => void;
  isModuleAdmin: (moduleKey: string) => boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  connectionError: string | null;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User>(() => {
    const saved = localStorage.getItem('khoviet_user');
    return saved ? JSON.parse(saved) : MOCK_USERS[0];
  });
  const [users, setUsers] = useState<User[]>(MOCK_USERS);
  const [appSettings, setAppSettings] = useState<AppSettings>({ name: 'KhoViet', logo: '' });
  const [items, setItems] = useState<InventoryItem[]>(MOCK_ITEMS);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(MOCK_WAREHOUSES);
  const [suppliers, setSuppliers] = useState<Supplier[]>(MOCK_SUPPLIERS);
  const [transactions, setTransactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [activities, setActivities] = useState<GlobalActivity[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  // HRM Master Data states
  const [hrmAreas, setHrmAreas] = useState<HrmArea[]>([]);
  const [hrmOffices, setHrmOffices] = useState<HrmOffice[]>([]);
  const [hrmEmployeeTypes, setHrmEmployeeTypes] = useState<HrmEmployeeType[]>([]);
  const [hrmPositions, setHrmPositions] = useState<HrmPosition[]>([]);
  const [hrmSalaryPolicies, setHrmSalaryPolicies] = useState<HrmSalaryPolicy[]>([]);
  const [hrmWorkSchedules, setHrmWorkSchedules] = useState<HrmWorkSchedule[]>([]);
  const [hrmConstructionSites, setHrmConstructionSites] = useState<HrmConstructionSite[]>([]);
  // HRM 5A
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveLogs, setLeaveLogs] = useState<LeaveLog[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [payrollTemplates, setPayrollTemplates] = useState<PayrollTemplate[]>([]);
  const [holidays, setHolidays] = useState<HrmHoliday[]>([]);
  const [salaryHistory, setSalaryHistory] = useState<HrmSalaryHistory[]>([]);
  const [attendanceProposals, setAttendanceProposals] = useState<AttendanceProposal[]>([]);
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([]);
  const [budgetEntries, setBudgetEntries] = useState<BudgetEntry[]>([]);
  const [expenseRecords, setExpenseRecords] = useState<ExpenseRecord[]>([]);
  const [laborContracts, setLaborContracts] = useState<LaborContract[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [lossNorms, setLossNorms] = useState<MaterialLossNorm[]>([]);
  const [auditSessions, setAuditSessions] = useState<AuditSession[]>([]);
  const [projectFinances, setProjectFinances] = useState<ProjectFinance[]>([]);
  const [projectTransactions, setProjectTransactions] = useState<ProjectTransaction[]>([]);
  // Asset Management
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetCategories, setAssetCategories] = useState<AssetCategory[]>([
    { id: 'ac1', name: 'Máy xúc', type: 'machinery', depreciationYears: 8 },
    { id: 'ac2', name: 'Máy khoan', type: 'equipment', depreciationYears: 5 },
    { id: 'ac3', name: 'Xe tải', type: 'vehicle', depreciationYears: 10 },
    { id: 'ac4', name: 'Máy tính', type: 'it', depreciationYears: 3 },
    { id: 'ac5', name: 'Bàn ghế VP', type: 'furniture', depreciationYears: 5 },
  ]);
  const [assetAssignments, setAssetAssignments] = useState<AssetAssignment[]>([]);
  const [assetMaintenances, setAssetMaintenances] = useState<AssetMaintenance[]>([]);
  const [categories, setCategories] = useState<ItemCategory[]>([
    { id: 'cat1', name: 'Vật liệu xây dựng' },
    { id: 'cat2', name: 'Công cụ dụng cụ' },
    { id: 'cat3', name: 'Bảo hộ lao động' }
  ]);
  const [units, setUnits] = useState<ItemUnit[]>([
    { id: 'u1', name: 'kg' },
    { id: 'u2', name: 'Bao (50kg)' },
    { id: 'u3', name: 'Cái' },
    { id: 'u4', name: 'Mét' }
  ]);

  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Load data from Supabase on mount
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setIsLoading(true);

        const fetchTable = async (table: string, query: any = supabase.from(table).select('*')) => {
          try {
            const { data, error } = await query;
            if (error) {
              console.warn(`Error fetching ${table}:`, error.message);
              return null;
            }
            return data;
          } catch (e) {
            console.warn(`Exception fetching ${table}:`, e);
            return null;
          }
        };

        const [
          itemsData, whData, supData, txData, reqData, actData, catData, unitData, settingsData, usersData, empData,
          areasData, officesData, empTypesData, positionsData, salaryData, schedulesData, constructionSitesData, orgUnitsData,
          lossNormsData, auditSessionsData, projectFinancesData, projectTxData
        ] = await Promise.all([
          fetchTable('items'),
          fetchTable('warehouses'),
          fetchTable('suppliers'),
          fetchTable('transactions', supabase.from('transactions').select('*').order('date', { ascending: false })),
          fetchTable('requests', supabase.from('requests').select('*').order('created_date', { ascending: false })),
          fetchTable('activities', supabase.from('activities').select('*').order('timestamp', { ascending: false }).limit(50)),
          fetchTable('categories'),
          fetchTable('units'),
          fetchTable('app_settings', supabase.from('app_settings').select('*').maybeSingle()),
          fetchTable('users'),
          fetchTable('employees'),
          fetchTable('hrm_areas'),
          fetchTable('hrm_offices'),
          fetchTable('hrm_employee_types'),
          fetchTable('hrm_positions'),
          fetchTable('hrm_salary_policies'),
          fetchTable('hrm_work_schedules'),
          fetchTable('hrm_construction_sites'),
          fetchTable('org_units'),
          fetchTable('loss_norms'),
          fetchTable('audit_sessions', supabase.from('audit_sessions').select('*').order('date', { ascending: false })),
          fetchTable('project_finances'),
          fetchTable('project_transactions', supabase.from('project_transactions').select('*').order('date', { ascending: false }))
        ]);

        if (usersData && usersData.length > 0) {
          const mappedUsers = usersData.map((u: any) => ({ ...u, assignedWarehouseId: u.assigned_warehouse_id, allowedModules: u.allowed_modules || undefined, adminModules: u.admin_modules || undefined }));
          // Fetch signatures and merge
          const { data: sigData } = await supabase.from('user_signatures').select('*');
          if (sigData && sigData.length > 0) {
            const sigMap = new Map<string, string>();
            for (const sig of sigData) {
              const { data: urlData } = supabase.storage.from('workflow-templates').getPublicUrl(sig.image_path);
              if (urlData?.publicUrl) sigMap.set(sig.user_id, urlData.publicUrl);
            }
            mappedUsers.forEach((u: any) => { if (sigMap.has(u.id)) u.signatureUrl = sigMap.get(u.id); });
          }
          setUsers(mappedUsers);
          const currentInList = mappedUsers.find((u: any) => u.email === user.email);
          if (currentInList) setUser(currentInList);
        }

        if (empData) {
          setEmployees(empData.map((e: any) => ({
            id: e.id,
            employeeCode: e.employee_code,
            fullName: e.full_name,
            title: e.title,
            gender: e.gender,
            phone: e.phone,
            email: e.email,
            dateOfBirth: e.date_of_birth,
            startDate: e.start_date,
            officialDate: e.official_date,
            status: e.status,
            userId: e.user_id,
            areaId: e.area_id,
            officeId: e.office_id,
            employeeTypeId: e.employee_type_id,
            positionId: e.position_id,
            salaryPolicyId: e.salary_policy_id,
            workScheduleId: e.work_schedule_id,
            constructionSiteId: e.construction_site_id,
            departmentId: e.department_id,
            factoryId: e.factory_id,
            maritalStatus: e.marital_status,
            createdAt: e.created_at,
            updatedAt: e.updated_at
          })));
        }

        if (itemsData) setItems(itemsData.map((i: any) => ({
          ...i, priceIn: i.price_in, priceOut: i.price_out, minStock: i.min_stock,
          supplierId: i.supplier_id, imageUrl: i.image_url, stockByWarehouse: i.stock_by_warehouse,
          purchaseUnit: i.purchase_unit ?? undefined
        })));

        if (whData && whData.length > 0) setWarehouses(whData.map((w: any) => ({ ...w, isArchived: w.is_archived })));
        if (supData) setSuppliers(supData.map((s: any) => ({ ...s, contactPerson: s.contact_person })));

        if (txData) setTransactions(txData.map((t: any) => ({
          ...t, sourceWarehouseId: t.source_warehouse_id, targetWarehouseId: t.target_warehouse_id, supplierId: t.supplier_id, requesterId: t.requester_id, approverId: t.approver_id, relatedRequestId: t.related_request_id, pendingItems: t.pending_items
        })));

        if (reqData) setRequests(reqData.map((r: any) => ({
          ...r, siteWarehouseId: r.site_warehouse_id, sourceWarehouseId: r.source_warehouse_id, requesterId: r.requester_id, createdDate: r.created_date, expectedDate: r.expected_date
        })));

        if (actData) setActivities(actData.map((a: any) => ({
          ...a, userId: a.user_id, userName: a.user_name, userAvatar: a.user_avatar, warehouseId: a.warehouse_id
        })));

        if (catData && catData.length > 0) setCategories(catData);
        if (unitData && unitData.length > 0) setUnits(unitData);
        if (settingsData) setAppSettings(settingsData);

        // HRM Master Data
        if (areasData) setHrmAreas(areasData);
        if (officesData) setHrmOffices(officesData);
        if (empTypesData) setHrmEmployeeTypes(empTypesData);
        if (positionsData) setHrmPositions(positionsData);
        if (salaryData) setHrmSalaryPolicies(salaryData);
        if (schedulesData) setHrmWorkSchedules(schedulesData);
        if (constructionSitesData) setHrmConstructionSites(constructionSitesData);

        // Org Units
        if (orgUnitsData) setOrgUnits(orgUnitsData.map((u: any) => ({
          id: u.id, name: u.name, type: u.type, customTypeLabel: u.customTypeLabel || undefined,
          parentId: u.parent_id, description: u.description, orderIndex: u.order_index, createdAt: u.created_at
        })));

        // Loss Norms
        if (lossNormsData) setLossNorms(lossNormsData.map((n: any) => ({
          id: n.id, itemId: n.item_id, categoryId: n.category_id, lossType: n.loss_type,
          allowedPercentage: n.allowed_percentage, period: n.period,
          createdBy: n.created_by, createdAt: n.created_at
        })));

        // Audit Sessions
        if (auditSessionsData) setAuditSessions(auditSessionsData);

        // Project Finances
        if (projectFinancesData) setProjectFinances(projectFinancesData);

        // Project Transactions
        if (projectTxData) setProjectTransactions(projectTxData);

        // HRM 5A — Leave Balances + Auto-accrual
        const [leaveBalData, leaveReqData, attendData, payrollData, contractData, payrollTplData, holidayData, salaryHistData] = await Promise.all([
          fetchTable('hrm_leave_balances'),
          fetchTable('hrm_leave_requests'),
          fetchTable('hrm_attendance'),
          fetchTable('hrm_payrolls'),
          fetchTable('hrm_labor_contracts'),
          fetchTable('hrm_payroll_templates'),
          fetchTable('hrm_holidays'),
          fetchTable('hrm_salary_history'),
        ]);
        if (leaveBalData) setLeaveBalances(leaveBalData);
        if (leaveReqData) setLeaveRequests(leaveReqData);
        // Fetch leave logs
        const leaveLogData = await fetchTable('hrm_leave_logs');
        if (leaveLogData) setLeaveLogs(leaveLogData);
        if (attendData) setAttendanceRecords(attendData);
        if (payrollData) setPayrollRecords(payrollData);
        if (contractData) setLaborContracts(contractData);
        if (payrollTplData) setPayrollTemplates(payrollTplData);
        if (holidayData) setHolidays(holidayData);
        if (salaryHistData) setSalaryHistory(salaryHistData);

        // Attendance Proposals
        const proposalData = await fetchTable('hrm_attendance_proposals');
        if (proposalData) setAttendanceProposals(proposalData);

        // Budget
        const [budgetCatData, budgetEntData, expRecData] = await Promise.all([
          fetchTable('budget_categories'),
          fetchTable('budget_entries'),
          fetchTable('expense_records'),
        ]);
        if (budgetCatData) setBudgetCategories(budgetCatData);
        if (budgetEntData) setBudgetEntries(budgetEntData);
        if (expRecData) setExpenseRecords(expRecData);

        // Auto-accrual + Reset sau tháng 3 năm kế tiếp
        if (leaveBalData && leaveBalData.length > 0) {
          const now = new Date();
          const currentMonth = now.getMonth() + 1; // 1-12
          const currentYear = now.getFullYear();
          for (const bal of leaveBalData) {
            // Reset: nếu đã qua tháng 3 năm sau năm của balance → reset về 0 cho năm mới
            const shouldReset = (bal.year < currentYear && (currentYear - bal.year > 1 || currentMonth > 3));
            if (shouldReset) {
              const newAccrued = currentMonth; // Cộng dồn cho các tháng đã qua của năm mới
              const updated = { ...bal, year: currentYear, accruedDays: newAccrued, usedPaidDays: 0, usedUnpaidDays: 0, lastAccrualMonth: currentMonth };
              setLeaveBalances(prev => prev.map(b => b.id === bal.id ? updated : b));
              supabase.from('hrm_leave_balances').update({ year: currentYear, accruedDays: newAccrued, usedPaidDays: 0, usedUnpaidDays: 0, lastAccrualMonth: currentMonth }).eq('id', bal.id).then();
            } else if (bal.year === currentYear && bal.lastAccrualMonth < currentMonth) {
              // Accrual bình thường cho năm hiện tại
              const monthsMissing = currentMonth - bal.lastAccrualMonth;
              const newAccrued = bal.accruedDays + bal.monthlyAccrual * monthsMissing;
              const updated = { ...bal, accruedDays: newAccrued, lastAccrualMonth: currentMonth };
              setLeaveBalances(prev => prev.map(b => b.id === bal.id ? updated : b));
              supabase.from('hrm_leave_balances').update({ accruedDays: newAccrued, lastAccrualMonth: currentMonth }).eq('id', bal.id).then();
            }
          }
        }

        // Assets
        const [assetsData, assetCatData, assetAssignData, assetMaintData] = await Promise.all([
          fetchTable('assets'),
          fetchTable('asset_categories'),
          fetchTable('asset_assignments', supabase.from('asset_assignments').select('*').order('date', { ascending: false })),
          fetchTable('asset_maintenances', supabase.from('asset_maintenances').select('*').order('start_date', { ascending: false })),
        ]);
        if (assetsData) setAssets(assetsData.map((a: any) => ({
          ...a, categoryId: a.category_id, serialNumber: a.serial_number,
          originalValue: a.original_value, purchaseDate: a.purchase_date,
          depreciationYears: a.depreciation_years, warrantyMonths: a.warranty_months,
          residualValue: a.residual_value,
          warehouseId: a.warehouse_id, locationNote: a.location_note,
          assignedToUserId: a.assigned_to_user_id, assignedToName: a.assigned_to_name,
          assignedDate: a.assigned_date, disposalDate: a.disposal_date,
          disposalValue: a.disposal_value, disposalNote: a.disposal_note,
          imageUrl: a.image_url, createdAt: a.created_at, updatedAt: a.updated_at
        })));
        if (assetCatData && assetCatData.length > 0) setAssetCategories(assetCatData.map((c: any) => ({
          ...c, depreciationYears: c.depreciation_years
        })));
        if (assetAssignData) setAssetAssignments(assetAssignData.map((a: any) => ({
          ...a, assetId: a.asset_id, userId: a.user_id, userName: a.user_name,
          fromUserId: a.from_user_id, fromUserName: a.from_user_name,
          performedBy: a.performed_by, performedByName: a.performed_by_name
        })));
        if (assetMaintData) setAssetMaintenances(assetMaintData.map((m: any) => ({
          ...m, assetId: m.asset_id, startDate: m.start_date, endDate: m.end_date,
          performedBy: m.performed_by, performedByName: m.performed_by_name,
          invoiceNumber: m.invoice_number, estimatedCost: m.estimated_cost,
          actualCost: m.actual_cost,
          attachments: typeof m.attachments === 'string' ? JSON.parse(m.attachments) : (m.attachments || [])
        })));
      } catch (error: any) {
        console.error('Error fetching data from Supabase:', error);
        setConnectionError(error.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    // Set up Realtime Subscriptions
    const channels = [
      supabase.channel('public:items').on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const i = payload.new as any;
          const mappedItem = {
            ...i, priceIn: i.price_in, priceOut: i.price_out, minStock: i.min_stock,
            supplierId: i.supplier_id, imageUrl: i.image_url, stockByWarehouse: i.stock_by_warehouse,
            purchaseUnit: i.purchase_unit ?? undefined
          };
          setItems(prev => {
            const exists = prev.find(item => item.id === mappedItem.id);
            if (exists) return prev.map(item => item.id === mappedItem.id ? mappedItem : item);
            return [...prev, mappedItem];
          });
        } else if (payload.eventType === 'DELETE') {
          setItems(prev => prev.filter(item => item.id !== payload.old.id));
        }
      }).subscribe(),

      supabase.channel('public:transactions').on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const t = payload.new as any;
          const mappedTx = {
            ...t, sourceWarehouseId: t.source_warehouse_id, targetWarehouseId: t.target_warehouse_id, supplierId: t.supplier_id, requesterId: t.requester_id, approverId: t.approver_id, relatedRequestId: t.related_request_id, pendingItems: t.pending_items
          };
          setTransactions(prev => {
            const exists = prev.find(tx => tx.id === mappedTx.id);
            if (exists) return prev.map(tx => tx.id === mappedTx.id ? mappedTx : tx);
            return [mappedTx, ...prev];
          });
        } else if (payload.eventType === 'DELETE') {
          setTransactions(prev => prev.filter(tx => tx.id !== payload.old.id));
        }
      }).subscribe(),

      supabase.channel('public:warehouses').on('postgres_changes', { event: '*', schema: 'public', table: 'warehouses' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const w = payload.new as any;
          const mappedWh = { ...w, isArchived: w.is_archived };
          setWarehouses(prev => {
            const exists = prev.find(wh => wh.id === mappedWh.id);
            if (exists) return prev.map(wh => wh.id === mappedWh.id ? mappedWh : wh);
            return [...prev, mappedWh];
          });
        } else if (payload.eventType === 'DELETE') {
          setWarehouses(prev => prev.filter(wh => wh.id !== payload.old.id));
        }
      }).subscribe(),

      supabase.channel('public:suppliers').on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const s = payload.new as any;
          const mappedSup = { ...s, contactPerson: s.contact_person };
          setSuppliers(prev => {
            const exists = prev.find(sup => sup.id === mappedSup.id);
            if (exists) return prev.map(sup => sup.id === mappedSup.id ? mappedSup : sup);
            return [...prev, mappedSup];
          });
        } else if (payload.eventType === 'DELETE') {
          setSuppliers(prev => prev.filter(sup => sup.id !== payload.old.id));
        }
      }).subscribe(),

      supabase.channel('public:requests').on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const r = payload.new as any;
          const mappedReq = {
            ...r, siteWarehouseId: r.site_warehouse_id, sourceWarehouseId: r.source_warehouse_id, requesterId: r.requester_id, createdDate: r.created_date, expectedDate: r.expected_date
          };
          setRequests(prev => {
            const exists = prev.find(req => req.id === mappedReq.id);
            if (exists) return prev.map(req => req.id === mappedReq.id ? mappedReq : req);
            return [mappedReq, ...prev];
          });
        } else if (payload.eventType === 'DELETE') {
          setRequests(prev => prev.filter(req => req.id !== payload.old.id));
        }
      }).subscribe(),

      supabase.channel('public:activities').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activities' }, payload => {
        const a = payload.new as any;
        const mappedAct = {
          ...a, userId: a.user_id, userName: a.user_name, userAvatar: a.user_avatar, warehouseId: a.warehouse_id
        };
        setActivities(prev => [mappedAct, ...prev].slice(0, 50));
      }).subscribe(),

      supabase.channel('public:users').on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const u = payload.new as any;
          const mappedUser = { ...u, assignedWarehouseId: u.assigned_warehouse_id, allowedModules: u.allowed_modules || undefined, adminModules: u.admin_modules || undefined };
          setUsers(prev => {
            const exists = prev.find(user => user.id === mappedUser.id);
            if (exists) return prev.map(user => user.id === mappedUser.id ? mappedUser : user);
            return [...prev, mappedUser];
          });
        } else if (payload.eventType === 'DELETE') {
          setUsers(prev => prev.filter(user => user.id !== payload.old.id));
        }
      }).subscribe(),

      supabase.channel('public:employees').on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const e = payload.new as any;
          const mappedEmp: Employee = {
            id: e.id,
            employeeCode: e.employee_code,
            fullName: e.full_name,
            title: e.title,
            gender: e.gender,
            phone: e.phone,
            email: e.email,
            dateOfBirth: e.date_of_birth,
            startDate: e.start_date,
            officialDate: e.official_date,
            status: e.status,
            userId: e.user_id,
            areaId: e.area_id,
            officeId: e.office_id,
            employeeTypeId: e.employee_type_id,
            positionId: e.position_id,
            salaryPolicyId: e.salary_policy_id,
            workScheduleId: e.work_schedule_id,
            constructionSiteId: e.construction_site_id,
            departmentId: e.department_id,
            factoryId: e.factory_id,
            maritalStatus: e.marital_status,
            createdAt: e.created_at,
            updatedAt: e.updated_at
          };
          setEmployees(prev => {
            const exists = prev.find(emp => emp.id === mappedEmp.id);
            if (exists) return prev.map(emp => emp.id === mappedEmp.id ? mappedEmp : emp);
            return [...prev, mappedEmp];
          });
        } else if (payload.eventType === 'DELETE') {
          setEmployees(prev => prev.filter(emp => emp.id !== payload.old.id));
        }
      }).subscribe(),

      supabase.channel('public:categories').on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const c = payload.new as any;
          setCategories(prev => {
            const exists = prev.find(cat => cat.id === c.id);
            if (exists) return prev.map(cat => cat.id === c.id ? c : cat);
            return [...prev, c];
          });
        } else if (payload.eventType === 'DELETE') {
          setCategories(prev => prev.filter(cat => cat.id !== payload.old.id));
        }
      }).subscribe(),

      supabase.channel('public:units').on('postgres_changes', { event: '*', schema: 'public', table: 'units' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const u = payload.new as any;
          setUnits(prev => {
            const exists = prev.find(unit => unit.id === u.id);
            if (exists) return prev.map(unit => unit.id === u.id ? u : unit);
            return [...prev, u];
          });
        } else if (payload.eventType === 'DELETE') {
          setUnits(prev => prev.filter(unit => unit.id !== payload.old.id));
        }
      }).subscribe(),

      supabase.channel('public:app_settings').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_settings' }, payload => {
        setAppSettings(payload.new as AppSettings);
      }).subscribe(),

      supabase.channel('public:org_units').on('postgres_changes', { event: '*', schema: 'public', table: 'org_units' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const u = payload.new as any;
          const mapped: OrgUnit = { id: u.id, name: u.name, type: u.type, parentId: u.parent_id, description: u.description, orderIndex: u.order_index, createdAt: u.created_at };
          setOrgUnits(prev => {
            const exists = prev.find(ou => ou.id === mapped.id);
            if (exists) return prev.map(ou => ou.id === mapped.id ? mapped : ou);
            return [...prev, mapped];
          });
        } else if (payload.eventType === 'DELETE') {
          setOrgUnits(prev => prev.filter(ou => ou.id !== payload.old.id));
        }
      }).subscribe()
    ];

    return () => {
      channels.forEach(channel => supabase.removeChannel(channel));
    };
  }, []);

  // Helper to sync a single table to Supabase
  const syncToSupabase = async (table: string, data: any) => {
    try {
      if (!isSupabaseConfigured) return;

      let payload = data;

      if (table === 'items') {
        payload = {
          id: data.id, sku: data.sku, name: data.name, category: data.category, unit: data.unit,
          purchase_unit: data.purchaseUnit ?? null,
          price_in: data.priceIn, price_out: data.priceOut, min_stock: data.minStock,
          supplier_id: data.supplierId, image_url: data.imageUrl, stock_by_warehouse: data.stockByWarehouse
        };
      } else if (table === 'transactions') {
        payload = {
          id: data.id, type: data.type, date: data.date, items: data.items,
          source_warehouse_id: data.sourceWarehouseId, target_warehouse_id: data.targetWarehouseId,
          supplier_id: data.supplierId, requester_id: data.requesterId, approver_id: data.approverId,
          status: data.status, note: data.note, related_request_id: data.relatedRequestId, pending_items: data.pendingItems
        };
      } else if (table === 'warehouses') {
        payload = {
          id: data.id, name: data.name, address: data.address, type: data.type, is_archived: data.isArchived
        };
      } else if (table === 'suppliers') {
        payload = {
          id: data.id, name: data.name, contact_person: data.contactPerson, phone: data.phone, debt: data.debt
        };
      } else if (table === 'requests') {
        payload = {
          id: data.id, code: data.code, site_warehouse_id: data.siteWarehouseId, source_warehouse_id: data.sourceWarehouseId,
          requester_id: data.requesterId, status: data.status, items: data.items, created_date: data.createdDate,
          expected_date: data.expectedDate, note: data.note, logs: data.logs
        };
      } else if (table === 'activities') {
        payload = {
          id: data.id, user_id: data.userId, user_name: data.userName, user_avatar: data.userAvatar,
          type: data.type, action: data.action, description: data.description, timestamp: data.timestamp,
          warehouse_id: data.warehouseId, status: data.status
        };
      } else if (table === 'users') {
        payload = {
          id: data.id, name: data.name, email: data.email, username: data.username,
          phone: data.phone, role: data.role, avatar: data.avatar,
          assigned_warehouse_id: data.assignedWarehouseId,
          allowed_modules: data.allowedModules || null,
          admin_modules: data.adminModules || null
        };
      } else if (table === 'employees') {
        payload = {
          id: data.id, employee_code: data.employeeCode, full_name: data.fullName, title: data.title,
          gender: data.gender, phone: data.phone, email: data.email, date_of_birth: data.dateOfBirth,
          start_date: data.startDate, official_date: data.officialDate, status: data.status, user_id: data.userId,
          area_id: data.areaId || null, office_id: data.officeId || null, employee_type_id: data.employeeTypeId || null,
          position_id: data.positionId || null, salary_policy_id: data.salaryPolicyId || null,
          work_schedule_id: data.workScheduleId || null, construction_site_id: data.constructionSiteId || null,
          department_id: data.departmentId || null, factory_id: data.factoryId || null,
          marital_status: data.maritalStatus || ''
        };
      } else if (table === 'org_units') {
        payload = {
          id: data.id, name: data.name, type: data.type, "customTypeLabel": data.customTypeLabel || null,
          parent_id: data.parentId || null, description: data.description || '', order_index: data.orderIndex || 0
        };
      } else if (table === 'assets') {
        payload = {
          id: data.id, code: data.code, name: data.name, category_id: data.category_id || data.categoryId,
          brand: data.brand || null, model: data.model || null, serial_number: data.serial_number || data.serialNumber || null,
          status: data.status, original_value: data.original_value ?? data.originalValue ?? 0,
          purchase_date: data.purchase_date || data.purchaseDate,
          depreciation_years: data.depreciation_years ?? data.depreciationYears ?? 5,
          warranty_months: data.warranty_months ?? data.warrantyMonths ?? 0,
          residual_value: data.residual_value ?? data.residualValue ?? 0,
          warehouse_id: data.warehouse_id || data.warehouseId || null,
          location_note: data.location_note || data.locationNote || null,
          assigned_to_user_id: data.assigned_to_user_id || data.assignedToUserId || null,
          assigned_to_name: data.assigned_to_name || data.assignedToName || null,
          assigned_date: data.assigned_date || data.assignedDate || null,
          disposal_date: data.disposal_date || data.disposalDate || null,
          disposal_value: data.disposal_value ?? data.disposalValue ?? null,
          disposal_note: data.disposal_note || data.disposalNote || null,
          image_url: data.image_url || data.imageUrl || null,
          note: data.note || null,
          created_at: data.created_at || data.createdAt, updated_at: data.updated_at || data.updatedAt
        };
      } else if (table === 'asset_categories') {
        payload = {
          id: data.id, name: data.name, type: data.type,
          depreciation_years: data.depreciation_years ?? data.depreciationYears ?? 5
        };
      } else if (table === 'asset_assignments') {
        payload = {
          id: data.id, asset_id: data.asset_id || data.assetId,
          type: data.type, user_id: data.user_id || data.userId,
          user_name: data.user_name || data.userName,
          from_user_id: data.from_user_id || data.fromUserId || null,
          from_user_name: data.from_user_name || data.fromUserName || null,
          date: data.date, note: data.note || null,
          performed_by: data.performed_by || data.performedBy,
          performed_by_name: data.performed_by_name || data.performedByName
        };
      } else if (table === 'asset_maintenances') {
        payload = {
          id: data.id, asset_id: data.asset_id || data.assetId,
          type: data.type, description: data.description,
          cost: data.cost ?? 0,
          estimated_cost: data.estimated_cost ?? data.estimatedCost ?? 0,
          actual_cost: data.actual_cost ?? data.actualCost ?? 0,
          vendor: data.vendor || null,
          invoice_number: data.invoice_number || data.invoiceNumber || null,
          start_date: data.start_date || data.startDate,
          end_date: data.end_date || data.endDate || null,
          status: data.status,
          performed_by: data.performed_by || data.performedBy,
          performed_by_name: data.performed_by_name || data.performedByName || null,
          note: data.note || null,
          attachments: typeof data.attachments === 'string' ? data.attachments : JSON.stringify(data.attachments || [])
        };
      }

      const { error } = await supabase.from(table).upsert(payload);
      if (error) throw error;
    } catch (error) {
      console.error(`Error syncing ${table} to Supabase:`, error);
    }
  };

  const logActivity = (type: ActivityType, action: string, description: string, status: GlobalActivity['status'] = 'INFO', warehouseId?: string) => {
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const newActivity: GlobalActivity = {
      id: `act-${Date.now()}-${randomSuffix}`,
      userId: user.id,
      userName: user.name,
      userAvatar: user.avatar,
      type,
      action,
      description,
      timestamp: new Date().toISOString(),
      warehouseId,
      status
    };
    setActivities(prev => [newActivity, ...prev].slice(0, 50));
    syncToSupabase('activities', newActivity);
  };

  const login = async (username: string, password: string): Promise<User | null> => {
    if (isSupabaseConfigured) {
      try {
        // Here we map username to an email format for supabase auth if no actual email string was provided
        // Since Supabase requires an email for signInWithPassword by default, we'll try querying the user first, or logging in by email.
        // Assuming the `username` field might actually be an email, or if it's strictly a username, they must login with email under the hood
        // For KhoViet we can fetch the user by username to get the email, then login.

        let loginEmail = username;
        if (!username.includes('@')) {
          const { data, error } = await supabase.from('users').select('email').eq('username', username).single();
          if (error || !data) throw new Error('Không tìm thấy tài khoản');
          loginEmail = data.email;
        }

        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: loginEmail,
          password
        });

        if (authError) throw authError;

        // Fetch user profile
        const { data: userData, error: userError } = await supabase.from('users').select('*').eq('email', loginEmail).single();
        if (userError || !userData) throw new Error('Lỗi lấy thông tin người dùng');

        const mappedUser = { ...userData, assignedWarehouseId: userData.assigned_warehouse_id, allowedModules: userData.allowed_modules || undefined, adminModules: userData.admin_modules || undefined };
        setUser(mappedUser);
        const { avatar, ...userForStorage } = mappedUser;
        localStorage.setItem('khoviet_user', JSON.stringify(userForStorage));
        return mappedUser;

      } catch (err: any) {
        console.error('Login error:', err);
        throw err;
      }
    } else {
      // Fallback to local mock auth
      const foundUser = users.find(u => (u.username === username || u.email === username) && u.password === password);
      if (foundUser) {
        setUser(foundUser);
        const { avatar, ...userForStorage } = foundUser;
        localStorage.setItem('khoviet_user', JSON.stringify(userForStorage));
        return foundUser;
      }
      return null;
    }
  };

  const logout = () => {
    localStorage.removeItem('khoviet_user');
    supabase.auth.signOut();
    // We don't set user to null because the app expects a user object. 
    // We'll handle redirection in App.tsx
  };

  const switchUser = (newUser: User) => {
    setIsRefreshing(true);
    setTimeout(() => {
      setUser(newUser);
      setIsRefreshing(false);
    }, 500);
  };

  const addUser = (u: User) => {
    setUsers(prev => [...prev, u]);
    syncToSupabase('users', u);
    logActivity('SYSTEM', 'Thêm người dùng', `Đã thêm người dùng mới: ${u.name}`, 'SUCCESS');

    // Auto-sync: tạo hồ sơ nhân sự từ thông tin người dùng (Họ tên, Email, SĐT)
    const existingEmployee = employees.find(e => e.userId === u.id || e.email === u.email);
    if (!existingEmployee) {
      const empCount = employees.length + 1;
      const employeeCode = `TT${String(empCount).padStart(3, '0')}`;
      const newEmployee: Employee = {
        id: crypto.randomUUID(),
        employeeCode,
        fullName: u.name,
        title: '',
        gender: 'Nam',
        phone: u.phone || '',
        email: u.email,
        status: 'Đang làm việc',
        userId: u.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      addEmployee(newEmployee);
    }
  };

  const updateUser = (u: User) => {
    setUsers(prev => prev.map(item => item.id === u.id ? u : item));
    if (user.id === u.id) setUser(u);
    syncToSupabase('users', u);
    logActivity('SYSTEM', 'Cập nhật người dùng', `Đã cập nhật thông tin người dùng: ${u.name}`, 'INFO');
  };

  const removeUser = async (id: string) => {
    const u = users.find(user => user.id === id);
    setUsers(prev => prev.filter(u => u.id !== id));
    try {
      await supabase.from('users').delete().eq('id', id);
      if (u) logActivity('SYSTEM', 'Xóa người dùng', `Đã xóa người dùng: ${u.name}`, 'DANGER');
    } catch (error) {
      console.error('Error deleting user from Supabase:', error);
    }
  };

  const addItem = (item: InventoryItem) => {
    setItems(prev => [...prev, item]);
    syncToSupabase('items', item);
    logActivity('INVENTORY', 'Thêm vật tư', `Vật tư "${item.name}" được tạo mới`, 'SUCCESS');
  };

  const addItems = (newItems: InventoryItem[]) => {
    setItems(prev => {
      const existingSkus = new Set(prev.map(i => i.sku));
      const filteredNew = newItems.filter(ni => !existingSkus.has(ni.sku));
      filteredNew.forEach(item => syncToSupabase('items', item));
      return [...prev, ...filteredNew];
    });
  };

  const updateItem = (item: InventoryItem) => {
    setItems(prev => prev.map(i => i.id === item.id ? item : i));
    syncToSupabase('items', item);
  };

  const removeItem = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    if (isSupabaseConfigured) {
      await supabase.from('items').delete().eq('id', id);
    }
  };

  const applyStockChange = (tx: Transaction) => {
    setItems(prevItems => {
      const updatedItems = prevItems.map(item => {
        const txItem = tx.items.find(ti => ti.itemId === item.id);
        if (!txItem) return item;

        const newStock = { ...item.stockByWarehouse };
        const qty = txItem.quantity;

        if (tx.type === TransactionType.IMPORT && tx.targetWarehouseId) {
          newStock[tx.targetWarehouseId] = (newStock[tx.targetWarehouseId] || 0) + qty;
        } else if ((tx.type === TransactionType.EXPORT || tx.type === TransactionType.LIQUIDATION) && tx.sourceWarehouseId) {
          newStock[tx.sourceWarehouseId] = Math.max(0, (newStock[tx.sourceWarehouseId] || 0) - qty);
        } else if (tx.type === TransactionType.TRANSFER && tx.sourceWarehouseId && tx.targetWarehouseId) {
          newStock[tx.sourceWarehouseId] = Math.max(0, (newStock[tx.sourceWarehouseId] || 0) - qty);
          newStock[tx.targetWarehouseId] = (newStock[tx.targetWarehouseId] || 0) + qty;
        } else if (tx.type === TransactionType.ADJUSTMENT && tx.targetWarehouseId) {
          newStock[tx.targetWarehouseId] = (newStock[tx.targetWarehouseId] || 0) + qty;
        }

        const updatedItem = { ...item, stockByWarehouse: newStock };
        syncToSupabase('items', updatedItem);
        return updatedItem;
      });
      return updatedItems;
    });
  };

  const addTransaction = (tx: Transaction) => {
    setTransactions(prev => [tx, ...prev]);
    const whId = tx.targetWarehouseId || tx.sourceWarehouseId;

    if (tx.status === TransactionStatus.COMPLETED || tx.status === TransactionStatus.APPROVED) {
      if (tx.pendingItems && tx.pendingItems.length > 0) {
        addItems(tx.pendingItems);
      }
    }

    logActivity('TRANSACTION', `Tạo phiếu ${tx.type}`, `Phiếu mã ${tx.id.slice(-6)} đã được tạo`, 'INFO', whId);
    if (tx.status === TransactionStatus.COMPLETED) applyStockChange(tx);
    syncToSupabase('transactions', tx);
  };

  const updateTransactionStatus = (id: string, status: TransactionStatus, approverId?: string) => {
    setTransactions(prev => prev.map(tx => {
      if (tx.id === id) {
        const updatedTx = { ...tx, status, approverId: approverId || user.id };
        const whId = tx.targetWarehouseId || tx.sourceWarehouseId;

        if (status === TransactionStatus.COMPLETED || status === TransactionStatus.APPROVED) {
          if (tx.pendingItems && tx.pendingItems.length > 0) {
            addItems(tx.pendingItems);
          }
        }

        logActivity('TRANSACTION', `Cập nhật phiếu`, `Phiếu mã ${tx.id.slice(-6)} chuyển sang ${status}`, status === TransactionStatus.COMPLETED ? 'SUCCESS' : 'INFO', whId);
        if (status === TransactionStatus.COMPLETED) applyStockChange(updatedTx);
        syncToSupabase('transactions', updatedTx);
        return updatedTx;
      }
      return tx;
    }));
  };

  const approvePartialTransaction = (id: string, selectedItemIds: string[], approverId: string) => {
    setTransactions(prev => prev.map(tx => {
      if (tx.id === id) {
        const filteredItems = tx.items.filter(ti => selectedItemIds.includes(ti.itemId));
        const isNeedReceipt = tx.type === TransactionType.IMPORT || tx.type === TransactionType.TRANSFER;
        const nextStatus = isNeedReceipt ? TransactionStatus.APPROVED : TransactionStatus.COMPLETED;

        if (tx.pendingItems && tx.pendingItems.length > 0) {
          const selectedPendingItems = tx.pendingItems.filter(ni => selectedItemIds.includes(ni.id));
          if (selectedPendingItems.length > 0) {
            addItems(selectedPendingItems);
          }
        }

        const updatedTx = {
          ...tx,
          items: filteredItems,
          status: nextStatus,
          approverId: approverId,
          note: selectedItemIds.length < tx.items.length
            ? `${tx.note} (Đã lọc bớt ${tx.items.length - selectedItemIds.length} món)`
            : tx.note,
          pendingItems: []
        };

        const whId = tx.targetWarehouseId || tx.sourceWarehouseId;
        logActivity('TRANSACTION', `Phê duyệt phiếu`, `Phiếu mã ${tx.id.slice(-6)} đã được phê duyệt một phần (${selectedItemIds.length}/${tx.items.length} món)`, 'SUCCESS', whId);

        if (nextStatus === TransactionStatus.COMPLETED) applyStockChange(updatedTx);
        syncToSupabase('transactions', updatedTx);
        return updatedTx;
      }
      return tx;
    }));
  };

  const clearTransactionHistory = async () => {
    setTransactions([]);
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('transactions').delete().gt('id', '0');
      if (error) console.error("Error clearing transactions:", error);
    }
  };

  const clearAllData = async () => {
    if (!isSupabaseConfigured) {
      setItems([]);
      setTransactions([]);
      setActivities([]);
      setRequests([]);
      return;
    }

    try {
      setIsLoading(true);
      // Delete all data from principal tables
      await Promise.all([
        supabase.from('items').delete().neq('id', '0'),
        supabase.from('transactions').delete().neq('id', '0'),
        supabase.from('activities').delete().neq('id', '0'),
        supabase.from('requests').delete().neq('id', '0')
      ]);

      setItems([]);
      setTransactions([]);
      setActivities([]);
      setRequests([]);

      logActivity('SYSTEM', 'Xóa dữ liệu', 'Toàn bộ dữ liệu vật tư và giao dịch đã được xóa sạch trên Cloud', 'DANGER');
    } catch (error) {
      console.error("Error clearing all data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const addWarehouse = (w: Warehouse) => {
    setWarehouses(prev => [...prev, w]);
    syncToSupabase('warehouses', w);
    logActivity('SYSTEM', 'Thêm kho bãi', `Đã thêm kho mới: ${w.name}`, 'SUCCESS');
  };

  const updateWarehouse = (w: Warehouse) => {
    setWarehouses(prev => prev.map(item => item.id === w.id ? w : item));
    syncToSupabase('warehouses', w);
    logActivity('SYSTEM', 'Cập nhật kho bãi', `Đã cập nhật thông tin kho: ${w.name}`, 'INFO');
  };

  const removeWarehouse = async (id: string) => {
    const warehouse = warehouses.find(w => w.id === id);
    if (!warehouse) return;

    const hasStock = items.some(item => (item.stockByWarehouse[id] || 0) > 0);

    if (hasStock) {
      const updatedWh = { ...warehouse, isArchived: true };
      setWarehouses(prev => prev.map(w => w.id === id ? updatedWh : w));
      syncToSupabase('warehouses', updatedWh);
      logActivity('SYSTEM', 'Lưu trữ kho bãi', `Kho ${warehouse.name} vẫn còn tồn kho nên đã được chuyển vào trạng thái Lưu trữ.`, 'WARNING');
    } else {
      setWarehouses(prev => prev.filter(w => w.id !== id));
      if (isSupabaseConfigured) await supabase.from('warehouses').delete().eq('id', id);
      logActivity('SYSTEM', 'Xóa kho bãi', `Đã xóa hoàn toàn kho: ${warehouse.name}`, 'DANGER');
    }
  };

  const addRequest = (r: MaterialRequest) => {
    setRequests(prev => [r, ...prev]);
    syncToSupabase('requests', r);
    logActivity('REQUEST', 'Yêu cầu vật tư', `Phiếu yêu cầu ${r.code} đã được gửi`, 'INFO', r.siteWarehouseId);
  };

  const updateRequestStatus = (id: string, status: RequestStatus, note?: string, approvedItems?: { itemId: string, qty: number }[], sourceWarehouseId?: string) => {
    const req = requests.find(r => r.id === id);
    if (!req) return;

    const newLog: AuditLog = {
      action: status,
      userId: user.id,
      timestamp: new Date().toISOString(),
      note: note
    };

    let updatedItems = [...req.items];
    if (status === RequestStatus.APPROVED && approvedItems) {
      updatedItems = req.items.map(item => {
        const approved = approvedItems.find(i => i.itemId === item.itemId);
        return approved ? { ...item, approvedQty: approved.qty } : item;
      });
    }

    const effectiveSourceWhId = sourceWarehouseId || req.sourceWarehouseId;

    const updatedReq = {
      ...req,
      status,
      sourceWarehouseId: effectiveSourceWhId,
      items: updatedItems,
      logs: [...req.logs, newLog]
    };

    setRequests(prev => prev.map(r => r.id === id ? updatedReq : r));
    logActivity('REQUEST', 'Cập nhật yêu cầu', `Yêu cầu ${req.code} chuyển sang ${status}`, 'INFO', req.siteWarehouseId);
    syncToSupabase('requests', updatedReq);

    // Generate Transaction when Request is fully received
    if (status === RequestStatus.COMPLETED) {
      const tx: Transaction = {
        id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: TransactionType.TRANSFER,
        date: new Date().toISOString(),
        items: updatedItems.map(i => ({ itemId: i.itemId, quantity: i.approvedQty })),
        sourceWarehouseId: effectiveSourceWhId,
        targetWarehouseId: req.siteWarehouseId,
        requesterId: req.requesterId,
        approverId: user.id,
        status: TransactionStatus.COMPLETED,
        note: `Điều chuyển từ phiếu yêu cầu: ${req.code}` + (note ? ` - ${note}` : ''),
        relatedRequestId: req.id
      };
      // addTransaction handles applying stock changes, logging the transaction, and syncing to DB
      addTransaction(tx);
    }
  };

  const addCategory = (name: string) => {
    const newCat = { id: `cat-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`, name };
    setCategories(prev => [...prev, newCat]);
    syncToSupabase('categories', newCat);
  };

  const updateCategory = (c: ItemCategory) => {
    setCategories(prev => prev.map(item => item.id === c.id ? c : item));
    syncToSupabase('categories', c);
  };

  const removeCategory = async (id: string) => {
    setCategories(prev => prev.filter(c => c.id !== id));
    if (isSupabaseConfigured) await supabase.from('categories').delete().eq('id', id);
  };

  const addUnit = (name: string) => {
    const newUnit = { id: `unit-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`, name };
    setUnits(prev => [...prev, newUnit]);
    syncToSupabase('units', newUnit);
  };

  const updateUnit = (u: ItemUnit) => {
    setUnits(prev => prev.map(item => item.id === u.id ? u : item));
    syncToSupabase('units', u);
  };

  const removeUnit = async (id: string) => {
    setUnits(prev => prev.filter(u => u.id !== id));
    if (isSupabaseConfigured) await supabase.from('units').delete().eq('id', id);
  };

  const addSupplier = (s: Supplier) => {
    setSuppliers(prev => [...prev, s]);
    syncToSupabase('suppliers', s);
  };

  const updateSupplier = (s: Supplier) => {
    setSuppliers(prev => prev.map(item => item.id === s.id ? s : item));
    syncToSupabase('suppliers', s);
  };

  const removeSupplier = async (id: string) => {
    setSuppliers(prev => prev.filter(s => s.id !== id));
    if (isSupabaseConfigured) await supabase.from('suppliers').delete().eq('id', id);
  };

  const addEmployee = (e: Employee) => {
    setEmployees(prev => [...prev, e]);
    syncToSupabase('employees', e);
    logActivity('SYSTEM', 'Thêm nhân sự', `Đã thêm hồ sơ nhân sự mới: ${e.fullName}`, 'SUCCESS');
  };

  const updateEmployee = (e: Employee) => {
    setEmployees(prev => prev.map(item => item.id === e.id ? e : item));
    syncToSupabase('employees', e);
    logActivity('SYSTEM', 'Cập nhật nhân sự', `Đã cập nhật thông tin nhân sự: ${e.fullName}`, 'INFO');
  };

  const removeEmployee = async (id: string) => {
    const e = employees.find(emp => emp.id === id);
    setEmployees(prev => prev.filter(emp => emp.id !== id));
    try {
      if (isSupabaseConfigured) await supabase.from('employees').delete().eq('id', id);
      if (e) logActivity('SYSTEM', 'Xóa nhân sự', `Đã xóa hồ sơ nhân sự: ${e.fullName}`, 'DANGER');
    } catch (error) {
      console.error('Error deleting employee from Supabase:', error);
    }
  };

  const updateAppSettings = (s: AppSettings) => {
    setAppSettings(s);
    syncToSupabase('app_settings', { ...s, id: 1 });
  };

  // ==================== HRM MASTER DATA CRUD ====================
  const hrmSetterMap: Record<string, React.Dispatch<React.SetStateAction<any[]>>> = {
    'hrm_areas': setHrmAreas,
    'hrm_offices': setHrmOffices,
    'hrm_employee_types': setHrmEmployeeTypes,
    'hrm_positions': setHrmPositions,
    'hrm_salary_policies': setHrmSalaryPolicies,
    'hrm_work_schedules': setHrmWorkSchedules,
    'hrm_construction_sites': setHrmConstructionSites,
    // HRM 5A
    'hrm_attendance': setAttendanceRecords,
    'hrm_leave_requests': setLeaveRequests,
    'hrm_leave_balances': setLeaveBalances,
    'hrm_payrolls': setPayrollRecords,
    'hrm_payroll_templates': setPayrollTemplates,
    'hrm_holidays': setHolidays,
    'hrm_labor_contracts': setLaborContracts,
    'hrm_salary_history': setSalaryHistory,
    'budget_categories': setBudgetCategories,
    'budget_entries': setBudgetEntries,
    'expense_records': setExpenseRecords,
    'hrm_attendance_proposals': setAttendanceProposals,
    'hrm_leave_logs': setLeaveLogs,
  };

  const addHrmItem = async (table: string, item: any) => {
    const setter = hrmSetterMap[table];
    if (!setter) return;
    setter((prev: any[]) => [...prev, item]);
    if (isSupabaseConfigured) {
      const { error } = await supabase.from(table).insert(item);
      if (error) console.error(`Error adding to ${table}:`, error);
    }
  };

  const updateHrmItem = async (table: string, item: any) => {
    const setter = hrmSetterMap[table];
    if (!setter) return;
    setter((prev: any[]) => prev.map((i: any) => i.id === item.id ? item : i));
    if (isSupabaseConfigured) {
      const { error } = await supabase.from(table).update(item).eq('id', item.id);
      if (error) console.error(`Error updating ${table}:`, error);
    }
  };

  const removeHrmItem = async (table: string, id: string) => {
    const setter = hrmSetterMap[table];
    if (!setter) return;
    setter((prev: any[]) => prev.filter((i: any) => i.id !== id));
    if (isSupabaseConfigured) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) console.error(`Error deleting from ${table}:`, error);
    }
  };

  // Org Unit CRUD
  const addOrgUnit = async (unit: OrgUnit) => {
    setOrgUnits(prev => [...prev, unit]);
    syncToSupabase('org_units', unit);
  };

  const updateOrgUnit = async (unit: OrgUnit) => {
    setOrgUnits(prev => prev.map(u => u.id === unit.id ? unit : u));
    syncToSupabase('org_units', unit);
  };

  const removeOrgUnit = async (id: string) => {
    // Cascade: remove children first (DB handles it but update local state)
    const removeRecursive = (parentId: string, units: OrgUnit[]): OrgUnit[] => {
      const children = units.filter(u => u.parentId === parentId);
      let result = units.filter(u => u.id !== parentId);
      children.forEach(child => { result = removeRecursive(child.id, result); });
      return result;
    };
    setOrgUnits(prev => removeRecursive(id, prev));
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('org_units').delete().eq('id', id);
      if (error) console.error('Error deleting org_unit:', error);
    }
  };

  // ==================== LOSS NORMS CRUD ====================
  const addLossNorm = (norm: MaterialLossNorm) => {
    setLossNorms(prev => [...prev, norm]);
    if (isSupabaseConfigured) {
      supabase.from('loss_norms').upsert({
        id: norm.id, item_id: norm.itemId || null, category_id: norm.categoryId || null,
        loss_type: norm.lossType, allowed_percentage: norm.allowedPercentage,
        period: norm.period, created_by: norm.createdBy, created_at: norm.createdAt
      }).then(({ error }) => { if (error) console.error('Error adding loss_norm:', error); });
    }
  };

  const updateLossNorm = (norm: MaterialLossNorm) => {
    setLossNorms(prev => prev.map(n => n.id === norm.id ? norm : n));
    if (isSupabaseConfigured) {
      supabase.from('loss_norms').upsert({
        id: norm.id, item_id: norm.itemId || null, category_id: norm.categoryId || null,
        loss_type: norm.lossType, allowed_percentage: norm.allowedPercentage,
        period: norm.period, created_by: norm.createdBy, created_at: norm.createdAt
      }).then(({ error }) => { if (error) console.error('Error updating loss_norm:', error); });
    }
  };

  const removeLossNorm = async (id: string) => {
    setLossNorms(prev => prev.filter(n => n.id !== id));
    if (isSupabaseConfigured) await supabase.from('loss_norms').delete().eq('id', id);
  };

  // ==================== AUDIT SESSIONS CRUD ====================
  const addAuditSession = (session: AuditSession) => {
    setAuditSessions(prev => [session, ...prev]);
    if (isSupabaseConfigured) {
      supabase.from('audit_sessions').upsert(session)
        .then(({ error }) => { if (error) console.error('Error saving audit_session:', error); });
    }
  };

  // ==================== PROJECT FINANCES CRUD ====================
  const addProjectFinance = (pf: ProjectFinance) => {
    setProjectFinances(prev => [pf, ...prev]);
    if (isSupabaseConfigured) {
      supabase.from('project_finances').upsert(pf)
        .then(({ error }) => { if (error) console.error('Error saving project_finance:', error); });
    }
  };

  const updateProjectFinance = (pf: ProjectFinance) => {
    setProjectFinances(prev => prev.map(p => p.id === pf.id ? pf : p));
    if (isSupabaseConfigured) {
      supabase.from('project_finances').upsert(pf)
        .then(({ error }) => { if (error) console.error('Error updating project_finance:', error); });
    }
  };

  const removeProjectFinance = (id: string) => {
    setProjectFinances(prev => prev.filter(p => p.id !== id));
    if (isSupabaseConfigured) {
      supabase.from('project_finances').delete().eq('id', id)
        .then(({ error }) => { if (error) console.error('Error deleting project_finance:', error); });
    }
  };

  // ==================== PROJECT TRANSACTIONS CRUD ====================
  const addProjectTransaction = (tx: ProjectTransaction) => {
    setProjectTransactions(prev => [tx, ...prev]);
    if (isSupabaseConfigured) {
      supabase.from('project_transactions').upsert(tx)
        .then(({ error }) => { if (error) console.error('Error saving project_tx:', error); });
    }
  };

  const addProjectTransactions = (txs: ProjectTransaction[]) => {
    setProjectTransactions(prev => [...txs, ...prev]);
    if (isSupabaseConfigured) {
      supabase.from('project_transactions').upsert(txs)
        .then(({ error }) => { if (error) console.error('Error saving project_txs:', error); });
    }
  };

  const updateProjectTransaction = (tx: ProjectTransaction) => {
    setProjectTransactions(prev => prev.map(t => t.id === tx.id ? tx : t));
    if (isSupabaseConfigured) {
      supabase.from('project_transactions').upsert(tx)
        .then(({ error }) => { if (error) console.error('Error updating project_tx:', error); });
    }
  };

  const removeProjectTransaction = (id: string) => {
    setProjectTransactions(prev => prev.filter(t => t.id !== id));
    if (isSupabaseConfigured) {
      supabase.from('project_transactions').delete().eq('id', id)
        .then(({ error }) => { if (error) console.error('Error deleting project_tx:', error); });
    }
  };

  // ==================== ASSET MANAGEMENT CRUD ====================

  const addAsset = (asset: Asset) => {
    setAssets(prev => [...prev, asset]);
    if (isSupabaseConfigured) {
      syncToSupabase('assets', { ...asset, category_id: asset.categoryId, serial_number: asset.serialNumber, original_value: asset.originalValue, purchase_date: asset.purchaseDate, depreciation_years: asset.depreciationYears, warranty_months: asset.warrantyMonths || 0, residual_value: asset.residualValue, warehouse_id: asset.warehouseId, location_note: asset.locationNote, assigned_to_user_id: asset.assignedToUserId, assigned_to_name: asset.assignedToName, assigned_date: asset.assignedDate, disposal_date: asset.disposalDate, disposal_value: asset.disposalValue, disposal_note: asset.disposalNote, image_url: asset.imageUrl, created_at: asset.createdAt, updated_at: asset.updatedAt });
    }
    logActivity('SYSTEM', 'Thêm tài sản', `Thêm tài sản ${asset.name} (${asset.code})`, 'SUCCESS');
  };

  const updateAsset = (asset: Asset) => {
    setAssets(prev => prev.map(a => a.id === asset.id ? asset : a));
    if (isSupabaseConfigured) {
      syncToSupabase('assets', { ...asset, category_id: asset.categoryId, serial_number: asset.serialNumber, original_value: asset.originalValue, purchase_date: asset.purchaseDate, depreciation_years: asset.depreciationYears, warranty_months: asset.warrantyMonths || 0, residual_value: asset.residualValue, warehouse_id: asset.warehouseId, location_note: asset.locationNote, assigned_to_user_id: asset.assignedToUserId, assigned_to_name: asset.assignedToName, assigned_date: asset.assignedDate, disposal_date: asset.disposalDate, disposal_value: asset.disposalValue, disposal_note: asset.disposalNote, image_url: asset.imageUrl, created_at: asset.createdAt, updated_at: asset.updatedAt });
    }
  };

  const removeAsset = (id: string) => {
    const asset = assets.find(a => a.id === id);
    setAssets(prev => prev.filter(a => a.id !== id));
    if (isSupabaseConfigured) {
      supabase.from('assets').delete().eq('id', id).then();
    }
    logActivity('SYSTEM', 'Xóa tài sản', `Xóa tài sản ${asset?.name || id}`, 'WARNING');
  };

  const addAssetCategory = (cat: AssetCategory) => {
    setAssetCategories(prev => [...prev, cat]);
    if (isSupabaseConfigured) {
      syncToSupabase('asset_categories', { ...cat, depreciation_years: cat.depreciationYears });
    }
  };

  const updateAssetCategory = (cat: AssetCategory) => {
    setAssetCategories(prev => prev.map(c => c.id === cat.id ? cat : c));
    if (isSupabaseConfigured) {
      syncToSupabase('asset_categories', { ...cat, depreciation_years: cat.depreciationYears });
    }
  };

  const removeAssetCategory = (id: string) => {
    setAssetCategories(prev => prev.filter(c => c.id !== id));
    if (isSupabaseConfigured) {
      supabase.from('asset_categories').delete().eq('id', id).then();
    }
  };

  const addAssetAssignment = (a: AssetAssignment) => {
    setAssetAssignments(prev => [a, ...prev]);
    if (isSupabaseConfigured) {
      syncToSupabase('asset_assignments', { ...a, asset_id: a.assetId, user_id: a.userId, user_name: a.userName, from_user_id: a.fromUserId, from_user_name: a.fromUserName, performed_by: a.performedBy, performed_by_name: a.performedByName });
    }
    // Update asset status
    const asset = assets.find(ast => ast.id === a.assetId);
    if (asset) {
      if (a.type === 'assign') {
        updateAsset({ ...asset, status: AssetStatus.IN_USE, assignedToUserId: a.userId, assignedToName: a.userName, assignedDate: a.date, updatedAt: new Date().toISOString() });
      } else if (a.type === 'transfer') {
        // Luân chuyển: đổi người sử dụng, giữ nguyên status IN_USE
        updateAsset({ ...asset, status: AssetStatus.IN_USE, assignedToUserId: a.userId, assignedToName: a.userName, assignedDate: a.date, updatedAt: new Date().toISOString() });
      } else {
        updateAsset({ ...asset, status: AssetStatus.AVAILABLE, assignedToUserId: undefined, assignedToName: undefined, assignedDate: undefined, updatedAt: new Date().toISOString() });
      }
    }
    logActivity('SYSTEM', a.type === 'assign' ? 'Cấp phát tài sản' : a.type === 'transfer' ? 'Luân chuyển tài sản' : 'Thu hồi tài sản', `${a.type === 'assign' ? 'Cấp phát' : a.type === 'transfer' ? `Luân chuyển từ ${a.fromUserName} sang` : 'Thu hồi'} tài sản ${a.type !== 'return' ? 'cho' : 'từ'} ${a.userName}`, 'INFO');
  };

  const addAssetMaintenance = (m: AssetMaintenance) => {
    setAssetMaintenances(prev => [m, ...prev]);
    if (isSupabaseConfigured) {
      syncToSupabase('asset_maintenances', { ...m, asset_id: m.assetId, start_date: m.startDate, end_date: m.endDate, performed_by: m.performedBy, performed_by_name: m.performedByName, invoice_number: m.invoiceNumber, estimated_cost: m.estimatedCost, actual_cost: m.actualCost, attachments: JSON.stringify(m.attachments || []) });
    }
    if (m.status === 'in_progress') {
      const asset = assets.find(a => a.id === m.assetId);
      if (asset) updateAsset({ ...asset, status: AssetStatus.MAINTENANCE, updatedAt: new Date().toISOString() });
    }
    logActivity('SYSTEM', 'Bảo trì tài sản', `Ghi nhận bảo trì: ${m.description}`, 'INFO');
  };

  const updateAssetMaintenance = (m: AssetMaintenance) => {
    setAssetMaintenances(prev => prev.map(x => x.id === m.id ? m : x));
    if (isSupabaseConfigured) {
      syncToSupabase('asset_maintenances', { ...m, asset_id: m.assetId, start_date: m.startDate, end_date: m.endDate, performed_by: m.performedBy, estimated_cost: m.estimatedCost, actual_cost: m.actualCost });
    }
    if (m.status === 'completed') {
      const asset = assets.find(a => a.id === m.assetId);
      if (asset && asset.status === AssetStatus.MAINTENANCE) {
        const isAssigned = asset.assignedToUserId;
        updateAsset({ ...asset, status: isAssigned ? AssetStatus.IN_USE : AssetStatus.AVAILABLE, updatedAt: new Date().toISOString() });
      }
    }
  };

  // ==================== LEAVE WORKFLOW ====================
  const addLeaveLog = async (log: Omit<LeaveLog, 'id' | 'createdAt'>) => {
    const newLog: LeaveLog = { ...log, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    setLeaveLogs(prev => [...prev, newLog]);
    if (isSupabaseConfigured) {
      await supabase.from('hrm_leave_logs').insert({
        id: newLog.id, leave_request_id: newLog.leaveRequestId,
        action: newLog.action, acted_by: newLog.actedBy, comment: newLog.comment, created_at: newLog.createdAt
      });
    }
  };

  const approveLeave = async (id: string, userId: string, comment?: string) => {
    const req = leaveRequests.find(r => r.id === id);
    if (!req) return;
    const newApprovers = (req.approvers || []).map(a =>
      a.userId === userId && a.status === 'waiting' ? { ...a, status: 'approved' as const, comment: comment || '' } : a
    );
    const allApproved = newApprovers.every(a => a.status === 'approved');
    const updated: LeaveRequest = {
      ...req,
      approvers: newApprovers,
      status: allApproved ? 'approved' : 'pending',
      approvedBy: allApproved ? userId : req.approvedBy,
      approvedAt: allApproved ? new Date().toISOString() : req.approvedAt,
    };
    updateHrmItem('hrm_leave_requests', updated);
    addLeaveLog({ leaveRequestId: id, action: 'approve', actedBy: userId, comment: comment || 'Đã duyệt' });
  };

  const rejectLeave = async (id: string, userId: string, comment?: string, reason?: string) => {
    const req = leaveRequests.find(r => r.id === id);
    if (!req) return;
    const newApprovers = (req.approvers || []).map(a =>
      a.userId === userId && a.status === 'waiting' ? { ...a, status: 'rejected' as const, comment: comment || reason || '' } : a
    );
    const updated: LeaveRequest = {
      ...req,
      approvers: newApprovers,
      status: 'rejected',
      rejectionReason: reason || comment || '',
      approvedBy: userId,
      approvedAt: new Date().toISOString(),
    };
    updateHrmItem('hrm_leave_requests', updated);
    addLeaveLog({ leaveRequestId: id, action: 'reject', actedBy: userId, comment: reason || comment || 'Từ chối' });
  };

  // Helper: kiểm tra user có phải QTV ứng dụng của module không
  const isModuleAdmin = (moduleKey: string): boolean => {
    if (user.role === Role.ADMIN) return true;
    return (user.adminModules || []).includes(moduleKey);
  };

  // ==================== DIGITAL SIGNATURE ====================
  const saveSignature = async (userId: string, dataUrl: string): Promise<boolean> => {
    try {
      // Ensure auth session is active for storage upload
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session) {
        console.warn('No active auth session, attempting to refresh...');
        await supabase.auth.refreshSession();
      }

      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const path = `signatures/${userId}.png`;
      // Upload with upsert
      const { error: upErr } = await supabase.storage.from('workflow-templates').upload(path, blob, { contentType: 'image/png', upsert: true });
      if (upErr) { console.error('Signature upload error:', upErr); return false; }
      // Upsert DB
      const { error: dbErr } = await supabase.from('user_signatures').upsert({ user_id: userId, image_path: path }, { onConflict: 'user_id' });
      if (dbErr) { console.error('Signature DB error:', dbErr); return false; }
      // Update local state
      const { data: urlData } = supabase.storage.from('workflow-templates').getPublicUrl(path);
      const publicUrl = urlData?.publicUrl ? `${urlData.publicUrl}?t=${Date.now()}` : '';
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, signatureUrl: publicUrl } : u));
      if (user.id === userId) setUser(prev => ({ ...prev, signatureUrl: publicUrl }));
      return true;
    } catch (err) { console.error('Save signature error:', err); return false; }
  };

  const deleteSignature = async (userId: string): Promise<boolean> => {
    try {
      const path = `signatures/${userId}.png`;
      await supabase.storage.from('workflow-templates').remove([path]);
      const { error } = await supabase.from('user_signatures').delete().eq('user_id', userId);
      if (error) { console.error('Delete signature error:', error); return false; }
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, signatureUrl: undefined } : u));
      if (user.id === userId) setUser(prev => ({ ...prev, signatureUrl: undefined }));
      return true;
    } catch (err) { console.error('Delete signature error:', err); return false; }
  };

  return (
    <AppContext.Provider value={{
      user, users, appSettings, setUser, switchUser, addUser, updateUser, removeUser, items, warehouses, suppliers, transactions, requests, activities,
      categories, units, employees,
      hrmAreas, hrmOffices, hrmEmployeeTypes, hrmPositions, hrmSalaryPolicies, hrmWorkSchedules, hrmConstructionSites,
      attendanceRecords, leaveRequests, leaveLogs, leaveBalances, payrollRecords, payrollTemplates, holidays, laborContracts, salaryHistory,
      attendanceProposals, approveLeave, rejectLeave, addLeaveLog,
      budgetCategories, budgetEntries, expenseRecords,
      addHrmItem, updateHrmItem, removeHrmItem,
      orgUnits, addOrgUnit, updateOrgUnit, removeOrgUnit,
      addItem, addItems, updateItem, removeItem, addTransaction, updateTransactionStatus, clearTransactionHistory, addWarehouse, updateWarehouse, removeWarehouse,
      addRequest, updateRequestStatus, logActivity, addCategory, updateCategory, removeCategory, addUnit, updateUnit, removeUnit,
      addSupplier, updateSupplier, removeSupplier, addEmployee, updateEmployee, removeEmployee, updateAppSettings, approvePartialTransaction, clearAllData,
      lossNorms, addLossNorm, updateLossNorm, removeLossNorm,
      auditSessions, addAuditSession,
      projectFinances, addProjectFinance, updateProjectFinance, removeProjectFinance,
      projectTransactions, addProjectTransaction, addProjectTransactions, updateProjectTransaction, removeProjectTransaction,
      assets, assetCategories, assetAssignments, assetMaintenances,
      addAsset, updateAsset, removeAsset, addAssetCategory, updateAssetCategory, removeAssetCategory,
      addAssetAssignment, addAssetMaintenance, updateAssetMaintenance,
      isModuleAdmin,
      saveSignature, deleteSignature,
      login, logout, isLoading, isRefreshing, connectionError
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
};
