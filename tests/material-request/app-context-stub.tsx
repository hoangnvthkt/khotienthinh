// Thay AppContext cho fixture giao diện: chỉ những gì ItemSelectionModal đọc. Không gọi Supabase.
export const useApp = () => ({ items: [], warehouses: [] });
