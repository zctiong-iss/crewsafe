/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveBlob } from "./downloadBlob";

describe("saveBlob", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  it("clicks a download anchor with the given filename", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    saveBlob(new Blob(["a,b\n1,2"], { type: "text/csv" }), "audit.csv");
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
  });
});
