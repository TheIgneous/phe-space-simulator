import snapshot from "../data/snapshot.json";
import { FACILITIES } from "./facilities";
import { getFacilityViews, getStepTimes, getTermIssues } from "./simulation";
import type { OccupancyEvent, SimulationDataset, TermId } from "../types";

const dataset = snapshot as SimulationDataset;

function event(overrides: Partial<OccupancyEvent>): OccupancyEvent {
  return {
    id: "event",
    source: "secondary",
    phase: "Secondary",
    term: "T3a",
    weeks: ["A", "B"],
    day: 3,
    start: 13 * 60,
    end: 14 * 60,
    facilityId: "secondary-gym-1",
    cohort: "6 Girls",
    classes: ["6A", "6B", "6C"],
    activity: "Indoor Team Sports",
    teachers: ["Aimee"],
    kind: "PHE",
    ...overrides,
  };
}

function synthetic(events: OccupancyEvent[]): SimulationDataset {
  return {
    metadata: { generatedAt: "2026-06-27T00:00:00.000Z", academicYear: "2026/27", sources: [], privacy: "sanitized" },
    facilities: FACILITIES,
    staff: [],
    assignments: [],
    periods: [],
    events,
    warnings: [],
  };
}

function issueCohorts(term: TermId): string[][] {
  const eventById = new Map(dataset.events.map((item) => [item.id, item]));
  return getTermIssues(dataset, term, "A").map((issue) =>
    issue.eventIds.map((id) => eventById.get(id)?.cohort ?? ""),
  );
}

