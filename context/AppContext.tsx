
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  InventoryItem, Transaction, User, Warehouse, Supplier,
  Role, TransactionStatus, TransactionType, MaterialRequest,
  RequestStatus, AuditLog, GlobalActivity, ActivityType,
  ItemCategory, ItemUnit, Employee, MaterialLossNorm, AuditSession,
  HrmArea, HrmOffice, HrmEmployeeType, HrmPosition, HrmSalaryPolicy, HrmWorkSchedule, HrmConstructionSite,
  OrgUnit, ProjectFinance, ProjectTransaction,
  Asset, AssetCategory, AssetAssignment, AssetMaintenance, AssetStatus, AssetLocationStock, AssetTransfer, AssetOrigin, AssetAttachment,
  AttendanceRecord, LeaveRequest, PayrollRecord, LaborContract, LeaveBalance, PayrollTemplate, HrmHoliday, HrmSalaryHistory,
  BudgetCategory, BudgetEntry, ExpenseRecord, AttendanceProposal, LeaveLog, LeaveApprover,
  HrmShiftType, HrmEmployeeShift
} from '../types';
import {
  MOCK_USERS, MOCK_WAREHOUSES, MOCK_ITEMS,
  MOCK_SUPPLIERS, MOCK_TRANSACTIONS
} from '../constants';
import { auditService } from '../lib/auditService';
import { realtimeService, RealtimeStatus } from '../lib/realtimeService';

interface AppSettings {
  name: string;
  logo: string;
}

export type AppModule = 'wms' | 'hrm' | 'da' | 'ts' | 'ex';

