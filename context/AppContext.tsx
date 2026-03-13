
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  InventoryItem, Transaction, User, Warehouse, Supplier,
  Role, TransactionStatus, TransactionType, MaterialRequest,
  RequestStatus, AuditLog, GlobalActivity, ActivityType,
  ItemCategory, ItemUnit, Employee, MaterialLossNorm, AuditSession,
  HrmArea, HrmOffice, HrmEmployeeType, HrmPosition, HrmSalaryPolicy, HrmWorkSchedule, HrmConstructionSite,
  OrgUnit
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
  // Loss Management
  lossNorms: MaterialLossNorm[];
  addLossNorm: (norm: MaterialLossNorm) => void;
  updateLossNorm: (norm: MaterialLossNorm) => void;
  removeLossNorm: (id: string) => void;
  // Audit Sessions
  auditSessions: AuditSession[];
  addAuditSession: (session: AuditSession) => void;
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
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [lossNorms, setLossNorms] = useState<MaterialLossNorm[]>([]);
  const [auditSessions, setAuditSessions] = useState<AuditSession[]>([]);
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
          lossNormsData, auditSessionsData
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
          fetchTable('audit_sessions', supabase.from('audit_sessions').select('*').order('date', { ascending: false }))
        ]);

        if (usersData && usersData.length > 0) {
          const mappedUsers = usersData.map((u: any) => ({ ...u, assignedWarehouseId: u.assigned_warehouse_id }));
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
          id: u.id, name: u.name, type: u.type, parentId: u.parent_id,
          description: u.description, orderIndex: u.order_index, createdAt: u.created_at
        })));

        // Loss Norms
        if (lossNormsData) setLossNorms(lossNormsData.map((n: any) => ({
          id: n.id, itemId: n.item_id, categoryId: n.category_id, lossType: n.loss_type,
          allowedPercentage: n.allowed_percentage, period: n.period,
          createdBy: n.created_by, createdAt: n.created_at
        })));

        // Audit Sessions
        if (auditSessionsData) setAuditSessions(auditSessionsData);
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
          const mappedUser = { ...u, assignedWarehouseId: u.assigned_warehouse_id };
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
          phone: data.phone, role: data.role, avatar: data.avatar, assigned_warehouse_id: data.assignedWarehouseId
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
          id: data.id, name: data.name, type: data.type, parent_id: data.parentId || null,
          description: data.description || '', order_index: data.orderIndex || 0
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

        const mappedUser = { ...userData, assignedWarehouseId: userData.assigned_warehouse_id };
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

  return (
    <AppContext.Provider value={{
      user, users, appSettings, setUser, switchUser, addUser, updateUser, removeUser, items, warehouses, suppliers, transactions, requests, activities,
      categories, units, employees,
      hrmAreas, hrmOffices, hrmEmployeeTypes, hrmPositions, hrmSalaryPolicies, hrmWorkSchedules, hrmConstructionSites,
      addHrmItem, updateHrmItem, removeHrmItem,
      orgUnits, addOrgUnit, updateOrgUnit, removeOrgUnit,
      addItem, addItems, updateItem, removeItem, addTransaction, updateTransactionStatus, clearTransactionHistory, addWarehouse, updateWarehouse, removeWarehouse,
      addRequest, updateRequestStatus, logActivity, addCategory, updateCategory, removeCategory, addUnit, updateUnit, removeUnit,
      addSupplier, updateSupplier, removeSupplier, addEmployee, updateEmployee, removeEmployee, updateAppSettings, approvePartialTransaction, clearAllData,
      lossNorms, addLossNorm, updateLossNorm, removeLossNorm,
      auditSessions, addAuditSession,
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
