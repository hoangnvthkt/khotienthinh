import React from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  ArrowLeft,
  FileText,
  LayoutDashboard,
  Plus,
  Settings,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  createOfficeFileStore,
  createOfficeService,
  type OfficeService,
} from "../../lib/office/officeService";
import { OfficeError, OfficeLoading, useOfficeQuery } from "./OfficeShared";
import { OfficeDashboardPage, OfficeListPage } from "./OfficeList";
import { OfficeDraftPage } from "./OfficeDraft";
import { OfficeDetailPage } from "./OfficeDetail";
import { OfficeSettingsPage } from "./OfficeSettings";
import { OfficeTemplatesPage, OfficeReportsPage } from "./OfficeLibrary";
import { createOfficeAiService } from "../../lib/office/officeAiService";
import "./office.css";
const defaultService = createOfficeService(
  supabase,
  createOfficeFileStore(supabase.storage),
  createOfficeAiService(supabase.functions),
);
export function OfficeWorkspace({
  service = defaultService,
}: {
  service?: OfficeService;
}) {
  const catalog = useOfficeQuery(() => service.catalog(), [service]);
  const location = useLocation();
  const active = location.pathname;
  const editing = active.endsWith("/edit") || active.endsWith("/new");
  return (
    <div className="office-app">
      <header className="office-topbar">
        <div className="office-brand">
          <div>
            <FileText size={23} />
          </div>
          <span>
            <strong>Vioo Office</strong>
            <small>Văn bản & hồ sơ doanh nghiệp</small>
          </span>
        </div>
        <nav aria-label="Điều hướng Office">
          <Link
            className={active === "/office" ? "is-active" : ""}
            to="/office"
          >
            <LayoutDashboard size={16} />
            <span>Tổng quan</span>
          </Link>
          <Link
            className={active.includes("/documents") ? "is-active" : ""}
            to="/office/documents"
          >
            <FileText size={16} />
            <span>Văn bản</span>
          </Link>
          <Link
            className={active.endsWith("/templates") ? "is-active" : ""}
            to="/office/templates"
          >
            <BookOpen size={16} />
            <span>Mẫu văn bản</span>
          </Link>
          <Link
            className={active.endsWith("/reports") ? "is-active" : ""}
            to="/office/reports"
          >
            <BarChart3 size={16} />
            <span>Báo cáo</span>
          </Link>
          {catalog.data?.canConfigure && (
            <Link
              className={active.endsWith("/settings") ? "is-active" : ""}
              to="/office/settings"
            >
              <Settings size={16} />
              <span>Cấu hình</span>
            </Link>
          )}
        </nav>
        {catalog.data?.canCreate && !editing && (
          <Link className="office-primary" to="/office/new">
            <Plus size={17} />
            <span>Tạo văn bản</span>
          </Link>
        )}
        {editing && (
          <Link className="office-secondary" to="/office/documents">
            <ArrowLeft size={16} />
            <span>Danh sách</span>
          </Link>
        )}
      </header>
      {catalog.loading ? (
        <OfficeLoading />
      ) : catalog.error ? (
        <OfficeError error={catalog.error} retry={catalog.refresh} />
      ) : (
        catalog.data && (
          <Routes>
            <Route
              index
              element={
                <OfficeDashboardPage service={service} catalog={catalog.data} />
              }
            />
            <Route
              path="documents"
              element={
                <OfficeListPage service={service} catalog={catalog.data} />
              }
            />
            <Route
              path="new"
              element={
                <OfficeDraftPage
                  key={location.key}
                  service={service}
                  catalog={catalog.data}
                />
              }
            />
            <Route
              path="documents/:id"
              element={
                <OfficeDetailPage service={service} catalog={catalog.data} />
              }
            />
            <Route
              path="documents/:id/edit"
              element={
                <OfficeDraftPage
                  key={location.key}
                  service={service}
                  catalog={catalog.data}
                />
              }
            />
            <Route
              path="templates"
              element={
                <OfficeTemplatesPage service={service} catalog={catalog.data} />
              }
            />
            <Route
              path="reports"
              element={<OfficeReportsPage service={service} />}
            />
            <Route
              path="settings"
              element={
                <OfficeSettingsPage
                  service={service}
                  catalog={catalog.data}
                  onSaved={catalog.refresh}
                />
              }
            />
            <Route
              path="*"
              element={<OfficeError error={{ message: "OFFICE_NOT_FOUND" }} />}
            />
          </Routes>
        )
      )}
    </div>
  );
}
export default OfficeWorkspace;
