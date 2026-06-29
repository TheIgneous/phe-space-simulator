import { FACILITY_BY_ID, isFacilityUnavailable, relocationPoolFor } from "./facilities";
import { SLOT_MINUTES } from "./generation-grid";
import type { FacilityId, FacilityView, Issue, OccupancyEvent, Selection, SimulationDataset, TermId, WeekId } from "../types";

export const DAY_START = 8 * 60;
export const DAY_END = 15 * 60;

export function formatTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function isEventActive(event: OccupancyEvent, selection: Selection): boolean {
  return (
    event.term === selection.term &&
    event.weeks.includes(selection.week) &&
    event.day === selection.day &&
    event.start <= selection.time &&
    selection.time < event.end
  );
}

export function eventsForSelection(dataset: SimulationDataset, selection: Selection): OccupancyEvent[] {
  return dataset.events.filter((event) => isEventActive(event, selection));
}

function relocationAnalysis(
  facilityId: FacilityId,
  facilities: SimulationDataset["facilities"],
  activeEvents: OccupancyEvent[],
  term: TermId,
): { workable: boolean; alternatives: string[] } {
  const pool = relocationPoolFor(facilityId);
  if (!pool) return { workable: false, alternatives: [] };

  let totalDeficit = 0;
  let totalSpare = 0;
  const alternatives: string[] = [];
  for (const id of pool) {
    const facility = facilities.find((candidate) => candidate.id === id);
    if (!facility) continue;
    const occupancy = activeEvents.filter((event) => event.facilityId === id).length;
    const usableCapacity = isFacilityUnavailable(facility, term) ? 0 : facility.capacity;
    totalDeficit += Math.max(0, occupancy - usableCapacity);
    const spare = Math.max(0, usableCapacity - occupancy);
    totalSpare += spare;
    if (id !== facilityId && spare > 0) alternatives.push(facility.name);
  }

  return { workable: totalDeficit > 0 && totalSpare >= totalDeficit, alternatives };
}

export function getFacilityViews(dataset: SimulationDataset, selection: Selection): FacilityView[] {
  const active = eventsForSelection(dataset, selection);
  const byFacility = new Map<FacilityId, OccupancyEvent[]>();
  for (const event of active) {
    const events = byFacility.get(event.facilityId) ?? [];
    events.push(event);
    byFacility.set(event.facilityId, events);
  }

  return dataset.facilities.map((facility) => {
    const events = byFacility.get(facility.id) ?? [];
    if (isFacilityUnavailable(facility, selection.term)) {
      return {
        facility,
        events,
        status: events.length > 0 ? "conflict" : "unavailable",
        label: facility.unavailableReason ?? "Unavailable",
      };
    }
    if (events.length > facility.capacity) {
      const relocation = relocationAnalysis(facility.id, dataset.facilities, active, selection.term);
      return {
        facility,
        events,
        status: relocation.workable ? "conditional" : "conflict",
        label: `${events.length} / ${facility.capacity}`,
      };
    }
    if (events.length > 0) {
      return { facility, events, status: "occupied", label: `${events.length} / ${facility.capacity}` };
    }
    return { facility, events, status: "available", label: "Available" };
  });
}

function issueForInterval(
  facilityId: FacilityId,
  events: OccupancyEvent[],
  term: TermId,
  week: WeekId,
  day: number,
  start: number,
  end: number,
  facilities: SimulationDataset["facilities"],
  intervalEvents: OccupancyEvent[],
): Issue | null {
  const facility = FACILITY_BY_ID.get(facilityId);
  if (!facility || events.length === 0) return null;
  const sortedIds = events.map((event) => event.id).sort();
  const suffix = `${facilityId}-${term}-${week}-${day}-${start}-${sortedIds.join("-")}`;

  if (isFacilityUnavailable(facility, term)) {
    return {
      id: `unavailable-${suffix}`,
      severity: "non-workable",
      type: "unavailable",
      facilityId,
      term,
      week,
      day: day as 0 | 1 | 2 | 3 | 4,
      start,
      end,
      title: `${facility.name} is unavailable`,
      detail: facility.unavailableReason ?? "Facility unavailable",
      eventIds: sortedIds,
    };
  }

  if (events.length > facility.capacity) {
    const relocation = relocationAnalysis(facilityId, facilities, intervalEvents, term);
    const overflow = events.length - facility.capacity;
    return {
      id: `capacity-${suffix}`,
      severity: relocation.workable ? "workable" : "non-workable",
      type: "capacity",
      facilityId,
      term,
      week,
      day: day as 0 | 1 | 2 | 3 | 4,
      start,
      end,
      title: facility.name,
      detail: relocation.workable
        ? `Workable — move ${overflow} group${overflow === 1 ? "" : "s"} to ${relocation.alternatives.join(" or ")}.`
        : `Non-workable — ${events.length} / ${facility.capacity} occupancy and no confirmed suitable alternative is available.`,
      eventIds: sortedIds,
    };
  }
  return null;
}

export function getTermIssues(dataset: SimulationDataset, term: TermId, week: WeekId): Issue[] {
  const relevant = dataset.events.filter((event) => event.term === term && event.weeks.includes(week));
  const issues: Issue[] = [];

  for (let day = 0; day < 5; day += 1) {
    const dayEvents = relevant.filter((event) => event.day === day);
    const boundaries = [...new Set([DAY_START, DAY_END, ...dayEvents.flatMap((event) => [event.start, event.end])])].sort(
      (left, right) => left - right,
    );
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index]!;
      const end = boundaries[index + 1]!;
      if (start === end) continue;
      const intervalEvents = dayEvents.filter((event) => event.start < end && start < event.end);
      for (const facility of dataset.facilities) {
        const active = intervalEvents.filter(
          (event) => event.facilityId === facility.id && event.start < end && start < event.end,
        );
        const issue = issueForInterval(facility.id, active, term, week, day, start, end, dataset.facilities, intervalEvents);
        if (issue) issues.push(issue);
      }
    }
  }

  return issues;
}

export function getCurrentIssues(issues: Issue[], selection: Selection): Issue[] {
  return issues.filter(
    (issue) =>
      issue.term === selection.term &&
      issue.week === selection.week &&
      issue.day === selection.day &&
      issue.start !== undefined &&
      issue.end !== undefined &&
      issue.start <= selection.time &&
      selection.time < issue.end,
  );
}

export function getStepTimes(dataset: SimulationDataset, selection: Omit<Selection, "time">): number[] {
  const atomicTimes = Array.from(
    { length: (DAY_END - DAY_START) / SLOT_MINUTES + 1 },
    (_, index) => DAY_START + index * SLOT_MINUTES,
  );
  const eventTimes = dataset.events
    .filter(
      (event) => event.term === selection.term && event.weeks.includes(selection.week) && event.day === selection.day,
    )
    .flatMap((event) => [event.start, event.end]);
  const periodTimes = dataset.periods.flatMap((period) => [period.start, period.end]);
  return [...new Set([...atomicTimes, ...periodTimes, ...eventTimes])]
    .filter((time) => time >= DAY_START && time <= DAY_END)
    .sort((left, right) => left - right);
}

export function findAdjacentStep(steps: number[], current: number, direction: -1 | 1): number {
  if (direction === 1) return steps.find((step) => step > current) ?? DAY_END;
  return [...steps].reverse().find((step) => step < current) ?? DAY_START;
}
