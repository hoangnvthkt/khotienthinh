import { describe, expect, it, vi } from "vitest";
import {
  createOfficeFileStore,
  createOfficeService,
} from "../office/officeService";
import { resolveNotificationPath } from "../notificationRoutes";
import {
  officeError,
  officeFileMime,
  normalizeOfficeFilters,
  processingLabel,
} from "../office/officePresentation";

describe("Office service boundaries", () => {
  it("allows an upload retry only for a duplicate reserved object and preserves other errors", async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ error: { statusCode: "409" } })
      .mockResolvedValueOnce({
        error: { statusCode: "403", message: "denied" },
      });
    const from = vi.fn().mockReturnValue({ upload });
    const store = createOfficeFileStore({ from } as any);
    const ref = {
      bucket: "server-bucket",
      path: "server-reservation",
      mime_type: "application/pdf",
    } as any;
    await expect(store.upload(ref, {} as File)).resolves.toBeUndefined();
    await expect(store.upload(ref, {} as File)).rejects.toMatchObject({
      statusCode: "403",
    });
    expect(upload).toHaveBeenCalledWith(
      "server-reservation",
      {},
      { contentType: "application/pdf", upsert: false },
    );
    expect(from).toHaveBeenCalledWith("server-bucket");
  });
  it("routes an Office notification to the protected document detail", () => {
    expect(
      resolveNotificationPath({
        sourceType: "office_document",
        sourceId: "document-id",
      } as any),
    ).toBe("/office/documents/document-id");
    expect(
      resolveNotificationPath({ sourceType: "office_document" } as any),
    ).toBe("/office");
  });
  it("surfaces an unavailable dashboard instead of inventing zero counts", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "offline" } });
    await expect(
      createOfficeService({ rpc } as any).dashboard(),
    ).rejects.toMatchObject({ message: "offline" });
  });
  it("bounds the list request and keeps the search as a parameter", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { items: [], total: 0 }, error: null });
    const service = createOfficeService({ rpc } as any);
    await service.list({
      search: "RICO'),status.eq.ISSUED",
      page: -1,
      pageSize: 999,
    });
    expect(rpc).toHaveBeenCalledWith("office_query", {
      p_query: "list",
      p_params: expect.objectContaining({
        search: "RICO'),status.eq.ISSUED",
        page: 0,
        pageSize: 50,
      }),
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("reuses the caller key and version after an uncertain command response", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { id: "doc", version: 8 }, error: null });
    const service = createOfficeService({ rpc } as any);
    const request = {
      command: "issue_number" as const,
      documentId: "doc",
      expectedVersion: 7,
      payload: {},
      key: "retry-key",
    };
    await service.command(request);
    await service.command(request);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_idempotency_key: "retry-key",
      p_expected_version: 7,
    });
  });
  it("does not record a read while fetching a list or detail", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const service = createOfficeService({ rpc } as any);
    await service.detail("doc");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("office_query", {
      p_query: "detail",
      p_params: { id: "doc" },
    });
  });
});

describe("Office presentation", () => {
  it("recognizes an Office file when the browser omits its MIME type", () => {
    expect(officeFileMime({ name: "quyet-dinh.DOCX", type: "" })).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(officeFileMime({ name: "unknown.bin", type: "" })).toBe(
      "application/octet-stream",
    );
  });
  it("keeps completion distinct from an elapsed deadline", () => {
    expect(processingLabel("COMPLETED", "2020-01-01")).toBe("Đã hoàn thành");
    expect(processingLabel("IN_PROGRESS", "2020-01-01")).toBe("Quá hạn");
    expect(processingLabel(null, null)).toBe("—");
  });
  it("explains concurrent edits and access denial without exposing SQL", () => {
    expect(officeError({ message: "OFFICE_VERSION_CONFLICT" })).toContain(
      "tải lại",
    );
    expect(officeError({ message: "OFFICE_NOT_FOUND" })).toContain("quyền");
    expect(
      officeError({ message: "select secret from internal" }),
    ).not.toContain("select secret");
  });
  it("does not silently broaden invalid saved view filters", () => {
    expect(normalizeOfficeFilters({ view: "approval", page: 2 }).view).toBe(
      "approval",
    );
    expect(() => normalizeOfficeFilters({ view: "secret" } as any)).toThrow();
  });
});
