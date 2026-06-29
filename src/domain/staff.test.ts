import { describe, expect, it } from "vitest";
import { mergeStaffMembers, normalizeStaffNames } from "./staff";

describe("staff presets", () => {
  it("normalizes workbook aliases to XML teacher names", () => {
    expect(normalizeStaffNames(["Ben J", "Ben W", "Anna W", "New PHE"])).toEqual([
      "Benjamin Jenkins",
      "Ben Willgoss",
      "Anna Ward",
    ]);
  });

  it("keeps imported assignment names available as preset objects", () => {
    expect(mergeStaffMembers([{ id: "1", name: "Anna Ward" }], ["Visiting Coach"])).toEqual([
      { id: "1", name: "Anna Ward" },
      { id: "assignment-visiting-coach", name: "Visiting Coach" },
    ]);
  });
});