interface AppContextType {
  user: User;
  users: User[];
  appSettings: AppSettings;
  theme: 'light' | 'dark';
  setUser: (user: User) => void;
  switchUser: (user: User) => void;
  login: (username: string, password: string) => Promise<User | null>;
  logout: () => void;
  addUser: (user: User) => Promise<void>;
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
  constructionSites: HrmConstructionSite[];
  shiftTypes: HrmShiftType[];
  employeeShifts: HrmEmployeeShift[];
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
  updateTransactionStatus: (id: string, status: TransactionStatus, approverId?: string) => Promise<void>;
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
  assetLocationStocks: AssetLocationStock[];
  assetTransfers: AssetTransfer[];
  addAsset: (asset: Asset) => void;
  addAssetWithInitialStock: (asset: Asset) => Promise<void>;
  updateAsset: (asset: Asset) => void;
  removeAsset: (id: string) => void;
  addAssetCategory: (cat: AssetCategory) => void;
  updateAssetCategory: (cat: AssetCategory) => void;
  removeAssetCategory: (id: string) => void;
  addAssetAssignment: (a: AssetAssignment) => void;
  addAssetMaintenance: (m: AssetMaintenance) => void;
  updateAssetMaintenance: (m: AssetMaintenance) => void;
  addAssetTransfer: (transfer: AssetTransfer, updatedStocks: AssetLocationStock[]) => void;
  transferAssetStock: (args: {
    assetId: string;
    fromStockId: string;
    qty: number;
    toWarehouseId?: string;
    toUserId?: string;
    reason?: string;
    date: string;
  }) => Promise<AssetTransfer | null>;
  isModuleAdmin: (moduleKey: string) => boolean;
  loadModuleData: (module: AppModule) => Promise<void>;
  isLoading: boolean;
  isRefreshing: boolean;
  connectionError: string | null;
  realtimeStatus: RealtimeStatus;
  lastRealtimeEvent: number;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const mapInventoryItemFromDb = (i: any): InventoryItem => ({
  ...i,
  purchaseUnit: i.purchase_unit,
  priceIn: i.price_in,
  priceOut: i.price_out,
  minStock: i.min_stock,
  supplierId: i.supplier_id,
  imageUrl: i.image_url,
  stockByWarehouse: i.stock_by_warehouse || {},
});

const mapTransactionFromDb = (t: any): Transaction => ({
  ...t,
  sourceWarehouseId: t.source_warehouse_id,
  targetWarehouseId: t.target_warehouse_id,
  supplierId: t.supplier_id,
  requesterId: t.requester_id,
  approverId: t.approver_id,
  relatedRequestId: t.related_request_id,
  pendingItems: t.pending_items,
});

const mapAssetLocationStockFromDb = (l: any): AssetLocationStock => ({
  ...l,
  assetId: l.asset_id,
  warehouseId: l.warehouse_id,
  constructionSiteId: l.construction_site_id,
  deptId: l.dept_id,
  assignedToUserId: l.assigned_to_user_id,
  assignedToName: l.assigned_to_name,
  updatedAt: l.updated_at,
});

const mapAssetTransferFromDb = (t: any): AssetTransfer => ({
  ...t,
  assetId: t.asset_id,
  assetCode: t.asset_code,
  assetName: t.asset_name,
  fromWarehouseId: t.from_warehouse_id,
  fromSiteId: t.from_site_id,
  fromDeptId: t.from_dept_id,
  fromLocationLabel: t.from_location_label,
  toWarehouseId: t.to_warehouse_id,
  toSiteId: t.to_site_id,
  toDeptId: t.to_dept_id,
  toLocationLabel: t.to_location_label,
  receivedByUserId: t.received_by_user_id,
  receivedByName: t.received_by_name,
  performedBy: t.performed_by,
  performedByName: t.performed_by_name,
  createdAt: t.created_at,
});

const assetToDbPayload = (data: Asset) => ({
  id: data.id, code: data.code, name: data.name, category_id: data.categoryId,
  brand: data.brand || null, model: data.model || null, serial_number: data.serialNumber || null,
  status: data.status,
  asset_type: data.assetType || 'single', quantity: data.quantity ?? 1, unit: data.unit || null,
  parent_id: data.parentId || null, child_index: data.childIndex || null, is_bundle: data.isBundle || false,
  managed_by_user_id: data.managedByUserId || null, managing_dept_id: data.managingDeptId || null, construction_site_id: data.constructionSiteId || null,
  supplier_id: data.supplierId || null, contract_number: data.contractNumber || null, invoice_number: data.invoiceNumber || null,
  asset_origin: data.assetOrigin || 'purchase', is_fixed_asset: data.isFixedAsset ?? true, is_leased: data.isLeased || false, leased_from: data.leasedFrom || null, lease_end_date: data.leaseEndDate || null,
  warranty_condition: data.warrantyCondition || null, warranty_provider: data.warrantyProvider || null, warranty_contact: data.warrantyContact || null,
  original_value: data.originalValue ?? 0, purchase_date: data.purchaseDate,
  depreciation_years: data.depreciationYears ?? 5, warranty_months: data.warrantyMonths ?? 0,
  residual_value: data.residualValue ?? 0, warehouse_id: data.warehouseId || null, location_note: data.locationNote || null,
  assigned_to_user_id: data.assignedToUserId || null, assigned_to_name: data.assignedToName || null,
  assigned_date: data.assignedDate || null, disposal_date: data.disposalDate || null,
  disposal_value: data.disposalValue || null, disposal_note: data.disposalNote || null,
  image_url: data.imageUrl || null, note: data.note || null,
  created_at: data.createdAt, updated_at: data.updatedAt
});

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User>(() => {
    const saved = localStorage.getItem('vioo_user');
    return saved ? JSON.parse(saved) : MOCK_USERS[0];
  });
  const [users, setUsers] = useState<User[]>(() => isSupabaseConfigured ? [] : MOCK_USERS);
  const [appSettings, setAppSettings] = useState<AppSettings>({ name: 'Vioo', logo: '' });
  const [items, setItems] = useState<InventoryItem[]>(() => isSupabaseConfigured ? [] : MOCK_ITEMS);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(() => isSupabaseConfigured ? [] : MOCK_WAREHOUSES);
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => isSupabaseConfigured ? [] : MOCK_SUPPLIERS);
  const [transactions, setTransactions] = useState<Transaction[]>(() => isSupabaseConfigured ? [] : MOCK_TRANSACTIONS);
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
  const [shiftTypes, setShiftTypes] = useState<HrmShiftType[]>([]);
  const [employeeShifts, setEmployeeShifts] = useState<HrmEmployeeShift[]>([]);
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
  const [assetCategories, setAssetCategories] = useState<AssetCategory[]>(() => isSupabaseConfigured ? [] : [
    { id: 'ac1', name: 'Máy xúc', type: 'machinery', depreciationYears: 8 },
    { id: 'ac2', name: 'Máy khoan', type: 'equipment', depreciationYears: 5 },
    { id: 'ac3', name: 'Xe tải', type: 'vehicle', depreciationYears: 10 },
    { id: 'ac4', name: 'Máy tính', type: 'it', depreciationYears: 3 },
    { id: 'ac5', name: 'Bàn ghế VP', type: 'furniture', depreciationYears: 5 },
  ]);
  const [assetAssignments, setAssetAssignments] = useState<AssetAssignment[]>([]);
  const [assetMaintenances, setAssetMaintenances] = useState<AssetMaintenance[]>([]);
  const [assetLocationStocks, setAssetLocationStocks] = useState<AssetLocationStock[]>([]);
  const [assetTransfers, setAssetTransfers] = useState<AssetTransfer[]>([]);
  const [categories, setCategories] = useState<ItemCategory[]>(() => isSupabaseConfigured ? [] : [
    { id: 'cat1', name: 'Vật liệu xây dựng' },
    { id: 'cat2', name: 'Công cụ dụng cụ' },
    { id: 'cat3', name: 'Bảo hộ lao động' }
  ]);
  const [units, setUnits] = useState<ItemUnit[]>(() => isSupabaseConfigured ? [] : [
    { id: 'u1', name: 'kg' },
    { id: 'u2', name: 'Bao (50kg)' },
    { id: 'u3', name: 'Cái' },
    { id: 'u4', name: 'Mét' }
  ]);

  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('disconnected');
  const [lastRealtimeEvent, setLastRealtimeEvent] = useState<number>(0);
  const loadedModulesRef = useRef<Set<string>>(new Set());

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

        const [settingsData, usersData] = await Promise.all([
          fetchTable('app_settings', supabase.from('app_settings').select('*').maybeSingle()),
          fetchTable('users')
        ]);

        if (settingsData) setAppSettings(settingsData);
        if (usersData && usersData.length > 0) {
          const mappedUsers = usersData.map((u: any) => ({ ...u, assignedWarehouseId: u.assigned_warehouse_id, allowedModules: u.allowed_modules || undefined, adminModules: u.admin_modules || undefined, allowedSubModules: u.allowed_sub_modules || undefined, adminSubModules: u.admin_sub_modules || undefined }));
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

        // Module-specific data is loaded lazily via loadModuleData()
      } catch (error: any) {
        console.error('Error fetching data from Supabase:', error);
        setConnectionError(error.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    // Set up Realtime via centralized service
    const CRITICAL_TABLES = [
      'items', 'transactions', 'warehouses', 'suppliers', 'requests',
      'activities', 'users', 'employees', 'categories', 'units',
      'app_settings', 'org_units', 'notifications'
    ];

    // Status tracking
    const unsubStatus = realtimeService.onStatusChange((status) => {
      setRealtimeStatus(status);
    });

    // Event timestamp tracking
    const unsubWildcard = realtimeService.on('*', (event) => {
      setLastRealtimeEvent(event.timestamp);
    });

    // ── Items ──
    const unsubItems = realtimeService.on('items', (event) => {
      if (event.eventType === 'INSERT' || event.eventType === 'UPDATE') {
        const i = event.newRecord;
        const mapped = {
          ...i, priceIn: i.price_in, priceOut: i.price_out, minStock: i.min_stock,
          supplierId: i.supplier_id, imageUrl: i.image_url, stockByWarehouse: i.stock_by_warehouse,
          purchaseUnit: i.purchase_unit ?? undefined
        };
        setItems(prev => {
          const exists = prev.find(item => item.id === mapped.id);
          if (exists) return prev.map(item => item.id === mapped.id ? mapped : item);
          return [...prev, mapped];
        });
      } else if (event.eventType === 'DELETE') {
        setItems(prev => prev.filter(item => item.id !== event.oldRecord.id));
      }
    });

    // ── Transactions ──
    const unsubTx = realtimeService.on('transactions', (event) => {
      if (event.eventType === 'INSERT' || event.eventType === 'UPDATE') {
        const t = event.newRecord;
        const mapped = {
          ...t, sourceWarehouseId: t.source_warehouse_id, targetWarehouseId: t.target_warehouse_id, supplierId: t.supplier_id, requesterId: t.requester_id, approverId: t.approver_id, relatedRequestId: t.related_request_id, pendingItems: t.pending_items
        };
        setTransactions(prev => {
          const exists = prev.find(tx => tx.id === mapped.id);
          if (exists) return prev.map(tx => tx.id === mapped.id ? mapped : tx);
          return [mapped, ...prev];
        });
      } else if (event.eventType === 'DELETE') {
        setTransactions(prev => prev.filter(tx => tx.id !== event.oldRecord.id));
      }
    });

    // ── Warehouses ──
    const unsubWh = realtimeService.on('warehouses', (event) => {
      if (event.eventType === 'INSERT' || event.eventType === 'UPDATE') {
        const w = event.newRecord;
        const mapped = { ...w, isArchived: w.is_archived };
        setWarehouses(prev => {
          const exists = prev.find(wh => wh.id === mapped.id);
          if (exists) return prev.map(wh => wh.id === mapped.id ? mapped : wh);
          return [...prev, mapped];
        });
      } else if (event.eventType === 'DELETE') {
        setWarehouses(prev => prev.filter(wh => wh.id !== event.oldRecord.id));
      }
    });

    // ── Suppliers ──
    const unsubSup = realtimeService.on('suppliers', (event) => {
      if (event.eventType === 'INSERT' || event.eventType === 'UPDATE') {
        const s = event.newRecord;
        const mapped = { ...s, contactPerson: s.contact_person };
        setSuppliers(prev => {
          const exists = prev.find(sup => sup.id === mapped.id);
          if (exists) return prev.map(sup => sup.id === mapped.id ? mapped : sup);
          return [...prev, mapped];
        });
      } else if (event.eventType === 'DELETE') {
        setSuppliers(prev => prev.filter(sup => sup.id !== event.oldRecord.id));
      }
    });

    // ── Requests ──
    const unsubReq = realtimeService.on('requests', (event) => {
      if (event.eventType === 'INSERT' || event.eventType === 'UPDATE') {
        const r = event.newRecord;
        const mapped = {
          ...r, siteWarehouseId: r.site_warehouse_id, sourceWarehouseId: r.source_warehouse_id, requesterId: r.requester_id, createdDate: r.created_date, expectedDate: r.expected_date
        };
        setRequests(prev => {
          const exists = prev.find(req => req.id === mapped.id);
          if (exists) return prev.map(req => req.id === mapped.id ? mapped : req);
          return [mapped, ...prev];
        });
      } else if (event.eventType === 'DELETE') {
        setRequests(prev => prev.filter(req => req.id !== event.oldRecord.id));
      }
    });

    // ── Activities ──
    const unsubAct = realtimeService.on('activities', (event) => {
      if (event.eventType === 'INSERT') {
        const a = event.newRecord;
        const mapped = {
          ...a, userId: a.user_id, userName: a.user_name, userAvatar: a.user_avatar, warehouseId: a.warehouse_id
        };
        setActivities(prev => [mapped, ...prev].slice(0, 50));
      }
    });

    // ── Users ──
    const unsubUsers = realtimeService.on('users', (event) => {
      if (event.eventType === 'INSERT' || event.eventType === 'UPDATE') {
        const u = event.newRecord;
        const mapped = { ...u, assignedWarehouseId: u.assigned_warehouse_id, allowedModules: u.allowed_modules || undefined, adminModules: u.admin_modules || undefined, allowedSubModules: u.allowed_sub_modules || undefined, adminSubModules: u.admin_sub_modules || undefined };
        setUsers(prev => {
          const exists = prev.find(user => user.id === mapped.id);
          if (exists) return prev.map(user => user.id === mapped.id ? mapped : user);
          return [...prev, mapped];
        });
      } else if (event.eventType === 'DELETE') {
        setUsers(prev => prev.filter(user => user.id !== event.oldRecord.id));
      }
    });

    // ── Employees ──
    const unsubEmp = realtimeService.on('employees', (event) => {
      if (event.eventType === 'INSERT' || event.eventType === 'UPDATE') {
        const e = event.newRecord;
        const mappedEmp: Employee = {
          id: e.id, employeeCode: e.employee_code, fullName: e.full_name, title: e.title,
          gender: e.gender, phone: e.phone, email: e.email, dateOfBirth: e.date_of_birth,
          startDate: e.start_date, officialDate: e.official_date, status: e.status,
          userId: e.user_id, areaId: e.area_id, officeId: e.office_id,
          employeeTypeId: e.employee_type_id, positionId: e.position_id,
          salaryPolicyId: e.salary_policy_id, workScheduleId: e.work_schedule_id,
          constructionSiteId: e.construction_site_id, departmentId: e.department_id,
          factoryId: e.factory_id, maritalStatus: e.marital_status,
          avatarUrl: e.avatar_url, createdAt: e.created_at, updatedAt: e.updated_at
        };
        setEmployees(prev => {
          const exists = prev.find(emp => emp.id === mappedEmp.id);
          if (exists) return prev.map(emp => emp.id === mappedEmp.id ? mappedEmp : emp);
          return [...prev, mappedEmp];
        });
      } else if (event.eventType === 'DELETE') {
        setEmployees(prev => prev.filter(emp => emp.id !== event.oldRecord.id));
      }
    });

    // ── Categories ──
    const unsubCat = realtimeService.on('categories', (event) => {
      if (event.eventType === 'INSERT' || event.eventType === 'UPDATE') {
        const c = event.newRecord;
        setCategories(prev => {
          const exists = prev.find(cat => cat.id === c.id);
          if (exists) return prev.map(cat => cat.id === c.id ? c : cat);
          return [...prev, c];
        });
      } else if (event.eventType === 'DELETE') {
        setCategories(prev => prev.filter(cat => cat.id !== event.oldRecord.id));
      }
    });

    // ── Units ──
    const unsubUnits = realtimeService.on('units', (event) => {
      if (event.eventType === 'INSERT' || event.eventType === 'UPDATE') {
        const u = event.newRecord;
        setUnits(prev => {
          const exists = prev.find(unit => unit.id === u.id);
          if (exists) return prev.map(unit => unit.id === u.id ? u : unit);
          return [...prev, u];
        });
      } else if (event.eventType === 'DELETE') {
        setUnits(prev => prev.filter(unit => unit.id !== event.oldRecord.id));
      }
    });

    // ── App Settings ──
    const unsubSettings = realtimeService.on('app_settings', (event) => {
      if (event.eventType === 'UPDATE') {
        setAppSettings(event.newRecord as AppSettings);
      }
    });

    // ── Org Units ──
    const unsubOrg = realtimeService.on('org_units', (event) => {
      if (event.eventType === 'INSERT' || event.eventType === 'UPDATE') {
        const u = event.newRecord;
        const mapped: OrgUnit = { id: u.id, name: u.name, type: u.type, parentId: u.parent_id, description: u.description, orderIndex: u.order_index, createdAt: u.created_at };
        setOrgUnits(prev => {
          const exists = prev.find(ou => ou.id === mapped.id);
          if (exists) return prev.map(ou => ou.id === mapped.id ? mapped : ou);
          return [...prev, mapped];
        });
      } else if (event.eventType === 'DELETE') {
        setOrgUnits(prev => prev.filter(ou => ou.id !== event.oldRecord.id));
      }
    });

    // Connect to all critical tables
    realtimeService.connect(CRITICAL_TABLES);

    return () => {
      unsubStatus();
      unsubWildcard();
      unsubItems(); unsubTx(); unsubWh(); unsubSup(); unsubReq();
      unsubAct(); unsubUsers(); unsubEmp(); unsubCat(); unsubUnits();
      unsubSettings(); unsubOrg();
      realtimeService.disconnect();
    };
  }, []);

  // ==================== LAZY MODULE DATA LOADING ====================
  const fetchTableHelper = async (table: string, query: any = supabase.from(table).select('*')) => {
    try {
      const { data, error } = await query;
      if (error) { console.warn(`Error fetching ${table}:`, error.message); return null; }
      return data;
    } catch (e) { console.warn(`Exception fetching ${table}:`, e); return null; }
  };

  const normalizeProjectTransaction = (row: any): ProjectTransaction => ({
    ...row,
    projectId: row.projectId ?? row.project_id ?? null,
    projectFinanceId: row.projectFinanceId ?? row.project_finance_id,
    constructionSiteId: row.constructionSiteId ?? row.construction_site_id,
    sourceRef: row.sourceRef ?? row.source_ref,
    createdAt: row.createdAt ?? row.created_at,
  });

  const projectTransactionPayload = (tx: ProjectTransaction) => ({
    ...tx,
    project_id: tx.projectId || null,
    project_finance_id: tx.projectFinanceId || null,
    construction_site_id: tx.constructionSiteId || null,
  });

  const loadModuleData = useCallback(async (module: AppModule) => {
    if (!isSupabaseConfigured || loadedModulesRef.current.has(module)) return;
    loadedModulesRef.current.add(module);

    try {
      if (module === 'wms') {
        const [itemsData, whData, supData, txData, reqData, actData, catData, unitData, lossNormsData, auditSessionsData] = await Promise.all([
          fetchTableHelper('items'),
          fetchTableHelper('warehouses'),
          fetchTableHelper('suppliers'),
          fetchTableHelper('transactions', supabase.from('transactions').select('*').order('date', { ascending: false })),
          fetchTableHelper('requests', supabase.from('requests').select('*').order('created_date', { ascending: false })),
          fetchTableHelper('activities', supabase.from('activities').select('*').order('timestamp', { ascending: false }).limit(50)),
          fetchTableHelper('categories'),
          fetchTableHelper('units'),
          fetchTableHelper('loss_norms'),
          fetchTableHelper('audit_sessions', supabase.from('audit_sessions').select('*').order('date', { ascending: false })),
        ]);
        if (itemsData) setItems(itemsData.map(mapInventoryItemFromDb));
        if (whData) setWarehouses(whData.map((w: any) => ({ ...w, isArchived: w.is_archived })));
        if (supData) setSuppliers(supData.map((s: any) => ({ ...s, contactPerson: s.contact_person })));
        if (txData) setTransactions(txData.map(mapTransactionFromDb));
        if (reqData) setRequests(reqData.map((r: any) => ({
          ...r,
          siteWarehouseId: r.site_warehouse_id,
          sourceWarehouseId: r.source_warehouse_id,
          requesterId: r.requester_id,
          createdDate: r.created_date,
          expectedDate: r.expected_date,
        })));
        if (actData) setActivities(actData.map((a: any) => ({
          ...a,
          userId: a.user_id,
          userName: a.user_name,
          userAvatar: a.user_avatar,
          warehouseId: a.warehouse_id,
        })));
        if (catData) setCategories(catData);
        if (unitData) setUnits(unitData);
        if (lossNormsData) setLossNorms(lossNormsData.map((n: any) => ({
          id: n.id,
          itemId: n.item_id,
          categoryId: n.category_id,
          lossType: n.loss_type,
          allowedPercentage: n.allowed_percentage,
          period: n.period,
          createdBy: n.created_by,
          createdAt: n.created_at,
        })));
        if (auditSessionsData) setAuditSessions(auditSessionsData);
      } else if (module === 'hrm') {
        const [
          empData, areasData, officesData, empTypesData, positionsData, salaryData, schedulesData, constructionSitesData, orgUnitsData,
          leaveBalData, leaveReqData, attendData, payrollData, contractData, payrollTplData, holidayData, salaryHistData, shiftTypesData, empShiftsData
        ] = await Promise.all([
          fetchTableHelper('employees'),
          fetchTableHelper('hrm_areas'),
          fetchTableHelper('hrm_offices'),
          fetchTableHelper('hrm_employee_types'),
          fetchTableHelper('hrm_positions'),
          fetchTableHelper('hrm_salary_policies'),
          fetchTableHelper('hrm_work_schedules'),
          fetchTableHelper('hrm_construction_sites'),
          fetchTableHelper('org_units'),
          fetchTableHelper('hrm_leave_balances'),
          fetchTableHelper('hrm_leave_requests'),
          fetchTableHelper('hrm_attendance'),
          fetchTableHelper('hrm_payrolls'),
          fetchTableHelper('hrm_labor_contracts'),
          fetchTableHelper('hrm_payroll_templates'),
          fetchTableHelper('hrm_holidays'),
          fetchTableHelper('hrm_salary_history'),
          fetchTableHelper('hrm_shift_types'),
          fetchTableHelper('hrm_employee_shifts'),
        ]);
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
            avatarUrl: e.avatar_url,
            orgUnitId: e.org_unit_id || undefined,
            createdAt: e.created_at,
            updatedAt: e.updated_at,
          })));
        }
        if (areasData) setHrmAreas(areasData);
        if (officesData) setHrmOffices(officesData);
        if (empTypesData) setHrmEmployeeTypes(empTypesData);
        if (positionsData) setHrmPositions(positionsData);
        if (salaryData) setHrmSalaryPolicies(salaryData);
        if (schedulesData) setHrmWorkSchedules(schedulesData.map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          morningStart: s.morning_start,
          morningEnd: s.morning_end,
          afternoonStart: s.afternoon_start,
          afternoonEnd: s.afternoon_end,
          createdAt: s.created_at,
        })));
        if (constructionSitesData) setHrmConstructionSites(constructionSitesData);
        if (orgUnitsData) {
          const units = orgUnitsData.map((u: any) => ({
            id: u.id,
            name: u.name,
            type: u.type,
            customTypeLabel: u.customTypeLabel || undefined,
            parentId: u.parent_id,
            description: u.description,
            orderIndex: u.order_index,
            createdAt: u.created_at,
          }));

          if (!units.some((u: OrgUnit) => u.type === 'factory')) {
            const root = units.find((u: OrgUnit) => !u.parentId && u.type === 'company');
            if (root) {
              const factId = 'mock-factory-1';
              units.push({ id: factId, name: 'Nhà máy Sản xuất', type: 'factory', orderIndex: 99, parentId: root.id });
              units.push({ id: 'mock-fact-room-1', name: 'Xưởng Lắp Ráp', type: 'department', orderIndex: 1, parentId: factId });
              units.push({ id: 'mock-fact-room-2', name: 'Kho Bán thành phẩm', type: 'department', orderIndex: 2, parentId: factId });
            }
          }
          setOrgUnits(units);
        }
        if (leaveBalData) setLeaveBalances(leaveBalData);
        if (leaveReqData) setLeaveRequests(leaveReqData);
        const leaveLogData = await fetchTableHelper('hrm_leave_logs');
        if (leaveLogData) setLeaveLogs(leaveLogData);
        if (attendData) setAttendanceRecords(attendData);
        if (payrollData) setPayrollRecords(payrollData);
        if (contractData) setLaborContracts(contractData);
        if (payrollTplData) setPayrollTemplates(payrollTplData);
        if (holidayData) setHolidays(holidayData);
        if (salaryHistData) setSalaryHistory(salaryHistData);
        if (shiftTypesData) setShiftTypes(shiftTypesData.map((s: any) => ({
          id: s.id, name: s.name,
          startTime: s.start_time, endTime: s.end_time,
          breakMinutes: s.break_minutes, graceLateMins: s.grace_late_minutes,
          graceEarlyMins: s.grace_early_minutes, standardWorkingHours: s.standard_working_hours,
          otMultiplierNormal: s.ot_multiplier_normal, otMultiplierWeekend: s.ot_multiplier_weekend,
          otMultiplierHoliday: s.ot_multiplier_holiday, nightShiftPremium: s.night_shift_premium,
          isNightShift: s.is_night_shift, color: s.color, isActive: s.is_active,
          createdAt: s.created_at,
        })));
        if (empShiftsData) setEmployeeShifts(empShiftsData.map((s: any) => ({
          id: s.id, employeeId: s.employee_id, shiftTypeId: s.shift_type_id,
          shiftDate: s.shift_date, isDayOff: s.is_day_off, note: s.note,
          createdAt: s.created_at,
        })));
        const proposalData = await fetchTableHelper('hrm_attendance_proposals');
        if (proposalData) setAttendanceProposals(proposalData);

        // ── T6: Tích lũy phép năm ──────────────────────────────────────────────
        // Logic tích lũy phép đã được chuyển lên Supabase Postgres Trigger:
        //   Function: accrue_leave_balances()
        //   Trigger: trg_accrue_leave_on_load (AFTER INSERT/UPDATE ON hrm_leave_balances)
        // Xem hướng dẫn tạo trigger tại: /docs/supabase-triggers.md
        // Không chạy accrual ở client để tránh race condition nhiều tab cùng cộng phép.

      } else if (module === 'ts') {
        const [assetsData, assetCatData, assetAssignData, assetMaintData, assetLocationData, assetTxData] = await Promise.all([
          fetchTableHelper('assets'),
          fetchTableHelper('asset_categories'),
          fetchTableHelper('asset_assignments', supabase.from('asset_assignments').select('*').order('date', { ascending: false })),
          fetchTableHelper('asset_maintenances', supabase.from('asset_maintenances').select('*').order('start_date', { ascending: false })),
          fetchTableHelper('asset_location_stocks'),
          fetchTableHelper('asset_transfers', supabase.from('asset_transfers').select('*').order('date', { ascending: false })),
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
          imageUrl: a.image_url, createdAt: a.created_at, updatedAt: a.updated_at,
          // New fields (Phase 4)
          assetType: a.asset_type || 'single',
          quantity: a.quantity || 1,
          unit: a.unit || 'Cái',
          parentId: a.parent_id || undefined,
          childIndex: a.child_index || undefined,
          isBundle: a.is_bundle || false,
          assetOrigin: a.asset_origin || 'purchase',
          contractNumber: a.contract_number || undefined,
          invoiceNumber: a.invoice_number || undefined,
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
        if (assetLocationData) setAssetLocationStocks(assetLocationData.map((l: any) => ({
          ...l, assetId: l.asset_id, warehouseId: l.warehouse_id,
          constructionSiteId: l.construction_site_id, deptId: l.dept_id,
          assignedToUserId: l.assigned_to_user_id, assignedToName: l.assigned_to_name,
          updatedAt: l.updated_at
        })));
        if (assetTxData) setAssetTransfers(assetTxData.map((t: any) => ({
          ...t, assetId: t.asset_id, assetCode: t.asset_code, assetName: t.asset_name,
          fromWarehouseId: t.from_warehouse_id, fromSiteId: t.from_site_id, fromDeptId: t.from_dept_id,
          fromLocationLabel: t.from_location_label, toWarehouseId: t.to_warehouse_id,
          toSiteId: t.to_site_id, toDeptId: t.to_dept_id, toLocationLabel: t.to_location_label,
          receivedByUserId: t.received_by_user_id, receivedByName: t.received_by_name,
          performedBy: t.performed_by, performedByName: t.performed_by_name,
          createdAt: t.created_at
        })));
      } else if (module === 'da') {
        const [constructionSitesData, projectFinancesData, projectTxData] = await Promise.all([
          fetchTableHelper('hrm_construction_sites'),
          fetchTableHelper('project_finances'),
          fetchTableHelper('project_transactions', supabase.from('project_transactions').select('*').order('date', { ascending: false })),
        ]);
        if (constructionSitesData) setHrmConstructionSites(constructionSitesData);
        if (projectFinancesData) setProjectFinances(projectFinancesData);
        if (projectTxData) setProjectTransactions(projectTxData.map(normalizeProjectTransaction));
      } else if (module === 'ex') {
        const [budgetCatData, budgetEntData, expRecData] = await Promise.all([
          fetchTableHelper('budget_categories'),
          fetchTableHelper('budget_entries'),
          fetchTableHelper('expense_records'),
        ]);
        if (budgetCatData) setBudgetCategories(budgetCatData);
        if (budgetEntData) setBudgetEntries(budgetEntData);
        if (expRecData) setExpenseRecords(expRecData);
      }
    } catch (error) {
      console.error(`Error lazy-loading module "${module}":`, error);
      loadedModulesRef.current.delete(module); // Allow retry on error
    }
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
          admin_modules: data.adminModules || null,
          allowed_sub_modules: data.allowedSubModules || null,
          admin_sub_modules: data.adminSubModules || null
        };
      } else if (table === 'employees') {
        payload = {
          id: data.id,
          employee_code: data.employeeCode || null,  // null = trigger auto-generates TT00x
          full_name: data.fullName, title: data.title || null,
          gender: data.gender || null, phone: data.phone || null, email: data.email || null,
          date_of_birth: data.dateOfBirth || null,   // empty string → null for date column
          start_date: data.startDate || null,         // empty string → null for date column
          official_date: data.officialDate || null,   // empty string → null for date column
          status: data.status || 'Đang làm việc',
          user_id: data.userId || null,               // empty string → null for uuid FK
          area_id: data.areaId || null, office_id: data.officeId || null, employee_type_id: data.employeeTypeId || null,
          position_id: data.positionId || null, salary_policy_id: data.salaryPolicyId || null,
          work_schedule_id: data.workScheduleId || null, construction_site_id: data.constructionSiteId || null,
          department_id: data.departmentId || null, factory_id: data.factoryId || null,
          marital_status: data.maritalStatus || null,
          avatar_url: data.avatarUrl || null,
          org_unit_id: data.orgUnitId || null,        // FK → org_units.id for 3D map
          salary_grade_id: data.salaryGradeId || null
        };
      } else if (table === 'org_units') {
        payload = {
          id: data.id, name: data.name, type: data.type, "customTypeLabel": data.customTypeLabel || null,
          parent_id: data.parentId || null, description: data.description || '', order_index: data.orderIndex || 0
        };
      } else if (table === 'assets') {
        payload = assetToDbPayload(data);
      } else if (table === 'asset_location_stocks') {
        payload = {
          id: data.id, asset_id: data.assetId, warehouse_id: data.warehouseId || null,
          construction_site_id: data.constructionSiteId || null, dept_id: data.deptId || null,
          qty: data.qty, assigned_to_user_id: data.assignedToUserId || null,
          assigned_to_name: data.assignedToName || null, note: data.note || null,
          updated_at: data.updatedAt
        };
      } else if (table === 'asset_transfers') {
        payload = {
          id: data.id, code: data.code, asset_id: data.assetId, asset_code: data.assetCode || null,
          asset_name: data.assetName || null, qty: data.qty,
          from_warehouse_id: data.fromWarehouseId || null, from_site_id: data.fromSiteId || null,
          from_dept_id: data.fromDeptId || null, from_location_label: data.fromLocationLabel || null,
          to_warehouse_id: data.toWarehouseId || null, to_site_id: data.toSiteId || null,
          to_dept_id: data.toDeptId || null, to_location_label: data.toLocationLabel || null,
          received_by_user_id: data.receivedByUserId || null, received_by_name: data.receivedByName || null,
          date: data.date, reason: data.reason || null, status: data.status,
          performed_by: data.performedBy || null, performed_by_name: data.performedByName || null,
          note: data.note || null, created_at: data.createdAt
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
        // For Vioo we can fetch the user by username to get the email, then login.

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

        const mappedUser = { ...userData, assignedWarehouseId: userData.assigned_warehouse_id, allowedModules: userData.allowed_modules || undefined, adminModules: userData.admin_modules || undefined, allowedSubModules: userData.allowed_sub_modules || undefined, adminSubModules: userData.admin_sub_modules || undefined };
        setUser(mappedUser);
        const { avatar, ...userForStorage } = mappedUser;
        localStorage.setItem('vioo_user', JSON.stringify(userForStorage));
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
        localStorage.setItem('vioo_user', JSON.stringify(userForStorage));
        return foundUser;
      }
      return null;
    }
  };

  const logout = () => {
    localStorage.removeItem('vioo_user');
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

  const addUser = async (u: User) => {
    setUsers(prev => [...prev, u]);
    syncToSupabase('users', u);
    logActivity('SYSTEM', 'Thêm người dùng', `Đã thêm người dùng mới: ${u.name}`, 'SUCCESS');

    // Auto-sync: tạo hồ sơ nhân sự từ thông tin người dùng (Họ tên, Email, SĐT)
    const existingEmployee = employees.find(e => e.userId === u.id || e.email === u.email);
    if (!existingEmployee) {
      // Lấy mã nhân viên từ PostgreSQL sequence (mã duy nhất vĩnh viễn, không bao giờ tái sử dụng)
      let employeeCode = `TT${String(employees.length + 1).padStart(3, '0')}`; // fallback
      if (isSupabaseConfigured) {
        try {
          const { data, error } = await supabase.rpc('get_next_employee_code');
          if (!error && data) employeeCode = data;
        } catch (err) {
          console.warn('⚠️ Fallback employee code (RPC failed):', err);
        }
      }
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
    auditService.log({ tableName: 'items', recordId: item.id, action: 'INSERT', newData: item as any, userId: user.id, userName: user.name || user.username });
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
    const oldItem = items.find(i => i.id === item.id);
    setItems(prev => prev.map(i => i.id === item.id ? item : i));
    syncToSupabase('items', item);
    auditService.log({ tableName: 'items', recordId: item.id, action: 'UPDATE', oldData: oldItem as any, newData: item as any, userId: user.id, userName: user.name || user.username });
  };

  const removeItem = async (id: string) => {
    const oldItem = items.find(i => i.id === id);
    setItems(prev => prev.filter(i => i.id !== id));
    if (isSupabaseConfigured) {
      await supabase.from('items').delete().eq('id', id);
    }
    if (oldItem) auditService.log({ tableName: 'items', recordId: id, action: 'DELETE', oldData: oldItem as any, userId: user.id, userName: user.name || user.username });
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

  const updateTransactionStatus = async (id: string, status: TransactionStatus, approverId?: string) => {
    if (isSupabaseConfigured) {
      const tx = transactions.find(t => t.id === id);
      const { data, error } = await supabase.rpc('process_transaction_status', {
        p_transaction_id: id,
        p_status: status,
        p_approver_id: approverId || user.id,
      });
      if (error) {
        console.error('Error processing transaction status:', error);
        return;
      }

      if (data) setTransactions(prev => prev.map(t => t.id === id ? mapTransactionFromDb(data) : t));

      const { data: itemsData, error: itemsError } = await supabase.from('items').select('*');
      if (itemsError) console.error('Error refreshing items after transaction:', itemsError);
      else if (itemsData) setItems(itemsData.map(mapInventoryItemFromDb));

      const whId = tx?.targetWarehouseId || tx?.sourceWarehouseId;
      logActivity('TRANSACTION', `Cập nhật phiếu`, `Phiếu mã ${id.slice(-6)} chuyển sang ${status}`, status === TransactionStatus.COMPLETED ? 'SUCCESS' : 'INFO', whId);
      return;
    }

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
    auditService.log({ tableName: 'warehouses', recordId: w.id, action: 'INSERT', newData: w as any, userId: user.id, userName: user.name || user.username });
  };

  const updateWarehouse = (w: Warehouse) => {
    const oldWh = warehouses.find(item => item.id === w.id);
    setWarehouses(prev => prev.map(item => item.id === w.id ? w : item));
    syncToSupabase('warehouses', w);
    logActivity('SYSTEM', 'Cập nhật kho bãi', `Đã cập nhật thông tin kho: ${w.name}`, 'INFO');
    auditService.log({ tableName: 'warehouses', recordId: w.id, action: 'UPDATE', oldData: oldWh as any, newData: w as any, userId: user.id, userName: user.name || user.username });
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
      auditService.log({ tableName: 'warehouses', recordId: id, action: 'UPDATE', oldData: warehouse as any, newData: updatedWh as any, userId: user.id, userName: user.name || user.username, description: `Lưu trữ kho: ${warehouse.name} (còn tồn kho)` });
    } else {
      setWarehouses(prev => prev.filter(w => w.id !== id));
      if (isSupabaseConfigured) await supabase.from('warehouses').delete().eq('id', id);
      logActivity('SYSTEM', 'Xóa kho bãi', `Đã xóa hoàn toàn kho: ${warehouse.name}`, 'DANGER');
      auditService.log({ tableName: 'warehouses', recordId: id, action: 'DELETE', oldData: warehouse as any, userId: user.id, userName: user.name || user.username });
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
    auditService.log({ tableName: 'suppliers', recordId: s.id, action: 'INSERT', newData: s as any, userId: user.id, userName: user.name || user.username });
  };

  const updateSupplier = (s: Supplier) => {
    const oldSup = suppliers.find(item => item.id === s.id);
    setSuppliers(prev => prev.map(item => item.id === s.id ? s : item));
    syncToSupabase('suppliers', s);
    auditService.log({ tableName: 'suppliers', recordId: s.id, action: 'UPDATE', oldData: oldSup as any, newData: s as any, userId: user.id, userName: user.name || user.username });
  };

  const removeSupplier = async (id: string) => {
    const oldSup = suppliers.find(s => s.id === id);
    setSuppliers(prev => prev.filter(s => s.id !== id));
    if (isSupabaseConfigured) await supabase.from('suppliers').delete().eq('id', id);
    if (oldSup) auditService.log({ tableName: 'suppliers', recordId: id, action: 'DELETE', oldData: oldSup as any, userId: user.id, userName: user.name || user.username });
  };

  const addEmployee = (e: Employee) => {
    setEmployees(prev => [...prev, e]);
    syncToSupabase('employees', e);
    logActivity('SYSTEM', 'Thêm nhân sự', `Đã thêm hồ sơ nhân sự mới: ${e.fullName}`, 'SUCCESS');
    auditService.log({ tableName: 'employees', recordId: e.id, action: 'INSERT', newData: e as any, userId: user.id, userName: user.name || user.username });
  };

  const updateEmployee = (e: Employee) => {
    const oldEmp = employees.find(emp => emp.id === e.id);
    setEmployees(prev => prev.map(item => item.id === e.id ? e : item));
    syncToSupabase('employees', e);
    logActivity('SYSTEM', 'Cập nhật nhân sự', `Đã cập nhật thông tin nhân sự: ${e.fullName}`, 'INFO');
    auditService.log({ tableName: 'employees', recordId: e.id, action: 'UPDATE', oldData: oldEmp as any, newData: e as any, userId: user.id, userName: user.name || user.username });
  };

  const removeEmployee = async (id: string) => {
    const e = employees.find(emp => emp.id === id);
    setEmployees(prev => prev.filter(emp => emp.id !== id));
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase.from('employees').delete().eq('id', id);
        if (error) {
          // Restore employee back to state if delete failed
          if (e) setEmployees(prev => [...prev, e]);
          console.error('Error deleting employee from Supabase:', error.message);
          alert(`Xoá nhân sự thất bại: ${error.message}`);
          return;
        }
      }
      if (e) logActivity('SYSTEM', 'Xóa nhân sự', `Đã xóa hồ sơ nhân sự: ${e.fullName}`, 'DANGER');
    } catch (error: any) {
      // Restore employee back to state on exception
      if (e) setEmployees(prev => [...prev, e]);
      console.error('Error deleting employee from Supabase:', error);
      alert(`Xoá nhân sự thất bại: ${error.message || 'Lỗi không xác định'}`);
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
    'hrm_shift_types': setShiftTypes,
    'hrm_employee_shifts': setEmployeeShifts,
  };

  // Convert camelCase → snake_case for specific tables
  const toDbItem = (table: string, item: any): any => {
    if (table === 'hrm_work_schedules') {
      return {
        id: item.id, name: item.name, description: item.description,
        morning_start: item.morningStart || null, morning_end: item.morningEnd || null,
        afternoon_start: item.afternoonStart || null, afternoon_end: item.afternoonEnd || null,
        created_at: item.createdAt,
      };
    }
    if (table === 'hrm_shift_types') {
      return {
        id: item.id, name: item.name,
        start_time: item.startTime, end_time: item.endTime,
        break_minutes: item.breakMinutes, grace_late_minutes: item.graceLateMins,
        grace_early_minutes: item.graceEarlyMins, standard_working_hours: item.standardWorkingHours,
        ot_multiplier_normal: item.otMultiplierNormal, ot_multiplier_weekend: item.otMultiplierWeekend,
        ot_multiplier_holiday: item.otMultiplierHoliday, night_shift_premium: item.nightShiftPremium,
        is_night_shift: item.isNightShift, color: item.color, is_active: item.isActive,
        created_at: item.createdAt,
      };
    }
    if (table === 'hrm_employee_shifts') {
      return {
        id: item.id, employee_id: item.employeeId, shift_type_id: item.shiftTypeId,
        shift_date: item.shiftDate || null, is_day_off: item.isDayOff,
        note: item.note || null, created_at: item.createdAt,
      };
    }
    return item;
  };

  const addHrmItem = async (table: string, item: any) => {
    const setter = hrmSetterMap[table];
    if (!setter) return;
    setter((prev: any[]) => [...prev, item]);
    if (isSupabaseConfigured) {
      const { error } = await supabase.from(table).insert(toDbItem(table, item));
      if (error) console.error(`Error adding to ${table}:`, error);
    }
  };

  const updateHrmItem = async (table: string, item: any) => {
    const setter = hrmSetterMap[table];
    if (!setter) return;
    setter((prev: any[]) => prev.map((i: any) => i.id === item.id ? item : i));
    if (isSupabaseConfigured) {
      const { error } = await supabase.from(table).update(toDbItem(table, item)).eq('id', item.id);
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
    auditService.log({ tableName: 'project_finances', recordId: pf.id, action: 'INSERT', newData: pf as any, userId: user.id, userName: user.name || user.username });
  };

  const updateProjectFinance = (pf: ProjectFinance) => {
    const oldPf = projectFinances.find(p => p.id === pf.id);
    setProjectFinances(prev => prev.map(p => p.id === pf.id ? pf : p));
    if (isSupabaseConfigured) {
      supabase.from('project_finances').upsert(pf)
        .then(({ error }) => { if (error) console.error('Error updating project_finance:', error); });
    }
    auditService.log({ tableName: 'project_finances', recordId: pf.id, action: 'UPDATE', oldData: oldPf as any, newData: pf as any, userId: user.id, userName: user.name || user.username });
  };

  const removeProjectFinance = (id: string) => {
    const oldPf = projectFinances.find(p => p.id === id);
    setProjectFinances(prev => prev.filter(p => p.id !== id));
    if (isSupabaseConfigured) {
      supabase.from('project_finances').delete().eq('id', id)
        .then(({ error }) => { if (error) console.error('Error deleting project_finance:', error); });
    }
    if (oldPf) auditService.log({ tableName: 'project_finances', recordId: id, action: 'DELETE', oldData: oldPf as any, userId: user.id, userName: user.name || user.username });
  };

  // ==================== PROJECT TRANSACTIONS CRUD ====================
  const addProjectTransaction = (tx: ProjectTransaction) => {
    setProjectTransactions(prev => [tx, ...prev]);
    if (isSupabaseConfigured) {
      supabase.from('project_transactions').upsert(projectTransactionPayload(tx))
        .then(({ error }) => { if (error) console.error('Error saving project_tx:', error); });
    }
  };

  const addProjectTransactions = (txs: ProjectTransaction[]) => {
    setProjectTransactions(prev => [...txs, ...prev]);
    if (isSupabaseConfigured) {
      supabase.from('project_transactions').upsert(txs.map(projectTransactionPayload))
        .then(({ error }) => { if (error) console.error('Error saving project_txs:', error); });
    }
  };

  const updateProjectTransaction = (tx: ProjectTransaction) => {
    setProjectTransactions(prev => prev.map(t => t.id === tx.id ? tx : t));
    if (isSupabaseConfigured) {
      supabase.from('project_transactions').upsert(projectTransactionPayload(tx))
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
      syncToSupabase('assets', asset);
    }
    logActivity('SYSTEM', 'Thêm tài sản', `Thêm tài sản ${asset.name} (${asset.code})`, 'SUCCESS');
    auditService.log({ tableName: 'assets', recordId: asset.id, action: 'INSERT', newData: asset as any, userId: user.id, userName: user.name || user.username });
  };

  const addAssetWithInitialStock = async (asset: Asset) => {
    const initialQty = Math.max(1, asset.assetType === 'batch' ? (asset.quantity || 1) : 1);
    const initialStock: AssetLocationStock | null = asset.warehouseId ? {
      id: `stock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      assetId: asset.id,
      warehouseId: asset.warehouseId,
      qty: initialQty,
      note: asset.locationNote,
      updatedAt: asset.updatedAt || new Date().toISOString(),
    } : null;

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.rpc('create_asset_with_initial_stock', {
        p_asset: assetToDbPayload(asset),
      });
      if (error) throw error;

      const { data: stockRows, error: stockError } = await supabase
        .from('asset_location_stocks')
        .select('*')
        .eq('asset_id', asset.id);
      if (stockError) throw stockError;

      setAssetLocationStocks(prev => [
        ...prev.filter(s => s.assetId !== asset.id),
        ...(stockRows || []).map(mapAssetLocationStockFromDb),
      ]);
      setAssets(prev => prev.some(a => a.id === asset.id)
        ? prev.map(a => a.id === asset.id ? asset : a)
        : [...prev, asset]
      );

      if (!data) {
        console.warn('create_asset_with_initial_stock returned no asset row');
      }
    } else {
      setAssets(prev => [...prev, asset]);
      if (initialStock) setAssetLocationStocks(prev => [...prev, initialStock]);
    }

    logActivity('SYSTEM', 'Thêm tài sản', `Thêm tài sản ${asset.name} (${asset.code})`, 'SUCCESS');
    auditService.log({ tableName: 'assets', recordId: asset.id, action: 'INSERT', newData: asset as any, userId: user.id, userName: user.name || user.username });
  };

  const updateAsset = (asset: Asset) => {
    const oldAsset = assets.find(a => a.id === asset.id);
    setAssets(prev => prev.map(a => a.id === asset.id ? asset : a));
    if (isSupabaseConfigured) {
      syncToSupabase('assets', asset);
    }
    auditService.log({ tableName: 'assets', recordId: asset.id, action: 'UPDATE', oldData: oldAsset as any, newData: asset as any, userId: user.id, userName: user.name || user.username });
  };

  const removeAsset = (id: string) => {
    const asset = assets.find(a => a.id === id);
    setAssets(prev => prev.filter(a => a.id !== id));
    if (isSupabaseConfigured) {
      supabase.from('assets').delete().eq('id', id).then();
    }
    logActivity('SYSTEM', 'Xóa tài sản', `Xóa tài sản ${asset?.name || id}`, 'WARNING');
    if (asset) auditService.log({ tableName: 'assets', recordId: id, action: 'DELETE', oldData: asset as any, userId: user.id, userName: user.name || user.username });
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

  const addAssetTransfer = (t: AssetTransfer, updatedStocks: AssetLocationStock[]) => {
    setAssetTransfers(prev => [t, ...prev]);
    setAssetLocationStocks(prev => {
      const draft = [...prev];
      for (const stock of updatedStocks) {
        const idx = draft.findIndex(s => s.id === stock.id);
        if (idx !== -1) draft[idx] = stock;
        else draft.push(stock);
      }
      return draft;
    });

    if (isSupabaseConfigured) {
      syncToSupabase('asset_transfers', t);
      updatedStocks.forEach(s => syncToSupabase('asset_location_stocks', s));
    }
    logActivity('SYSTEM', 'Điều chuyển lô', `Điều chuyển ${t.qty} ${t.assetCode} từ ${t.fromLocationLabel} sang ${t.toLocationLabel}`, 'INFO');
  };

  const transferAssetStock = async (args: {
    assetId: string;
    fromStockId: string;
    qty: number;
    toWarehouseId?: string;
    toUserId?: string;
    reason?: string;
    date: string;
  }): Promise<AssetTransfer | null> => {
    if (!isSupabaseConfigured) return null;

    const { data, error } = await supabase.rpc('transfer_asset_stock', {
      p_asset_id: args.assetId,
      p_from_stock_id: args.fromStockId,
      p_qty: args.qty,
      p_to_warehouse_id: args.toWarehouseId || null,
      p_to_user_id: args.toUserId || null,
      p_reason: args.reason || null,
      p_date: args.date,
    });
    if (error) throw error;

    const transfer = mapAssetTransferFromDb(data);
    const { data: stockRows, error: stockError } = await supabase
      .from('asset_location_stocks')
      .select('*')
      .eq('asset_id', args.assetId);
    if (stockError) throw stockError;

    setAssetTransfers(prev => [transfer, ...prev.filter(t => t.id !== transfer.id)]);
    setAssetLocationStocks(prev => [
      ...prev.filter(s => s.assetId !== args.assetId),
      ...(stockRows || []).map(mapAssetLocationStockFromDb),
    ]);
    logActivity('SYSTEM', 'Điều chuyển lô', `Điều chuyển ${transfer.qty} ${transfer.assetCode} từ ${transfer.fromLocationLabel} sang ${transfer.toLocationLabel}`, 'INFO');
    return transfer;
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

  const theme: 'light' | 'dark' =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light';

  return (
    <AppContext.Provider value={{
      user, users, appSettings, theme, setUser, switchUser, addUser, updateUser, removeUser, items, warehouses, suppliers, transactions, requests, activities,
      categories, units, employees,
      hrmAreas, hrmOffices, hrmEmployeeTypes, hrmPositions, hrmSalaryPolicies, hrmWorkSchedules, hrmConstructionSites, constructionSites: hrmConstructionSites,
      shiftTypes, employeeShifts,
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
      assets, assetCategories, assetAssignments, assetMaintenances, assetLocationStocks, assetTransfers,
      addAsset, addAssetWithInitialStock, updateAsset, removeAsset, addAssetCategory, updateAssetCategory, removeAssetCategory,
      addAssetAssignment, addAssetMaintenance, updateAssetMaintenance, addAssetTransfer, transferAssetStock,
      isModuleAdmin, loadModuleData,
      saveSignature, deleteSignature,
      login, logout, isLoading, isRefreshing, connectionError, realtimeStatus, lastRealtimeEvent
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
