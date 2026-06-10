// ═══════════════════════════════════════════════════════════════
//  AI Database Context — Agentic Tool-calling Architecture
//  Router Agent → Tool Selection → RPC Execution → Answer Format
// ═══════════════════════════════════════════════════════════════

// ─── Tool Definitions ────────────────────────────────────────
export const AI_TOOL_DEFINITIONS = [
  // ── Construction Domain ──
  {
    name: 'ai_tool_project_list',
    description: 'Lấy danh sách tất cả dự án/công trường đang có trong hệ thống. Dùng khi hỏi "có bao nhiêu dự án", "danh sách công trường", "liệt kê các dự án".',
    parameters: {
      p_status: { type: 'string', required: false, description: 'Lọc theo trạng thái (hiện chưa hỗ trợ)' },
    },
  },
  {
    name: 'ai_tool_project_summary',
    description: 'Xem tổng quan 1 dự án cụ thể: thông tin cơ bản, tài chính (ngân sách, doanh thu), tiến độ (số task, % hoàn thành). Cần có project_id.',
    parameters: {
      p_project_id: { type: 'string', required: true, description: 'ID của dự án/công trường cần xem' },
    },
  },
  {
    name: 'ai_tool_project_progress',
    description: 'Xem chi tiết tiến độ thi công: danh sách tasks, % progress từng task, gate_status. Cần có project_id.',
    parameters: {
      p_project_id: { type: 'string', required: true, description: 'ID của dự án cần xem tiến độ' },
    },
  },
  {
    name: 'ai_tool_daily_log_summary',
    description: 'Xem tổng hợp nhật ký thi công (daily logs): tổng số, breakdown theo trạng thái, 10 logs gần nhất. Cần có project_id.',
    parameters: {
      p_project_id: { type: 'string', required: true, description: 'ID dự án' },
      p_from_date: { type: 'string', required: false, description: 'Ngày bắt đầu lọc (yyyy-mm-dd)' },
      p_to_date: { type: 'string', required: false, description: 'Ngày kết thúc lọc (yyyy-mm-dd)' },
    },
  },

  // ── Inventory Domain ──
  {
    name: 'ai_tool_inventory_summary',
    description: 'Tổng quan tồn kho: tổng số mặt hàng, tổng tồn kho, vật tư dưới mức tối thiểu, giá trị tồn kho, danh sách kho. Dùng khi hỏi "tổng tồn kho", "báo cáo kho", "giá trị tồn kho".',
    parameters: {
      p_warehouse_id: { type: 'string', required: false, description: 'Mã kho cụ thể (VD: wh-1 = Kho RICO). Nếu null = tất cả kho.' },
    },
  },
  {
    name: 'ai_tool_material_search',
    description: 'Tìm kiếm vật tư theo tên hoặc mã SKU. Trả về chi tiết: sku, tên, đơn vị, giá, tồn kho. Dùng khi hỏi "tìm thép D8", "có bao nhiêu loại thép", "thông tin vật tư X".',
    parameters: {
      p_keyword: { type: 'string', required: true, description: 'Từ khóa tìm kiếm (tên vật tư hoặc SKU). LƯU Ý: phải dùng tiếng Việt CÓ DẤU (VD: "thép" không phải "thep").' },
      p_warehouse_id: { type: 'string', required: false, description: 'Lọc theo kho cụ thể' },
    },
  },
  {
    name: 'ai_tool_material_request_status',
    description: 'Trạng thái đề xuất vật tư (Material Request): tổng số, breakdown theo status, 20 MR gần nhất. Dùng khi hỏi "phiếu đề xuất", "MR đang chờ duyệt", "đề xuất vật tư".',
    parameters: {
      p_project_id: { type: 'string', required: false, description: 'Lọc theo dự án' },
      p_status: { type: 'string', required: false, description: 'Lọc theo trạng thái: draft, submitted, approved, rejected, completed' },
    },
  },
  {
    name: 'ai_tool_purchase_order_summary',
    description: 'Tổng hợp đơn mua hàng (Purchase Order): tổng số, tổng giá trị, breakdown status, 20 PO gần nhất. Dùng khi hỏi "đơn mua hàng", "PO", "đơn đặt hàng".',
    parameters: {
      p_project_id: { type: 'string', required: false, description: 'Lọc theo dự án' },
      p_status: { type: 'string', required: false, description: 'Lọc theo trạng thái' },
    },
  },

  // ── Finance & HR Domain ──
  {
    name: 'ai_tool_project_finance',
    description: 'Tài chính 1 dự án: ngân sách (vật tư, nhân công), doanh thu, thu/chi, lãi/lỗ. Cần project_id.',
    parameters: {
      p_project_id: { type: 'string', required: true, description: 'ID dự án cần xem tài chính' },
    },
  },
  {
    name: 'ai_tool_employee_summary',
    description: 'Tổng hợp nhân viên: tổng số, phân theo trạng thái/phòng ban, danh sách 50 NV. Dùng khi hỏi "bao nhiêu nhân viên", "danh sách phòng ban", "nhân sự".',
    parameters: {
      p_department_id: { type: 'string', required: false, description: 'Lọc theo phòng ban (org_unit_id)' },
    },
  },
  {
    name: 'ai_tool_employee_search',
    description: 'Tìm kiếm hồ sơ nhân viên chi tiết theo tên hoặc mã nhân viên. Trả về thông tin: mã NV, họ tên, chức danh, sđt, email, ngày sinh, trạng thái, phòng ban, vị trí, công trường. Dùng khi hỏi "thông tin nhân sự của X", "tìm nhân viên Y", "số điện thoại của Z", "Hà Hải Hồng".',
    parameters: {
      p_keyword: { type: 'string', required: true, description: 'Từ khóa tìm kiếm (họ tên hoặc mã nhân viên).' },
    },
  },
  {
    name: 'ai_tool_attendance_report',
    description: 'Báo cáo chấm công theo ngày: tổng check-in/out, đi muộn, vắng, đúng giờ. Dùng khi hỏi "chấm công hôm nay", "ai vắng", "báo cáo chấm công".',
    parameters: {
      p_date: { type: 'string', required: false, description: 'Ngày chấm công (yyyy-mm-dd). Mặc định = hôm nay.' },
      p_site_id: { type: 'string', required: false, description: 'Lọc theo công trường' },
    },
  },

  // ── Tendering / Internal Cost Estimation Domain ──
  {
    name: 'ai_tool_estimate_module_blueprint',
    description: 'Trả về blueprint nghiệp vụ/kỹ thuật cho module "Đơn giá nội bộ & AI dự toán nhanh": architecture, data model, versioning, snapshot, AI rules, UI, API, convert estimate sang BOQ, edge cases, acceptance criteria. Dùng khi hỏi thiết kế module dự toán, cách triển khai AI dự toán nhanh, hoặc nguyên tắc hệ thống chào thầu.',
    parameters: {},
  },
  {
    name: 'ai_tool_cost_template_summary',
    description: 'Tra cứu/tóm tắt cost templates đang có: loại công trình, tham số bắt buộc, sections, sample items và công thức khối lượng. Dùng khi hỏi template nhà xưởng, hạng mục dự toán, tham số floor_area/height/span/foundation_type/roof_type/wall_type/crane_capacity/finish_level/region.',
    parameters: {
      p_project_type: { type: 'string', required: false, description: 'Loại công trình/template cần lọc, ví dụ: nha_xuong, warehouse, factory.' },
      p_keyword: { type: 'string', required: false, description: 'Từ khóa tìm template hoặc hạng mục.' },
    },
  },
  {
    name: 'ai_tool_internal_price_book_lookup',
    description: 'Tra cứu đơn giá nội bộ theo mã/tên vật tư/nhân công/máy/thầu phụ. Đây là dữ liệu nhạy cảm, chỉ dùng khi người dùng hỏi rõ về đơn giá nội bộ, giá vật tư nội bộ, price book, hoặc cần số liệu để dự toán nhanh.',
    parameters: {
      p_keyword: { type: 'string', required: true, description: 'Từ khóa mã/tên vật tư, nhân công, máy hoặc nhóm chi phí.' },
      p_region: { type: 'string', required: false, description: 'Khu vực áp dụng, ví dụ: mien_bac, mien_nam, hanoi, hcm.' },
      p_limit: { type: 'number', required: false, description: 'Số dòng tối đa, mặc định 20.' },
    },
  },
  {
    name: 'ai_tool_internal_norms_lookup',
    description: 'Tra cứu định mức nội bộ theo mã công việc, mã định mức, tên nguồn lực hoặc vật tư. Dùng khi hỏi định mức vật tư, hao hụt, công thức định mức, norm cho hạng mục.',
    parameters: {
      p_keyword: { type: 'string', required: true, description: 'Từ khóa mã định mức, mã công việc, tên vật tư/nhân công/máy.' },
      p_region: { type: 'string', required: false, description: 'Khu vực áp dụng.' },
      p_limit: { type: 'number', required: false, description: 'Số dòng tối đa, mặc định 20.' },
    },
  },
  {
    name: 'ai_tool_estimate_scenario_summary',
    description: 'Tổng hợp các phương án estimate/dự toán nhanh: trạng thái draft/reviewed/finalized/converted, tổng giá trị, tham số thiếu, giả định, cảnh báo rủi ro, confidence score. Không trả profit/margin nhạy cảm.',
    parameters: {
      p_project_id: { type: 'string', required: false, description: 'Lọc theo project_id hoặc construction_site_id.' },
      p_status: { type: 'string', required: false, description: 'draft, reviewed, finalized, converted, cancelled.' },
      p_keyword: { type: 'string', required: false, description: 'Tìm theo mã/tên estimate, khách hàng, loại công trình.' },
    },
  },

  // ── Cross-domain ──
  {
    name: 'ai_tool_executive_dashboard',
    description: 'Dashboard tổng hợp KPI cho Ban Giám đốc: tổng tồn kho, số dự án, nhân viên, MR/PO pending, thu/chi tháng. Dùng khi hỏi "tổng quan hệ thống", "dashboard", "báo cáo tổng hợp", "KPI".',
    parameters: {},
  },
] as const;

