import {
  candidateStartSlots,
  createGenerationGrid,
  durationToSlots,
  minutesToSlot,
  relationshipConversion,
} from "./generation-grid";

describe("10-minute generation grid", () => {
  const grid = createGenerationGrid(8 * 60, 15 * 60);

  it("converts the school day into 42 atomic slots", () => {
    expect(grid.slotCount).toBe(42);
    expect(minutesToSlot(10 * 60 + 20, grid)).toBe(14);
  });

  it("models Secondary and Primary lessons as six and four contiguous slots", () => {
    expect(durationToSlots(60, grid)).toBe(6);
    expect(durationToSlots(40, grid)).toBe(4);
  });

  it("does not allow a Secondary lesson to cross break or lunch", () => {
    const starts = candidateStartSlots(grid, 6, [
      { start: 10 * 60, end: 10 * 60 + 20 },
      { start: 12 * 60 + 20, end: 13 * 60 },
    ]);

    expect(starts).toEqual([
      0, 1, 2, 3, 4, 5, 6,
      14, 15, 16, 17, 18, 19, 20,
      30, 31, 32, 33, 34, 35, 36,
    ]);
  });

  it("flags period-number relationships that need duration-aware translation", () => {
    expect(relationshipConversion("n_13", false)).toBe("unchanged");
    expect(relationshipConversion("a_21", false)).toBe("overlap-aware");
    expect(relationshipConversion("n_0", false)).toBe("duration-aware");
    expect(relationshipConversion("a_10", true)).toBe("disabled-review");
  });
});
