import { describe, it, expect, vi } from "vitest";
import { createOfficeAiHandler } from "../../supabase/functions/office-assistant/handler";
const request = (body: object, token = "test-token") =>
  new Request("https://test/office-assistant", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
function setup(configured = true) {
  const rpc = vi.fn(async (name: string, p: any) => ({
    data:
      name === "office_ai_begin"
        ? {}
        : p.p_query === "catalog"
          ? { canCreate: true }
          : {
              document: {
                id: "doc",
                version: 1,
                content_text: "Nội dung hợp lệ",
              },
              attachments: [],
              capabilities: { edit: true },
            },
    error: null,
  }));
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "u" } },
        error: null,
      })),
    },
    rpc,
    storage: { from: vi.fn() },
  };
  const fetcher = vi.fn(
    async (..._args: Parameters<typeof fetch>) =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      title: "Đề xuất",
                      summary: "Tóm tắt",
                      body: "Nội dung gợi ý",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
  );
  const handler = createOfficeAiHandler({
    client: () => client as any,
    config: () =>
      configured
        ? { key: "never-exposed", model: "test-model" }
        : { key: "", model: "" },
    fetch: fetcher,
  });
  return { client, handler, fetcher };
}
describe("Office AI boundary", () => {
  it("rejects an invalid Auth session before any Office query or provider request", async () => {
    const { handler, client, fetcher } = setup();
    client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid JWT" },
    } as any);
    expect(
      (await handler(request({ action: "draft", prompt: "Soạn thông báo" })))
        .status,
    ).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("discards generated content if document permission changes during the provider call", async () => {
    const { handler, client } = setup();
    let reads = 0;
    client.rpc.mockImplementation(async (name, p) => {
      if (p?.p_query === "detail") {
        if (++reads === 2)
          return { data: null, error: { message: "OFFICE_NOT_FOUND" } } as any;
        return {
          data: {
            document: {
              id: "doc",
              version: 1,
              content_text: "Private content",
            },
            capabilities: { edit: true },
            attachments: [],
          },
          error: null,
        } as any;
      }
      return { data: { canCreate: true }, error: null } as any;
    });
    const response = await handler(
      request({ action: "summary", documentId: "doc" }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "OFFICE_VERSION_CONFLICT" });
    expect(reads).toBe(2);
  });
  it("fails closed when key/model are absent and status never discloses secrets", async () => {
    const { handler, fetcher } = setup(false);
    expect(await (await handler(request({ action: "status" }))).json()).toEqual(
      { configured: false },
    );
    expect(
      (await handler(request({ action: "draft", prompt: "Soạn thông báo" })))
        .status,
    ).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not send content to AI when the caller cannot view the document", async () => {
    const { handler, client, fetcher } = setup();
    client.rpc.mockImplementation(async (name, p) =>
      p?.p_query === "detail"
        ? ({ data: null, error: { message: "OFFICE_NOT_FOUND" } } as any)
        : { data: { canCreate: true }, error: null },
    );
    expect(
      (await handler(request({ action: "summary", documentId: "doc" }))).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns a proposal without issuing any document mutation and uses a fixed provider", async () => {
    const { handler, client, fetcher } = setup();
    const response = await handler(
      request({ action: "draft", prompt: "Lịch nghỉ lễ" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { title: "Đề xuất", body: "Nội dung gợi ý" },
    });
    expect(
      client.rpc.mock.calls.some(([name]) => name === "office_command"),
    ).toBe(false);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent",
    );
  });
  it("rejects an attachment outside the authorized document before downloading it", async () => {
    const { handler, client, fetcher } = setup();
    expect(
      (
        await handler(
          request({
            action: "extract",
            documentId: "doc",
            attachmentId: "other",
          }),
        )
      ).status,
    ).toBe(403);
    expect(client.storage.from).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