// ─── Tool Router Prompt ──────────────────────────────────────
export const TOOL_ROUTER_PROMPT = `
Bạn là Router Agent của hệ thống quản lý Kho Tiến Thịnh (ERP).
Nhiệm vụ: Phân tích câu hỏi người dùng và chọn ĐÚNG 1 tool phù hợp nhất từ danh sách tools được cung cấp.

QUY TẮC BẮT BUỘC (theo thứ tự ưu tiên):

1. TỪ CHỐI (rejection):
   - Câu hỏi chứa từ ngữ thô tục, khiêu khích, xúc phạm, thiếu lịch sự → rejection
   - Yêu cầu tạo mới, sửa đổi, cập nhật, xóa dữ liệu (INSERT, UPDATE, DELETE) → rejection
   - Câu hỏi ngoài phạm vi nghiệp vụ (hỏi về thời tiết, nấu ăn, chính trị...) → rejection

2. LÀM RÕ (clarification):
   - Câu hỏi quá rộng, mơ hồ mà KHÔNG thể map vào bất kỳ tool nào (VD: "Báo cáo" đơn thuần)
   - Câu hỏi cần project_id nhưng không chỉ rõ dự án nào → hỏi lại và gợi ý dùng "ai_tool_project_list" để xem danh sách
   - Khi clarification, luôn đưa ra 3 suggestions cụ thể giúp người dùng

3. GỌI TOOL (tool_call):
   - Map câu hỏi vào tool phù hợp nhất
   - Extract parameters từ câu hỏi (tên vật tư → p_keyword, ngày → p_date...)
   - Nếu hỏi về tồn kho chung chung → ai_tool_inventory_summary
   - Nếu hỏi tìm kiếm vật tư cụ thể → ai_tool_material_search (từ khóa PHẢI có dấu tiếng Việt)
   - Nếu hỏi tổng quan/KPI → ai_tool_executive_dashboard
   - Nếu hỏi về nhân viên/nhân sự → ai_tool_employee_summary
   - Nếu hỏi về dự án mà KHÔNG chỉ rõ dự án nào → ai_tool_project_list
   - Nếu hỏi chi tiết 1 dự án cụ thể → ai_tool_project_summary (cần project_id)
   - Nếu hỏi thiết kế/kiến trúc/plan module "Đơn giá nội bộ & AI dự toán nhanh" → ai_tool_estimate_module_blueprint
   - Nếu hỏi template dự toán, tham số công trình, công thức hạng mục → ai_tool_cost_template_summary
   - Nếu hỏi đơn giá nội bộ/price book/giá nội bộ của vật tư/nhân công/máy → ai_tool_internal_price_book_lookup (cần keyword)
   - Nếu hỏi định mức nội bộ/norm/hao hụt vật tư theo hạng mục → ai_tool_internal_norms_lookup (cần keyword)
   - Nếu hỏi danh sách hoặc tổng hợp phương án dự toán/estimate/chào thầu → ai_tool_estimate_scenario_summary
   - Nếu người dùng muốn AI "tạo", "chốt", "convert", "export" estimate/BOQ/báo giá → rejection hoặc clarification: AI chat chỉ đọc và tư vấn; thao tác ghi phải qua màn hình nghiệp vụ.

DANH SÁCH KHO THAM CHIẾU:
- wh-1: Kho RICO
- wh-1773110380822-zm5oj: Kho Sơn Miền Bắc
- wh-1772607466735-0jnui: Kho Tổng Hưng Yên

JSON format bắt buộc:
{
  "action": "tool_call" | "clarification" | "rejection",
  "tool_name": "ai_tool_xxx" (chỉ khi action = tool_call, null nếu không),
  "parameters": { "key": "value" } (chỉ khi action = tool_call, {} nếu không có params),
  "message": "Câu trả lời lịch sự bằng tiếng Việt" (chỉ khi clarification hoặc rejection),
  "suggestions": ["Gợi ý 1", "Gợi ý 2", "Gợi ý 3"],
  "reason": "Lý do ngắn gọn"
}
`.trim();

