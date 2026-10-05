// Fictional UI-only fixture. No backend commands or real employee records.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter,Routes,Route} from 'react-router-dom';
import {ConfirmProvider} from '../../context/ConfirmContext';
import {ToastProvider} from '../../context/ToastContext';
import SiteAssignmentView from '../../components/hrm/assignment/SiteAssignmentView';
import {siteAssignmentService} from '../../lib/siteAssignmentService';
import type {SiteAssignment} from '../../lib/siteAssignment';
import '../../index.css';
import '../../pages/office/office.css';
import {OfficeRichTextView} from '../../pages/office/OfficeRichText';
const row:SiteAssignment={id:'test-assignment',code:'DD-TEST-001',employeeId:'test-employee',employeeName:'Nhân sự minh họa',employeeCode:'TEST001',jobTitle:'Cố vấn',siteId:'site-to',siteName:'Công trường đến',projectCode:'DA02',kind:'primary',startDate:'2026-10-05',endDate:null,status:'awaiting_office',reason:'Điều động theo yêu cầu đã duyệt',source:'request',fromSiteName:'Công trường đi',createdByName:'Người đề nghị',createdAt:'2026-10-05T00:00:00Z',decidedByName:'Người duyệt HR',decidedAt:'2026-10-05T01:00:00Z',decisionNote:null,endedEarlyReason:null,sourceRequestId:'test-request',officeDocumentId:'test-office',canApprove:true};
siteAssignmentService.board=async()=>({assignments:[row],sites:[],review:[],can:{create:false,approve:true}});
createRoot(document.getElementById('root')!).render(<HashRouter><ToastProvider><ConfirmProvider><Routes><Route path="/notice-preview" element={<OfficeRichTextView document={{version:1,type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Họ tên: A\nNơi đến: B\nBắt đầu: C"}]}]}}/>}/><Route path="*" element={<main className="p-3"><SiteAssignmentView people={[]} initialSelectedId="test-assignment" /></main>}/><Route path="/office/documents/test-office" element={<h1>Thông báo Office đã liên kết</h1>}/><Route path="/rq/test-request" element={<h1>Yêu cầu nguồn đã liên kết</h1>}/></Routes></ConfirmProvider></ToastProvider></HashRouter>);
