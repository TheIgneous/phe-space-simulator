import generationModel from "../data/generation-model.json";

describe("supplied Secondary generation model", () => {
  it("uses a 10-minute quantum with six-slot Secondary and four-slot Primary lessons", () => {
    expect(generationModel.grid).toMatchObject({ slotMinutes: 10, slotCount: 42 });
    expect(generationModel.phaseRules.secondary.minimumDurationSlots).toBe(6);
    expect(generationModel.phaseRules.primary.minimumDurationSlots).toBe(4);
  });

  it("uses the 105-relationship baseline and excludes the relationship added during capture", () => {
    expect(generationModel.relationships.count).toBe(105);
    expect(generationModel.relationships.rows.some((relationship) => relationship.id === "*125")).toBe(false);
    expect(generationModel.metadata.excludedHarMutations).toEqual([
      expect.objectContaining({ operation: "add", table: "cardrelationships", returnedIds: ["*125"] }),
    ]);
  });

  it("preserves all four PHE synchronization relationships unchanged", () => {
    const pheRelationships = generationModel.relationships.rows.filter(
      (relationship) => relationship.subjects.includes("PHE Girls") || relationship.subjects.includes("PHE Boys"),
    );
    expect(pheRelationships).toHaveLength(4);
    expect(pheRelationships.every((relationship) => relationship.conversion === "unchanged")).toBe(true);
  });
});