// ─── Data Assistant System Prompt ────────────────────────────
export const DATA_ASSISTANT_SYSTEM_PROMPT = `
Bạn là trợ lý dữ liệu nội bộ của hệ thống Kho Tiến Thịnh.

Mục tiêu:
- Trả lời đúng trọng tâm câu hỏi nghiệp vụ dựa trên kết quả từ tool đã gọi.
- Luôn ưu tiên số liệu tổng hợp, bảng tóm tắt, danh sách có giới hạn và kết luận hành động.

Quy tắc ứng xử và bảo mật bắt buộc:
- Tuyệt đối KHÔNG TIẾP NHẬN, từ chối một cách lịch sự nếu câu hỏi chứa từ ngữ độc hại, thô tục, khiêu khích hoặc thiếu lịch sự.
- Hệ thống AI CHỈ có quyền ĐỌC dữ liệu (Read-only). Tuyệt đối TỪ CHỐI thực hiện bất kỳ hành động sửa đổi, cập nhật hoặc xóa dữ liệu.

Các module chính:
- WMS/Kho: items, warehouses, suppliers, transactions, requests, activities.
- HRM/Nhân sự: users, employees, hrm_attendance, hrm_leave_requests, hrm_payrolls, hrm_construction_sites, org_units.
- TS/Tài sản: assets, asset_categories, asset_location_stocks, asset_transfers, asset_assignments, asset_maintenances.
- DA/Dự án: project_finances, project_transactions, project_tasks, daily_logs, acceptance_records, material_budget_items, project_material_requests, project_vendors, purchase_orders, payment_schedules.
- HD/Chào thầu & dự toán: cost_templates, cost_template_sections, cost_template_items, cost_template_parameters, internal_price_book, internal_norms, estimate_scenarios, estimate_items, estimate_adjustments, estimate_versions, tender_packages, tender_external_boq_lines, tender_internal_mappings.

Quy tắc riêng cho AI dự toán nhanh:
- AI KHÔNG được tự bịa đơn giá, định mức, khối lượng hoặc lợi nhuận ngoài dữ liệu tool trả về.
- Nếu thiếu template, định mức, đơn giá, tham số hoặc công thức không tính được: nói rõ thiếu gì và đề xuất bước nhập/bổ sung dữ liệu.
- Mọi dự toán AI sinh ra chỉ là bản draft để người dùng review/chốt; không khẳng định là báo giá cuối cùng.
- Luôn nêu giả định, rủi ro và confidence score khi trả lời về dự toán/chào thầu.
- Đơn giá nội bộ, margin và profit là dữ liệu nhạy cảm; chỉ trình bày khi tool có trả về và không suy luận thêm.

Style trả lời:
- Mở đầu bằng kết luận ngắn gọn.
- Trình bày số liệu dạng bảng nếu có nhiều hàng.
- Cuối câu trả lời nêu nguồn dữ liệu (tên tool đã gọi).
- Sử dụng emoji phù hợp để tăng trải nghiệm đọc.
- BẮT BUỘC: Luôn thêm chính xác 3 câu hỏi gợi ý liên quan ở cuối cùng theo đúng cấu trúc bên dưới (để hệ thống tự động bóc tách thành các nút bấm gợi ý):
Gợi ý câu hỏi:
1. [Câu hỏi gợi ý 1 liên quan đến chủ đề vừa thảo luận]
2. [Câu hỏi gợi ý 2 liên quan đến chủ đề vừa thảo luận]
3. [Câu hỏi gợi ý 3 liên quan đến chủ đề vừa thảo luận]
`.trim();

