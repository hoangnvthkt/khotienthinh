import type { OfficeTextDocument, OfficeBlock } from './officeContent';
const paragraph = (text: string, align: 'left' | 'center' | 'right' = 'left', bold = false): OfficeBlock => ({type:'paragraph',align,content:[{type:'text',text,marks:[{type:'fontFamily',attrs:{value:'Times New Roman'}},...(bold?[{type:'bold' as const}]:[])]}]});
/** Reusable source template; actual personnel values are filled in the database from approved records. */
export const HR_TRANSFER_TEMPLATE: OfficeTextDocument = {version:1,type:'doc',content:[
 paragraph('CÔNG TY CỔ PHẦN PHÁT TRIỂN ĐẦU TƯ VÀ XÂY LẮP TIẾN THỊNH','center',true),
 paragraph('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập – Tự do – Hạnh phúc','center',true),
 paragraph('Số: {{document_number}}\nNgày soạn: {{document_date}}'),
 paragraph('THÔNG BÁO','center',true),paragraph('V/v: Điều động nhân sự','center'),
 paragraph('Kính gửi:\n{{recipient_lines}}'),
 paragraph('Căn cứ nhu cầu điều động nhân sự phục vụ hoạt động sản xuất kinh doanh và năng lực chuyên môn của cán bộ;\nCăn cứ tình hình thực tế;\nPhòng Hành chính Nhân sự thông báo về nội dung điều động sau:'),
 paragraph('1. Nội dung điều động','left',true),
 paragraph('Họ và tên: {{employee_name}}\nNgày sinh: {{employee_dob}}\nCCCD số: {{identity_no}}, cấp ngày {{identity_issued_on}} tại {{identity_issued_at}}\nSố điện thoại: {{employee_phone}}\nChức vụ: {{job_title}}\nĐịa điểm làm việc trước điều động: {{origin_name}}\nĐịa điểm làm việc sau điều động: {{destination_name}}\nThời gian điều động dự kiến: {{transfer_period}}'),
 paragraph('2. Yêu cầu thực hiện','left',true),
 paragraph('Nhân sự {{employee_name}} có trách nhiệm:\n– {{task_text}}\n– Báo cáo kết quả thực hiện công việc cho {{report_to}}.'),
 paragraph('3. Tổ chức thực hiện','left',true),
 paragraph('Phòng HCNS phối hợp với các bên liên quan triển khai thủ tục điều động và cập nhật hồ sơ nhân sự.\nCác đơn vị, cá nhân có tên trên căn cứ thông báo này nghiêm túc thực hiện.\nThời gian điều động thực hiện theo mục 1, sau khi văn bản được phát hành.'),
 paragraph('Nơi nhận:\n– Như kính gửi;\n– Lưu: HC.'),
 paragraph('Trưởng phòng Hành chính Nhân sự\n\n[Người ký được xác định khi trình duyệt]','right'),
]};
export const HR_TRANSFER_FIELDS: Record<string,string> = {
 recipient_lines:'Đơn vị nhận điều động',employee_name:'Họ tên nhân sự',employee_code:'Mã nhân sự',employee_dob:'Ngày sinh',identity_no:'Số CCCD',identity_issued_on:'Ngày cấp CCCD',identity_issued_at:'Nơi cấp CCCD',employee_phone:'Điện thoại nhân sự',job_title:'Chức vụ',origin_name:'Công trường đi',destination_name:'Công trường đến',transfer_period:'Thời gian điều động',task_text:'Nhiệm vụ được giao',report_to:'Người / bộ phận nhận báo cáo',source_request_code:'Mã yêu cầu nguồn',assignment_code:'Mã phiếu điều động'
};
