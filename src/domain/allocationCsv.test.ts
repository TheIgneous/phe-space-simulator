import rawDataset from "../data/snapshot.json";
import type { SimulationDataset } from "../types";
import { allocationTemplateCsv, applyAllocationCsv } from "./allocationCsv";

const dataset = rawDataset as SimulationDataset;

function replaceFacility(csv: string, cohort: string, term: string, facility: string): string {
  const line = csv.split("\r\n").find((candidate) => candidate.startsWith(`"${cohort}","${term}",`));
  if (!line) throw new Error("Test assignment row not found.");
  const cells = line.slice(1, -1).split('","');
  cells[3] = facility;
  return csv.replace(line, cells.map((cell) => `"${cell}"`).join(","));
}

describe("PHE allocation CSV", () => {
  it("exports a complete, re-importable assignment template", () => {
    const csv = allocationTemplateCsv(dataset);
    const imported = applyAllocationCsv(dataset, csv, { name: "allocations.csv", sha256: "hash" });

    expect(imported.assignments).toHaveLength(dataset.assignments.length);
    expect(imported.metadata.sources.at(-1)?.name).toBe("allocations.csv");
    expect(imported.warnings).toEqual([]);
  });

  it("remaps existing PHE events when a facility allocation changes", () => {
    const csv = replaceFacility(allocationTemplateCsv(dataset), "6 Girls", "T3a", "Primary Gym 1");
    const imported = applyAllocationCsv(dataset, csv, { name: "reconfigured.csv", sha256: "hash" });
    const matchingEvents = imported.events.filter((event) => event.kind === "PHE" && event.cohort === "6 Girls" && event.term === "T3a");

    expect(matchingEvents.length).toBeGreaterThan(0);
    expect(matchingEvents.every((event) => event.facilityId === "primary-gym-1")).toBe(true);
  });

  it("rejects incomplete and unknown allocations", () => {
    expect(() => applyAllocationCsv(dataset, "cohort,term,activity,facility\n6 Girls,T3a,Games,Primary Gym 1", { name: "partial.csv", sha256: "hash" }))
      .toThrow("Allocation CSV is incomplete");
    const unknown = replaceFacility(allocationTemplateCsv(dataset), "6 Girls", "T3a", "Mystery Hall");
    expect(() => applyAllocationCsv(dataset, unknown, { name: "unknown.csv", sha256: "hash" }))
      .toThrow("uses unknown facility 'Mystery Hall'");
  });
});
