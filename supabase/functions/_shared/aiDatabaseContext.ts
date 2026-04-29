export const DATA_ASSISTANT_SYSTEM_PROMPT = `
Bạn là trợ lý dữ liệu nội bộ của hệ thống Kho Tiến Thịnh.

Mục tiêu:
- Trả lời đúng trọng tâm câu hỏi nghiệp vụ bằng dữ liệu thật trong database.
- Nếu thiếu dữ liệu hoặc câu hỏi mơ hồ, nói rõ giả định và hỏi lại ngắn gọn.
- Luôn ưu tiên số liệu tổng hợp, bảng tóm tắt, danh sách có giới hạn và kết luận hành động.

Quy tắc truy vấn:
- Chỉ sinh SQL SELECT hoặc WITH ... SELECT.
- Không sinh INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, CALL, DO, EXECUTE.
- Không truy vấn auth, storage, vault, pg_catalog, information_schema.
- Luôn dùng LIMIT cho danh sách chi tiết.
- Khi hỏi "bao nhiêu", "tổng", "trung bình", "tỷ lệ", hãy dùng aggregate SQL.
- Khi hỏi theo tháng/năm, dùng cột ngày phù hợp và nêu rõ khoảng thời gian.
- Không bịa số liệu. Nếu query trả rỗng, nói rằng chưa có dữ liệu phù hợp.

Các module chính:
- WMS/Kho: items, warehouses, suppliers, transactions, requests, activities.
- HRM/Nhân sự: users, employees, hrm_attendance, hrm_leave_requests, hrm_payrolls, hrm_construction_sites, org_units.
- TS/Tài sản: assets, asset_categories, asset_location_stocks, asset_transfers, asset_assignments, asset_maintenances.
- DA/Dự án: project_finances, project_transactions, project_tasks, daily_logs, acceptance_records, material_budget_items, project_material_requests, project_vendors, purchase_orders, payment_schedules, project_documents, project_baselines.
- WF/Quy trình: workflow_templates, workflow_nodes, workflow_edges, workflow_instances, workflow_instance_logs, request_instances, request_logs.
- AI/Knowledge: ai_conversations, ai_messages, ai_memory, rag_documents, rag_chunks.

Style trả lời:
- Mở đầu bằng kết luận ngắn.
- Sau đó đưa số liệu/bảng nếu có.
- Cuối câu trả lời nêu nguồn dữ liệu đã dùng ở mức tên bảng.
`.trim();

export const SQL_PLANNER_PROMPT = `
Bạn là bộ lập kế hoạch SQL an toàn.
Chỉ trả về JSON hợp lệ, không markdown, không giải thích ngoài JSON.
Schema được cung cấp bên dưới. Dựa vào câu hỏi, tạo SQL đọc-only tốt nhất.

JSON format:
{
  "sql": "select ... limit 50",
  "reason": "ngắn gọn lý do chọn bảng/cột"
}
`.trim();

export const KNOWLEDGE_ASSISTANT_SYSTEM_PROMPT = `
Bạn là trợ lý tra cứu Kho Kiến Thức nội bộ.

Quy tắc:
- Chỉ trả lời dựa trên đoạn tài liệu được cung cấp.
- Nếu tài liệu không đủ căn cứ, nói rõ chưa tìm thấy nội dung phù hợp.
- Ưu tiên câu trả lời ngắn, có cấu trúc và trích nguồn theo tên tài liệu.
- Không bịa quy định, số liệu, điều khoản hoặc ngày tháng.
`.trim();

export const FALLBACK_DATABASE_CATALOG = [
  {
    table: 'items',
    purpose: 'Danh mục vật tư/hàng hóa và tồn kho',
    columns: ['id', 'sku', 'name', 'category', 'unit', 'stock', 'min_stock', 'warehouse_id', 'supplier_id'],
  },
  {
    table: 'transactions',
    purpose: 'Giao dịch nhập/xuất/chuyển kho',
    columns: ['id', 'type', 'status', 'date', 'items', 'source_warehouse_id', 'target_warehouse_id', 'requester_id', 'approver_id'],
  },
  {
    table: 'requests',
    purpose: 'Yêu cầu vật tư/kho',
    columns: ['id', 'code', 'status', 'created_date', 'requester_id', 'site_warehouse_id', 'items'],
  },
  {
    table: 'employees',
    purpose: 'Hồ sơ nhân viên',
    columns: ['id', 'code', 'name', 'status', 'department_id', 'position_id', 'construction_site_id', 'user_id'],
  },
  {
    table: 'hrm_attendance',
    purpose: 'Dữ liệu chấm công',
    columns: ['id', 'employeeId', 'date', 'checkIn', 'checkOut', 'constructionSiteId', 'status'],
  },
  {
    table: 'assets',
    purpose: 'Danh mục tài sản',
    columns: ['id', 'code', 'name', 'status', 'asset_type', 'quantity', 'warehouse_id', 'construction_site_id', 'original_value'],
  },
  {
    table: 'project_finances',
    purpose: 'Tài chính/ngân sách tổng quan dự án',
    columns: ['id', 'constructionSiteId', 'contractValue', 'progressPercent', 'status', 'budgetMaterials', 'budgetLabor', 'revenueReceived'],
  },
  {
    table: 'project_tasks',
    purpose: 'Tiến độ thi công/Gantt',
    columns: ['id', 'construction_site_id', 'parent_id', 'name', 'start_date', 'end_date', 'progress', 'gate_status'],
  },
  {
    table: 'project_transactions',
    purpose: 'Thu/chi dự án',
    columns: ['id', 'constructionSiteId', 'type', 'category', 'amount', 'date', 'description'],
  },
  {
    table: 'workflow_instances',
    purpose: 'Phiếu quy trình nghiệp vụ',
    columns: ['id', 'code', 'template_id', 'status', 'created_by', 'current_node_id', 'created_at', 'updated_at'],
  },
  {
    table: 'request_instances',
    purpose: 'Phiếu yêu cầu theo workflow',
    columns: ['id', 'code', 'category_id', 'status', 'created_by', 'assigned_to', 'due_date', 'created_at'],
  },
  {
    table: 'rag_documents',
    purpose: 'Tài liệu trong Kho Kiến Thức',
    columns: ['id', 'title', 'source', 'file_name', 'status', 'chunk_count', 'created_at'],
  },
];
