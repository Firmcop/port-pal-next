import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { checkSaImage, saImagePath } from "../subAssemblyImages";

describe("sub-assembly images", () => {
  it("accepts common image types up to 5 MB", () => {
    expect(checkSaImage({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(checkSaImage({ type: "image/png", size: 5 * 1024 * 1024 })).toBeNull();
  });
  it("rejects other types and large files", () => {
    expect(checkSaImage({ type: "application/pdf", size: 10 })).toMatch(/JPG/);
    expect(checkSaImage({ type: "image/svg+xml", size: 10 })).toMatch(/JPG/);
    expect(checkSaImage({ type: "image/jpeg", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
  });
  it("puts files under the organisation and SKU", () => {
    const p = saImagePath("org-1", "sku-9", "Door Drawing.PNG", 123);
    expect(p.startsWith("org-1/sku-9/123-")).toBe(true);
    expect(p.endsWith(".png")).toBe(true);
    expect(saImagePath("o", "s", "noext").endsWith(".noext")).toBe(true);
  });
});