describe("simulation regression model", () => {
  it("has no Grade 6 versus Grade 8 clash in either T1 half-term", () => {
    for (const term of ["T1a", "T1b"] as const) {
      expect(issueCohorts(term).some((cohorts) => cohorts.some((name) => name.startsWith("6 ")) && cohorts.some((name) => name.startsWith("8 ")))).toBe(false);
    }
  });

  it("finds both Grade 6 versus Grade 8 gym clashes on T3a Thursday at 13:00", () => {
    const issues = getTermIssues(dataset, "T3a", "A").filter((issue) => issue.day === 3 && issue.start === 13 * 60);
    expect(issues.map((issue) => issue.title)).toEqual(expect.arrayContaining(["Secondary Gym 1", "Secondary Gym 2"]));
  });

  it("models Grade 2 Boys and Girls as simultaneous split events", () => {
    const boys = dataset.events.find((item) => item.cohort === "Grade 2 Boys" && item.term === "T1a");
    expect(boys).toBeDefined();
    expect(dataset.events.some((item) => item.cohort === "Grade 2 Girls" && item.term === boys?.term && item.day === boys?.day && item.start === boys?.start)).toBe(true);
  });

  it("allows two simultaneous tennis groups at capacity", () => {
    const tennisDataset = synthetic([
      event({ id: "tennis-1", facilityId: "tennis-courts", cohort: "9 Girls" }),
      event({ id: "tennis-2", facilityId: "tennis-courts", cohort: "9 Boys" }),
    ]);
    const view = getFacilityViews(tennisDataset, { term: "T3a", week: "A", day: 3, time: 13 * 60 })
      .find((item) => item.facility.id === "tennis-courts");
    expect(view?.status).toBe("occupied");
    expect(getTermIssues(tennisDataset, "T3a", "A")).toHaveLength(0);
  });

  it("classifies a gym clash as workable when the gym zone pool has enough spare capacity", () => {
    const gymDataset = synthetic([
      event({ id: "grade-2", facilityId: "primary-gym-2", cohort: "Grade 2 Boys" }),
      event({ id: "grade-4", facilityId: "primary-gym-2", cohort: "Grade 4 Boys" }),
      event({ id: "grade-7", facilityId: "secondary-gym-1", cohort: "7 Girls" }),
    ]);
    const selection = { term: "T3a", week: "A", day: 3, time: 13 * 60 } as const;
    const issue = getTermIssues(gymDataset, "T3a", "A").find((item) => item.facilityId === "primary-gym-2");
    const view = getFacilityViews(gymDataset, selection).find((item) => item.facility.id === "primary-gym-2");

    expect(issue?.severity).toBe("workable");
    expect(issue?.detail).toContain("Primary Gym 1 or Secondary Gym 2");
    expect(view?.status).toBe("conditional");
  });

  it("classifies a gym clash as non-workable when every alternative is occupied", () => {
    const gymDataset = synthetic([
      event({ id: "conflict-1", facilityId: "primary-gym-2" }),
      event({ id: "conflict-2", facilityId: "primary-gym-2" }),
      event({ id: "primary-1", facilityId: "primary-gym-1" }),
      event({ id: "secondary-1", facilityId: "secondary-gym-1" }),
      event({ id: "secondary-2", facilityId: "secondary-gym-2" }),
    ]);
    const issue = getTermIssues(gymDataset, "T3a", "A").find((item) => item.facilityId === "primary-gym-2");

    expect(issue?.severity).toBe("non-workable");
    expect(issue?.detail).toContain("no confirmed suitable alternative");
  });

  it("does not reuse one spare gym zone to mitigate two simultaneous clashes", () => {
    const gymDataset = synthetic([
      event({ id: "p1-a", facilityId: "primary-gym-1" }),
      event({ id: "p1-b", facilityId: "primary-gym-1" }),
      event({ id: "p2-a", facilityId: "primary-gym-2" }),
      event({ id: "p2-b", facilityId: "primary-gym-2" }),
      event({ id: "s1", facilityId: "secondary-gym-1" }),
    ]);
    const capacityIssues = getTermIssues(gymDataset, "T3a", "A").filter((item) => item.type === "capacity");

    expect(capacityIssues).toHaveLength(2);
    expect(capacityIssues.every((issue) => issue.severity === "non-workable")).toBe(true);
  });

  it("treats Main and Side Pools as independent resources", () => {
    const poolDataset = synthetic([
      event({ id: "main", facilityId: "main-pool", cohort: "8 Boys" }),
      event({ id: "side", facilityId: "side-pool", cohort: "EY1" }),
    ]);
    expect(getTermIssues(poolDataset, "T3a", "A")).toHaveLength(0);
  });

  it("treats two classes in the Main Pool as a workable (low-risk) clash, not a hard clash", () => {
    const poolDataset = synthetic([
      event({ id: "mp-1", facilityId: "main-pool", cohort: "6 Boys" }),
      event({ id: "mp-2", facilityId: "main-pool", cohort: "8 Boys" }),
    ]);
    const selection = { term: "T3a", week: "A", day: 3, time: 13 * 60 } as const;
    const view = getFacilityViews(poolDataset, selection).find((item) => item.facility.id === "main-pool");
    const issue = getTermIssues(poolDataset, "T3a", "A").find((item) => item.facilityId === "main-pool");
    expect(view?.status).toBe("conditional");
    expect(view?.label).toBe("2 / 2");
    expect(issue?.severity).toBe("workable");
  });

  it("treats three classes in the Main Pool as a non-workable clash", () => {
    const poolDataset = synthetic([
      event({ id: "mp-1", facilityId: "main-pool", cohort: "6 Boys" }),
      event({ id: "mp-2", facilityId: "main-pool", cohort: "8 Boys" }),
      event({ id: "mp-3", facilityId: "main-pool", cohort: "7 Boys" }),
    ]);
    const issue = getTermIssues(poolDataset, "T3a", "A").find((item) => item.facilityId === "main-pool");
    expect(issue?.severity).toBe("non-workable");
  });

  it("keeps two classes in the Side Pool a non-workable clash", () => {
    const poolDataset = synthetic([
      event({ id: "sp-1", facilityId: "side-pool", cohort: "Minis" }),
      event({ id: "sp-2", facilityId: "side-pool", cohort: "EY1" }),
    ]);
    const issue = getTermIssues(poolDataset, "T3a", "A").find((item) => item.facilityId === "side-pool");
    expect(issue?.severity).toBe("non-workable");
  });

  it("marks the outdoor EY Pool unavailable in hot half-terms", () => {
    const view = getFacilityViews(synthetic([]), { term: "T3b", week: "A", day: 0, time: 8 * 60 })
      .find((item) => item.facility.id === "ey-pool");
    expect(view?.status).toBe("unavailable");
    expect(view?.label).toContain("hot term");
  });

  it("contains no student-shaped fields anywhere in the generated snapshot", () => {
    const forbiddenKeys = new Set(["student", "students", "studentid", "studentids", "firstname", "lastname", "email", "mobile"]);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          expect(forbiddenKeys.has(key.toLowerCase())).toBe(false);
          visit(child);
        }
      }
    };
    visit(dataset);
  });

  it("steps through the day on the 10-minute generation grid", () => {
    const steps = getStepTimes(dataset, { term: "T3a", week: "A", day: 3 });
    expect(steps).toContain(13 * 60 + 10);
    expect(steps).not.toContain(13 * 60 + 5);
  });
});