// ─── Knowledge Assistant System Prompt ───────────────────────
export const KNOWLEDGE_ASSISTANT_SYSTEM_PROMPT = `
Bạn là trợ lý tra cứu Kho Kiến Thức nội bộ.

Quy tắc:
- Chỉ trả lời dựa trên đoạn tài liệu được cung cấp.
- Nếu tài liệu không đủ căn cứ, nói rõ chưa tìm thấy nội dung phù hợp.
- Ưu tiên câu trả lời ngắn, có cấu trúc và trích nguồn theo tên tài liệu.
- Không bịa quy định, số liệu, điều khoản hoặc ngày tháng.
- BẮT BUỘC: Luôn thêm chính xác 3 câu hỏi gợi ý liên quan ở cuối cùng theo đúng cấu trúc bên dưới (để hệ thống tự động bóc tách thành các nút bấm gợi ý):
Gợi ý câu hỏi:
1. [Câu hỏi gợi ý 1 liên quan đến chủ đề vừa thảo luận]
2. [Câu hỏi gợi ý 2 liên quan đến chủ đề vừa thảo luận]
3. [Câu hỏi gợi ý 3 liên quan đến chủ đề vừa thảo luận]
`.trim();

// ─── Deprecated: SQL Planner Prompt (kept for reference) ─────
/** @deprecated Replaced by TOOL_ROUTER_PROMPT in Agentic architecture */
export const SQL_PLANNER_PROMPT = TOOL_ROUTER_PROMPT;

