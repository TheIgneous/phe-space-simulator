import type { PheAssignment, SimulationDataset } from "../types";

export function applyPlanAssignments(current: SimulationDataset, assignments: PheAssignment[]): SimulationDataset {
  const byKey = new Map(assignments.map((assignment) => [`${assignment.cohort}|${assignment.term}`, assignment]));
  return {
    ...current,
    metadata: { ...current.metadata, generatedAt: new Date().toISOString() },
    assignments: assignments.map((assignment) => ({ ...assignment, teachers: [...assignment.teachers] })),
    events: current.events.map((event) => {
      if (event.kind !== "PHE") return event;
      const assignment = byKey.get(`${event.cohort}|${event.term}`);
      if (!assignment?.facilityId) return event;
      return {
        ...event,
        facilityId: assignment.facilityId,
        activity: assignment.activity,
        teachers: assignment.teachers.length > 0 ? assignment.teachers : event.teachers,
      };
    }),
  };
}
