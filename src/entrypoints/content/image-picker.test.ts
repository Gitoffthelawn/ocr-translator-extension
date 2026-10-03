import { describe, expect, it, vi } from "vitest";
import { cleanupImagePickerOnNavigation } from "./image-picker";

describe("cleanupImagePickerOnNavigation", () => {
  it("ends the global session when the top frame navigates", () => {
    const cancelLocal = vi.fn();
    const endGlobal = vi.fn();

    cleanupImagePickerOnNavigation(true, cancelLocal, endGlobal);

    expect(endGlobal).toHaveBeenCalledOnce();
    expect(cancelLocal).not.toHaveBeenCalled();
  });

  it("only cancels the local picker when a child frame navigates", () => {
    const cancelLocal = vi.fn();
    const endGlobal = vi.fn();

    cleanupImagePickerOnNavigation(false, cancelLocal, endGlobal);

    expect(cancelLocal).toHaveBeenCalledOnce();
    expect(endGlobal).not.toHaveBeenCalled();
  });
});