// ─── Fallback Database Catalog (kept for context) ────────────
export const FALLBACK_DATABASE_CATALOG = [
  {
    table: 'items',
    purpose: 'Danh mục vật tư/hàng hóa và tồn kho',
    columns: ['id text', 'sku text', 'name text', 'category text', 'unit text', 'stock_by_warehouse jsonb', 'min_stock integer', 'supplier_id text', 'price_in numeric', 'price_out numeric'],
  },
  {
    table: 'transactions',
    purpose: 'Giao dịch nhập/xuất/chuyển kho',
    columns: ['id text', 'type USER-DEFINED', 'status USER-DEFINED', 'date timestamp with time zone', 'items jsonb', 'source_warehouse_id text', 'target_warehouse_id text', 'requester_id uuid', 'approver_id uuid'],
  },
  {
    table: 'employees',
    purpose: 'Hồ sơ nhân viên',
    columns: ['id uuid', 'employee_code character varying', 'full_name character varying', 'status character varying', 'department_id uuid', 'position_id uuid', 'construction_site_id uuid', 'user_id uuid', 'org_unit_id uuid'],
  },
  {
    table: 'cost_templates',
    purpose: 'Template dự toán nội bộ theo loại công trình/hạng mục',
    columns: ['id text', 'code text', 'name text', 'project_type text', 'status text', 'version_no integer', 'effective_from date', 'effective_to date', 'assumptions jsonb'],
  },
  {
    table: 'internal_price_book',
    purpose: 'Đơn giá nội bộ nhạy cảm dùng cho dự toán nhanh',
    columns: ['id text', 'item_code text', 'item_name text', 'item_type text', 'unit text', 'region text', 'unit_price numeric', 'version_no integer', 'effective_from date', 'effective_to date', 'status text'],
  },
  {
    table: 'internal_norms',
    purpose: 'Định mức vật tư/nhân công/máy nội bộ theo hạng mục',
    columns: ['id text', 'norm_code text', 'work_code text', 'resource_name text', 'resource_type text', 'unit text', 'norm_quantity numeric', 'waste_percent numeric', 'formula text', 'version_no integer', 'confidence_score numeric'],
  },
  {
    table: 'estimate_scenarios',
    purpose: 'Phương án dự toán/chào thầu có snapshot template/định mức/đơn giá',
    columns: ['id text', 'code text', 'name text', 'status text', 'project_type text', 'input_parameters jsonb', 'missing_parameters text[]', 'assumptions jsonb', 'risk_warnings jsonb', 'confidence_score numeric', 'total_amount numeric'],
  },
];
