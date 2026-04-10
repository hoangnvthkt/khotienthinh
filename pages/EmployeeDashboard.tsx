import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useWorkflow } from '../context/WorkflowContext';
import { useRequest } from '../context/RequestContext';
import {
    User as UserIcon, Briefcase, Calendar, MapPin, Clock,
    Award, Hash, ChevronRight, Shield, TrendingUp,
    CheckCircle2, AlertCircle, FileText, GitBranch, Inbox,
    CalendarOff, DollarSign, MessageCircle, Bot,
    ClipboardList, ArrowRight, Zap, Sparkles, CalendarCheck,
    Timer, CircleDot, XCircle, CheckCheck
} from 'lucide-react';
import { WorkflowInstanceStatus, WorkflowNodeType, RQStatus } from '../types';
import { AnimatedNumber, LastUpdated } from '../components/LiveDashboardWidgets';
import DailyMissions from '../components/DailyMissions';
import { getTimeGreeting, getRandomQuote } from '../lib/funMessages';

// ═══════════════════════════════════════════════════════
//  EMPLOYEE DASHBOARD — Mobile-First Todo-List Style
// ═══════════════════════════════════════════════════════

const EmployeeDashboard: React.FC = () => {
    const navigate = useNavigate();
    const {
        user, employees, hrmPositions, hrmOffices, orgUnits,
        attendanceRecords, leaveRequests, leaveBalances, payrollRecords,
        laborContracts, assets, assetAssignments,
        loadModuleData, hrmConstructionSites, lastRealtimeEvent,
    } = useApp();
    const { instances: wfInstances, templates: wfTemplates, nodes: wfNodes } = useWorkflow();
    const { requests: rqRequests, categories: rqCategories } = useRequest();

    // Eagerly load HRM + Asset data on mount
    useEffect(() => {
        loadModuleData('hrm');
        loadModuleData('ts');
    }, [loadModuleData]);

    // ─── Derived Employee Data ───
    const employee = useMemo(() => employees.find(e => e.userId === user.id), [employees, user.id]);
    const position = hrmPositions.find(p => p.id === employee?.positionId);
    const office = hrmOffices.find(o => o.id === employee?.officeId);
    const department = orgUnits.find(u => u.id === employee?.departmentId);
    const constructionSite = hrmConstructionSites.find(cs => cs.id === employee?.constructionSiteId);

    // Thâm niên
    const seniority = useMemo(() => {
        if (!employee?.startDate) return null;
        const start = new Date(employee.startDate);
        const now = new Date();
        const diff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        if (diff < 30) return `${diff} ngày`;
        if (diff < 365) return `${Math.floor(diff / 30)} tháng`;
        const years = Math.floor(diff / 365);
        const months = Math.floor((diff % 365) / 30);
        return months > 0 ? `${years} năm ${months} tháng` : `${years} năm`;
    }, [employee?.startDate]);

    // ─── Attendance Stats (this month) ───
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    const monthlyAttendance = useMemo(() => {
        if (!employee) return { present: 0, absent: 0, late: 0, total: 0 };
        const myRecords = attendanceRecords.filter(r => {
            const d = new Date(r.date);
            return r.employeeId === employee.id && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
        });
        const present = myRecords.filter(r => r.status === 'present' || r.status === 'late').length;
        const late = myRecords.filter(r => r.status === 'late').length;
        const absent = myRecords.filter(r => r.status === 'absent').length;
        return { present, absent, late, total: myRecords.length };
    }, [attendanceRecords, employee, thisMonth, thisYear]);

    // Today's check-in
    const todayStr = now.toISOString().split('T')[0];
    const todayAttendance = useMemo(() => {
        if (!employee) return null;
        return attendanceRecords.find(r => r.employeeId === employee.id && r.date === todayStr);
    }, [attendanceRecords, employee, todayStr]);

    // ─── Leave Balance ───
    const myLeaveBalance = useMemo(() => {
        if (!employee) return null;
        return leaveBalances.find(b => b.employeeId === employee.id && b.year === thisYear);
    }, [leaveBalances, employee, thisYear]);

    const remainingLeave = myLeaveBalance
        ? Math.max(0, (myLeaveBalance.accruedDays || 0) - (myLeaveBalance.usedPaidDays || 0))
        : 0;

    // ─── My Leave Requests ───
    const myLeaveRequests = useMemo(() => {
        if (!employee) return [];
        return leaveRequests.filter(lr => lr.employeeId === employee.id);
    }, [leaveRequests, employee]);

    const pendingLeaveRequests = myLeaveRequests.filter(lr => lr.status === 'pending');

    // ─── Workflow Todo Items (instances where I need to act) ───
    const myWorkflowTodos = useMemo(() => {
        return wfInstances.filter(inst => {
            if (inst.status !== WorkflowInstanceStatus.RUNNING) return false;
            if (!inst.currentNodeId) return false;
            const node = wfNodes.find(n => n.id === inst.currentNodeId);
            if (!node) return false;
            // Check if this node is assigned to me
            if (node.config?.assigneeUserId === user.id) return true;
            if (node.config?.assigneeRole && node.config.assigneeRole === user.role) return true;
            return false;
        });
    }, [wfInstances, wfNodes, user.id, user.role]);

    // Workflow items I created
    const myWorkflowInstances = useMemo(() => {
        return wfInstances.filter(inst => inst.createdBy === user.id);
    }, [wfInstances, user.id]);

    const myRunningWf = myWorkflowInstances.filter(i => i.status === WorkflowInstanceStatus.RUNNING);

    // ─── Request Todo Items (requests where I'm the current approver) ───
    const myRequestTodos = useMemo(() => {
        return rqRequests.filter(req => {
            if (req.status !== RQStatus.PENDING) return false;
            const sorted = [...(req.approvers || [])].sort((a, b) => a.order - b.order);
            const currentStep = sorted.find(a => a.status === 'waiting');
            return currentStep?.userId === user.id;
        });
    }, [rqRequests, user.id]);

    // Request items I created
    const myRequests = useMemo(() => {
        return rqRequests.filter(req => req.createdBy === user.id);
    }, [rqRequests, user.id]);

    const myOpenRequests = myRequests.filter(r =>
        r.status === RQStatus.PENDING || r.status === RQStatus.IN_PROGRESS || r.status === RQStatus.DRAFT
    );

    // ─── Assets assigned to me ───
    const myAssets = useMemo(() => {
        return assets.filter(a => a.assignedToUserId === user.id);
    }, [assets, user.id]);

    // ─── Labor Contract ───
    const myContract = useMemo(() => {
        if (!employee) return null;
        return laborContracts.find(c => c.employeeId === employee.id && c.status === 'active');
    }, [laborContracts, employee]);

    // ─── Combined Todo Count ───
    const totalTodos = myWorkflowTodos.length + myRequestTodos.length;

    // Helper: format date
    const fmtDate = (d?: string) => {
        if (!d) return '';
        return new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const fmtRelative = (d: string) => {
        const diff = now.getTime() - new Date(d).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins} phút trước`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours} giờ trước`;
        const days = Math.floor(hours / 24);
        return `${days} ngày trước`;
    };

    // ─── Stat cards config ───
    const stats = [
        {
            label: 'Ngày công',
            value: monthlyAttendance.present,
            sub: `T${thisMonth + 1}/${thisYear}`,
            icon: <CalendarCheck size={18} />,
            gradient: 'from-teal-500 to-cyan-600',
            shadow: 'shadow-teal-500/30',
            onClick: () => navigate('/hrm/attendance'),
        },
        {
            label: 'Phép còn lại',
            value: remainingLeave,
            sub: `${myLeaveBalance?.usedPaidDays || 0} đã dùng`,
            icon: <CalendarOff size={18} />,
            gradient: 'from-violet-500 to-purple-600',
            shadow: 'shadow-violet-500/30',
            onClick: () => navigate('/hrm/leave'),
        },
        {
            label: 'Quy trình',
            value: myWorkflowTodos.length,
            sub: 'chờ xử lý',
            icon: <GitBranch size={18} />,
            gradient: 'from-amber-500 to-orange-500',
            shadow: 'shadow-amber-500/30',
            onClick: () => navigate('/wf'),
        },
        {
            label: 'Yêu cầu',
            value: myRequestTodos.length,
            sub: 'cần duyệt',
            icon: <Inbox size={18} />,
            gradient: 'from-rose-500 to-pink-600',
            shadow: 'shadow-rose-500/30',
            onClick: () => navigate('/rq'),
        },
    ];

    // ─── Priority config ───
    const priorityConfig: Record<string, { color: string; label: string }> = {
        urgent: { color: 'bg-red-500/15 text-red-500 border-red-500/30', label: 'Khẩn cấp' },
        high: { color: 'bg-orange-500/15 text-orange-500 border-orange-500/30', label: 'Cao' },
        medium: { color: 'bg-blue-500/15 text-blue-500 border-blue-500/30', label: 'Trung bình' },
        low: { color: 'bg-slate-500/15 text-slate-500 border-slate-500/30', label: 'Thấp' },
    };

    const statusConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
        RUNNING: { icon: <Timer size={12} />, color: 'text-blue-500 bg-blue-500/10', label: 'Đang chạy' },
        COMPLETED: { icon: <CheckCheck size={12} />, color: 'text-emerald-500 bg-emerald-500/10', label: 'Hoàn thành' },
        REJECTED: { icon: <XCircle size={12} />, color: 'text-red-500 bg-red-500/10', label: 'Từ chối' },
        CANCELLED: { icon: <XCircle size={12} />, color: 'text-slate-500 bg-slate-500/10', label: 'Đã hủy' },
        PENDING: { icon: <CircleDot size={12} />, color: 'text-amber-500 bg-amber-500/10', label: 'Chờ duyệt' },
        APPROVED: { icon: <CheckCircle2 size={12} />, color: 'text-emerald-500 bg-emerald-500/10', label: 'Đã duyệt' },
        IN_PROGRESS: { icon: <Timer size={12} />, color: 'text-blue-500 bg-blue-500/10', label: 'Đang xử lý' },
        DONE: { icon: <CheckCheck size={12} />, color: 'text-emerald-500 bg-emerald-500/10', label: 'Hoàn thành' },
        DRAFT: { icon: <FileText size={12} />, color: 'text-slate-400 bg-slate-400/10', label: 'Nháp' },
    };

    // ═══════════════════════════════════════════════════════
    //  SECTION COMPONENT: Glass Card Wrapper
    // ═══════════════════════════════════════════════════════
    const SectionCard: React.FC<{ title: string; icon: React.ReactNode; count?: number; children: React.ReactNode; action?: { label: string; onClick: () => void } }> =
        ({ title, icon, count, children, action }) => (
            <div className="rounded-2xl overflow-hidden bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 shadow-lg dark:shadow-slate-900/40 backdrop-blur-xl">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700/50">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500 dark:text-indigo-400">{icon}</span>
                        <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">{title}</h3>
                        {count !== undefined && count > 0 && (
                            <span className="text-[9px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center animate-pulse">{count}</span>
                        )}
                    </div>
                    {action && (
                        <button onClick={action.onClick} className="flex items-center gap-1 text-[10px] font-bold text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors">
                            {action.label} <ArrowRight size={11} />
                        </button>
                    )}
                </div>
                <div className="p-4">{children}</div>
            </div>
        );

    // ═══════════════════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════════════════
    return (
        <div className="max-w-5xl mx-auto space-y-4 pb-8">

            {/* ═══════════ HERO BANNER ═══════════ */}
            <div className="relative rounded-3xl overflow-hidden"
                style={{
                    background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 40%, #24243e 100%)',
                    boxShadow: '0 20px 60px -12px rgba(48,43,99,0.5)',
                }}
            >
                {/* Animated mesh bg */}
                <div className="absolute inset-0 opacity-30">
                    <div className="absolute top-0 -left-4 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-[80px] animate-pulse" style={{ animationDuration: '4s' }} />
                    <div className="absolute top-0 right-0 w-72 h-72 bg-cyan-500 rounded-full mix-blend-multiply filter blur-[80px] animate-pulse" style={{ animationDuration: '6s', animationDelay: '2s' }} />
                    <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-[80px] animate-pulse" style={{ animationDuration: '5s', animationDelay: '1s' }} />
                </div>

                {/* Grid pattern overlay */}
                <div className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
                        backgroundSize: '40px 40px',
                    }}
                />

                <div className="relative px-5 sm:px-8 py-6 sm:py-8">
                    <div className="flex items-center gap-4 sm:gap-6">
                        {/* Avatar */}
                        <div className="relative group shrink-0">
                            <div className="absolute -inset-1 bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 rounded-2xl blur opacity-60 group-hover:opacity-80 transition-opacity duration-500" />
                            <div
                                className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center text-2xl sm:text-3xl font-black text-white overflow-hidden ring-2 ring-white/20 cursor-pointer"
                                onClick={() => navigate('/my-profile')}
                            >
                                {user.avatar
                                    ? <img src={user.avatar} className="w-full h-full object-cover" alt="" />
                                    : (employee?.fullName || user.name || '?').charAt(0).toUpperCase()
                                }
                            </div>
                            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-400 rounded-full border-2 border-[#302b63] shadow-lg shadow-emerald-400/50" />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight drop-shadow-lg truncate cursor-pointer hover:text-indigo-200 transition-colors"
                                onClick={() => navigate('/my-profile')}
                            >
                                {employee?.fullName || user.name}
                            </h1>
                            {/* Time-based greeting */}
                            <p className="text-[11px] text-purple-200/80 font-medium mt-0.5 italic">
                                {getTimeGreeting()}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                {employee?.employeeCode && (
                                    <span className="text-[9px] font-bold text-cyan-300 bg-cyan-400/10 px-2 py-0.5 rounded-md flex items-center gap-1 border border-cyan-400/20">
                                        <Hash size={9} /> {employee.employeeCode}
                                    </span>
                                )}
                                {position && (
                                    <span className="text-[9px] font-bold text-amber-300 bg-amber-400/10 px-2 py-0.5 rounded-md flex items-center gap-1 border border-amber-400/20">
                                        <Award size={9} /> {position.name}
                                    </span>
                                )}
                                {department && (
                                    <span className="text-[9px] font-bold text-emerald-300 bg-emerald-400/10 px-2 py-0.5 rounded-md border border-emerald-400/20">
                                        {department.name}
                                    </span>
                                )}
                                {constructionSite && (
                                    <span className="text-[9px] font-bold text-orange-300 bg-orange-400/10 px-2 py-0.5 rounded-md flex items-center gap-1 border border-orange-400/20">
                                        <MapPin size={9} /> {constructionSite.name}
                                    </span>
                                )}
                            </div>
                            {seniority && (
                                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400">
                                    <TrendingUp size={11} className="text-purple-400" />
                                    <span className="font-bold">Thâm niên: <span className="text-white">{seniority}</span></span>
                                </div>
                            )}
                            <LastUpdated timestamp={lastRealtimeEvent} className="!text-slate-400" />
                        </div>

                        {/* Todo badge */}
                        {totalTodos > 0 && (
                            <div className="hidden sm:flex flex-col items-center px-4 py-3 rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/10 shrink-0">
                                <Zap size={14} className="text-amber-400 mb-1" />
                                <div className="text-2xl font-black text-white">{totalTodos}</div>
                                <div className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400">Việc cần làm</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ═══════════ QUICK STATS ═══════════ */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {stats.map((stat, i) => (
                    <button
                        key={i}
                        onClick={stat.onClick}
                        className="relative group rounded-2xl p-4 text-left transition-all duration-300 hover:scale-[1.03] hover:shadow-xl active:scale-[0.98] bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 shadow-md backdrop-blur-xl overflow-hidden"
                    >
                        <div className={`absolute top-0 right-0 w-16 h-16 rounded-bl-[2rem] bg-gradient-to-br ${stat.gradient} opacity-10 group-hover:opacity-20 transition-opacity`} />
                        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center text-white shadow-lg ${stat.shadow} mb-2 group-hover:scale-110 transition-transform`}>
                            {stat.icon}
                        </div>
                        <div className="text-2xl font-black text-slate-800 dark:text-white"><AnimatedNumber value={stat.value} /></div>
                        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{stat.label}</div>
                        <div className="text-[9px] text-slate-400/70 mt-0.5">{stat.sub}</div>
                        <ChevronRight size={14} className="absolute top-4 right-3 text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors" />
                    </button>
                ))}
            </div>

            {/* ═══════════ DAILY MISSIONS ═══════════ */}
            <DailyMissions />

            {/* ═══════════ TODO: WORKFLOW TASKS ═══════════ */}
            {myWorkflowTodos.length > 0 && (
                <SectionCard title="Quy trình chờ duyệt" icon={<GitBranch size={14} />} count={myWorkflowTodos.length} action={{ label: 'Xem tất cả', onClick: () => navigate('/wf') }}>
                    <div className="space-y-2">
                        {myWorkflowTodos.slice(0, 5).map(inst => {
                            const tmpl = wfTemplates.find(t => t.id === inst.templateId);
                            const currentNode = wfNodes.find(n => n.id === inst.currentNodeId);
                            return (
                                <button
                                    key={inst.id}
                                    onClick={() => navigate('/wf')}
                                    className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:shadow-md group text-left border border-transparent hover:border-violet-200 dark:hover:border-violet-500/20"
                                >
                                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shrink-0 shadow-md shadow-violet-500/20 group-hover:scale-110 transition-transform">
                                        <GitBranch size={15} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-bold text-slate-800 dark:text-white truncate">{inst.title}</div>
                                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                            <span className="text-[9px] font-mono font-bold text-violet-500 bg-violet-500/10 px-1.5 py-0.5 rounded">{inst.code}</span>
                                            {tmpl && <span className="text-[9px] text-slate-400">{tmpl.name}</span>}
                                            {currentNode && <span className="text-[9px] text-amber-500 font-bold">• {currentNode.label}</span>}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className="text-[9px] text-slate-400">{fmtRelative(inst.updatedAt)}</div>
                                        <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 mt-1 ml-auto group-hover:text-violet-500 transition-colors" />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </SectionCard>
            )}

            {/* ═══════════ TODO: REQUEST APPROVALS ═══════════ */}
            {myRequestTodos.length > 0 && (
                <SectionCard title="Yêu cầu cần duyệt" icon={<Inbox size={14} />} count={myRequestTodos.length} action={{ label: 'Xem tất cả', onClick: () => navigate('/rq') }}>
                    <div className="space-y-2">
                        {myRequestTodos.slice(0, 5).map(req => {
                            const cat = rqCategories.find(c => c.id === req.categoryId);
                            const prio = priorityConfig[req.priority] || priorityConfig.medium;
                            return (
                                <button
                                    key={req.id}
                                    onClick={() => navigate('/rq')}
                                    className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 hover:shadow-md group text-left border border-transparent hover:border-cyan-200 dark:hover:border-cyan-500/20"
                                >
                                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shrink-0 shadow-md shadow-cyan-500/20 group-hover:scale-110 transition-transform">
                                        <Inbox size={15} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-bold text-slate-800 dark:text-white truncate">{req.title}</div>
                                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                            <span className="text-[9px] font-mono font-bold text-cyan-500 bg-cyan-500/10 px-1.5 py-0.5 rounded">{req.code}</span>
                                            {cat && <span className="text-[9px] text-slate-400">{cat.name}</span>}
                                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ${prio.color}`}>{prio.label}</span>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className="text-[9px] text-slate-400">{fmtRelative(req.updatedAt)}</div>
                                        <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 mt-1 ml-auto group-hover:text-cyan-500 transition-colors" />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </SectionCard>
            )}

            {/* ═══════════ MY WORKFLOWS ═══════════ */}
            {myWorkflowInstances.length > 0 && (
                <SectionCard title="Quy trình của tôi" icon={<ClipboardList size={14} />} action={{ label: 'Xem tất cả', onClick: () => navigate('/wf') }}>
                    <div className="space-y-2">
                        {myWorkflowInstances.slice(0, 5).map(inst => {
                            const tmpl = wfTemplates.find(t => t.id === inst.templateId);
                            const st = statusConfig[inst.status] || statusConfig.RUNNING;
                            return (
                                <button
                                    key={inst.id}
                                    onClick={() => navigate('/wf')}
                                    className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 group text-left"
                                >
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${st.color} shrink-0`}>
                                        {st.icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{inst.title}</div>
                                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                            <span className="text-[9px] font-mono text-slate-400">{inst.code}</span>
                                            {tmpl && <span className="text-[9px] text-slate-400">• {tmpl.name}</span>}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0 flex flex-col items-end">
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${st.color}`}>{st.label}</span>
                                        <span className="text-[9px] text-slate-400 mt-1">{fmtDate(inst.createdAt)}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </SectionCard>
            )}

            {/* ═══════════ MY REQUESTS ═══════════ */}
            {myRequests.length > 0 && (
                <SectionCard title="Yêu cầu của tôi" icon={<FileText size={14} />} action={{ label: 'Xem tất cả', onClick: () => navigate('/rq') }}>
                    <div className="space-y-2">
                        {myRequests.slice(0, 5).map(req => {
                            const cat = rqCategories.find(c => c.id === req.categoryId);
                            const st = statusConfig[req.status] || statusConfig.PENDING;
                            const prio = priorityConfig[req.priority] || priorityConfig.medium;
                            return (
                                <button
                                    key={req.id}
                                    onClick={() => navigate('/rq')}
                                    className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 group text-left"
                                >
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${st.color} shrink-0`}>
                                        {st.icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{req.title}</div>
                                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                            <span className="text-[9px] font-mono text-slate-400">{req.code}</span>
                                            {cat && <span className="text-[9px] text-slate-400">• {cat.name}</span>}
                                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ${prio.color}`}>{prio.label}</span>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0 flex flex-col items-end">
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${st.color}`}>{st.label}</span>
                                        <span className="text-[9px] text-slate-400 mt-1">{fmtDate(req.createdAt)}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </SectionCard>
            )}

            {/* ═══════════ ATTENDANCE ═══════════ */}
            <SectionCard title="Chấm công tháng này" icon={<Calendar size={14} />} action={{ label: 'Chi tiết', onClick: () => navigate('/hrm/attendance') }}>
                <div className="space-y-4">
                    {/* Today status */}
                    <button
                        onClick={() => navigate('/hrm/checkin')}
                        className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:shadow-md group border border-slate-100 dark:border-slate-700/50 hover:border-emerald-200 dark:hover:border-emerald-500/20 bg-gradient-to-r from-white to-slate-50 dark:from-slate-800 dark:to-slate-800/50"
                    >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md ${todayAttendance
                            ? 'bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-emerald-500/30'
                            : 'bg-gradient-to-br from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-700 text-white shadow-slate-500/20'
                            }`}>
                            {todayAttendance ? <CheckCircle2 size={18} /> : <MapPin size={18} />}
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                            <div className="text-sm font-bold text-slate-800 dark:text-white">
                                {todayAttendance ? 'Đã chấm công hôm nay' : 'Chưa chấm công hôm nay'}
                            </div>
                            {todayAttendance && (
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                    Vào: {todayAttendance.checkIn || '—'} {todayAttendance.checkOut ? `• Ra: ${todayAttendance.checkOut}` : ''}
                                </div>
                            )}
                            {!todayAttendance && (
                                <div className="text-[10px] text-emerald-500 font-bold mt-0.5">Nhấn để chấm công →</div>
                            )}
                        </div>
                        <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 group-hover:text-emerald-500 transition-colors" />
                    </button>

                    {/* Monthly summary bars */}
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { label: 'Có mặt', value: monthlyAttendance.present, color: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-400' },
                            { label: 'Đi trễ', value: monthlyAttendance.late, color: 'bg-amber-500', textColor: 'text-amber-600 dark:text-amber-400' },
                            { label: 'Vắng', value: monthlyAttendance.absent, color: 'bg-red-500', textColor: 'text-red-600 dark:text-red-400' },
                        ].map((item, i) => (
                            <button
                                key={i}
                                onClick={() => navigate('/hrm/attendance')}
                                className="text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-100 dark:border-slate-700/50 hover:shadow-md transition-all hover:scale-[1.03] active:scale-[0.98]"
                            >
                                <div className={`text-xl font-black ${item.textColor}`}>{item.value}</div>
                                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">{item.label}</div>
                                <div className={`w-full h-1 rounded-full bg-slate-200 dark:bg-slate-600 mt-2 overflow-hidden`}>
                                    <div className={`h-full rounded-full ${item.color} transition-all duration-700`}
                                        style={{ width: monthlyAttendance.total > 0 ? `${(item.value / monthlyAttendance.total) * 100}%` : '0%' }}
                                    />
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </SectionCard>

            {/* ═══════════ LEAVE REQUESTS ═══════════ */}
            {myLeaveRequests.length > 0 && (
                <SectionCard title="Đơn nghỉ phép" icon={<CalendarOff size={14} />} count={pendingLeaveRequests.length} action={{ label: 'Quản lý phép', onClick: () => navigate('/hrm/leave') }}>
                    <div className="space-y-2">
                        {myLeaveRequests.slice(0, 4).map(lr => {
                            const leaveStatusMap: Record<string, { color: string; label: string }> = {
                                pending: { color: 'text-amber-500 bg-amber-500/10', label: 'Chờ duyệt' },
                                approved: { color: 'text-emerald-500 bg-emerald-500/10', label: 'Đã duyệt' },
                                rejected: { color: 'text-red-500 bg-red-500/10', label: 'Từ chối' },
                            };
                            const st = leaveStatusMap[lr.status] || leaveStatusMap.pending;
                            return (
                                <button
                                    key={lr.id}
                                    onClick={() => navigate('/hrm/leave')}
                                    className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 group text-left"
                                >
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${st.color} shrink-0`}>
                                        <CalendarOff size={14} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{lr.type || 'Nghỉ phép'}</div>
                                        <div className="text-[10px] text-slate-400">{fmtDate(lr.startDate)} → {fmtDate(lr.endDate)} • {lr.totalDays} ngày</div>
                                    </div>
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${st.color} shrink-0`}>{st.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </SectionCard>
            )}

            {/* ═══════════ CONTRACT INFO ═══════════ */}
            {myContract && (
                <SectionCard title="Hợp đồng lao động" icon={<FileText size={14} />} action={{ label: 'Chi tiết', onClick: () => navigate('/hrm/contracts') }}>
                    <button
                        onClick={() => navigate('/hrm/contracts')}
                        className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 group text-left"
                    >
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white shrink-0 shadow-md shadow-indigo-500/20">
                            <FileText size={17} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{myContract.contractNumber || 'HĐLĐ'}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                                {myContract.type === 'definite' ? 'Có thời hạn' : myContract.type === 'indefinite' ? 'Không thời hạn' : myContract.type}
                                {myContract.endDate && ` • Đến ${fmtDate(myContract.endDate)}`}
                            </div>
                        </div>
                        <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-md shrink-0">Hiệu lực</span>
                    </button>
                </SectionCard>
            )}

            {/* ═══════════ MY ASSETS ═══════════ */}
            {myAssets.length > 0 && (
                <SectionCard title="Tài sản được cấp" icon={<Shield size={14} />} action={{ label: 'Xem tất cả', onClick: () => navigate('/ts/catalog') }}>
                    <div className="space-y-2">
                        {myAssets.slice(0, 4).map(asset => (
                            <button
                                key={asset.id}
                                onClick={() => navigate(`/ts/asset/${asset.id}`)}
                                className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-rose-50 dark:hover:bg-rose-500/10 group text-left border border-transparent hover:border-rose-200 dark:hover:border-rose-500/20"
                            >
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center text-white shrink-0 shadow-md shadow-rose-500/20 group-hover:scale-110 transition-transform">
                                    <Shield size={15} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{asset.name}</div>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        <span className="text-[9px] font-mono text-slate-400">{asset.code}</span>
                                        {asset.brand && <span className="text-[9px] text-slate-400">• {asset.brand} {asset.model || ''}</span>}
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{asset.originalValue?.toLocaleString('vi-VN')}đ</div>
                                    <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 mt-0.5 ml-auto group-hover:text-rose-500 transition-colors" />
                                </div>
                            </button>
                        ))}
                    </div>
                </SectionCard>
            )}

            {/* ═══════════ QUICK LINKS ═══════════ */}
            <div className="rounded-2xl overflow-hidden bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 shadow-lg dark:shadow-slate-900/40 backdrop-blur-xl p-4">
                <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 flex items-center gap-2">
                    <Sparkles size={12} className="text-indigo-400" /> Truy cập nhanh
                </h3>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {[
                        { icon: <MapPin size={17} />, label: 'Check-in', to: '/hrm/checkin', gradient: 'from-emerald-500 to-green-600', shadow: 'shadow-emerald-500/20' },
                        { icon: <CalendarOff size={17} />, label: 'Nghỉ phép', to: '/hrm/leave', gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/20' },
                        { icon: <DollarSign size={17} />, label: 'Bảng lương', to: '/hrm/payroll', gradient: 'from-amber-500 to-orange-500', shadow: 'shadow-amber-500/20' },
                        { icon: <GitBranch size={17} />, label: 'Quy trình', to: '/wf', gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/20' },
                        { icon: <Inbox size={17} />, label: 'Yêu cầu', to: '/rq', gradient: 'from-cyan-500 to-sky-600', shadow: 'shadow-cyan-500/20' },
                        { icon: <MessageCircle size={17} />, label: 'Tin nhắn', to: '/chat', gradient: 'from-pink-500 to-rose-600', shadow: 'shadow-pink-500/20' },
                        { icon: <Bot size={17} />, label: 'Trợ lý AI', to: '/ai', gradient: 'from-fuchsia-500 to-purple-600', shadow: 'shadow-fuchsia-500/20' },
                        { icon: <UserIcon size={17} />, label: 'Hồ sơ', to: '/my-profile', gradient: 'from-slate-500 to-slate-700', shadow: 'shadow-slate-500/20' },
                    ].map((link, i) => (
                        <button
                            key={i}
                            onClick={() => navigate(link.to)}
                            className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:shadow-md hover:scale-[1.05] active:scale-[0.95] group"
                        >
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${link.gradient} flex items-center justify-center text-white shadow-md ${link.shadow} group-hover:scale-110 transition-transform`}>
                                {link.icon}
                            </div>
                            <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 text-center leading-tight">{link.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* ═══════════ EMPTY STATE ═══════════ */}
            {totalTodos === 0 && myWorkflowInstances.length === 0 && myRequests.length === 0 && (
                <div className="text-center py-10 px-6 rounded-2xl bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 shadow-lg">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/30">
                        <CheckCircle2 size={28} />
                    </div>
                    <h4 className="text-lg font-black text-slate-800 dark:text-white">Không có việc cần làm 🎉</h4>
                    <p className="text-sm text-slate-400 mt-1">Bạn đã hoàn thành tất cả công việc. Tuyệt vời!</p>
                </div>
            )}
        </div>
    );
};

export default EmployeeDashboard;
