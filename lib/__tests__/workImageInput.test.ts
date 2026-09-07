import { describe, it, expect, vi, afterEach } from "vitest";
import { prepareWorkImage } from "../work/workImageInput";
afterEach(() => vi.unstubAllGlobals());
describe("Work image preparation", () => {
  it("never decodes or rewrites a retained original/evidence file", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    const file = new File(["original bytes"], "camera.jpg", {
      type: "image/jpeg",
    });
    expect(await prepareWorkImage(file, true)).toBe(file);
    expect(decode).not.toHaveBeenCalled();
  });
  it("reduces camera dimensions, closes decoded resources and preserves alpha-capable format", async () => {
    const close = vi.fn(),
      drawImage = vi.fn(),
      bitmap = { width: 4032, height: 3024, close };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (cb: (blob: Blob) => void) =>
        cb(new Blob(["normalized"], { type: "image/webp" })),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    const result = await prepareWorkImage(
      new File([new Uint8Array([255, 216, 255, 0])], "camera.jpg", {
        type: "image/jpeg",
      }),
      false,
    );
    expect([canvas.width, canvas.height]).toEqual([1920, 1440]);
    expect(result.name).toBe("camera.webp");
    expect(result.type).toBe("image/webp");
    expect(close).toHaveBeenCalledOnce();
  });
  it("does not flatten animated PNG/WebP before server validation", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    for (const type of ["image/png", "image/webp"]) {
      const file = new File(["animated source"], "animation", { type });
      expect(await prepareWorkImage(file, false)).toBe(file);
    }
    expect(decode).not.toHaveBeenCalled();
  });
  it("passes PDF through for authoritative server validation", async () => {
    const file = new File(["%PDF"], "document.pdf", {
      type: "application/pdf",
    });
    expect(await prepareWorkImage(file, false)).toBe(file);
  });
});
