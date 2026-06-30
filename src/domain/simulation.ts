import { FACILITY_BY_ID, displayCapacity, isFacilityUnavailable, relocationPoolFor } from "./facilities";
import { SLOT_MINUTES } from "./generation-grid";
import type { Facility, FacilityId, FacilityView, Issue, OccupancyEvent, PeriodDefinition, Selection, SimulationDataset, TermId, WeekId } from "../types";

// Viewable school-day window. Starts at 07:30 so the MYP P1 (07:45) is fully visible; kept on a
// 10-minute boundary so the generation grid stays aligned.
export const DAY_START = 7 * 60 + 30;
export const DAY_END = 15 * 60;

export function formatTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Whole-hour tick marks within the viewable day (e.g. 08:00 … 15:00), used by the timeline rulers. */
export function hourMarks(): number[] {
  const marks: number[] = [];
  for (let time = Math.ceil(DAY_START / 60) * 60; time <= DAY_END; time += 60) marks.push(time);
  return marks;
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

interface TimeWindow {
  start: number;
  end: number;
}

/** Break/lunch windows: lunch-flagged periods plus the gaps between consecutive same-phase periods. */
function breakLunchWindows(periods: PeriodDefinition[]): TimeWindow[] {
  const windows: TimeWindow[] = [];
  for (const period of periods) {
    if (period.lunch) windows.push({ start: period.start, end: period.end });
  }
  for (const source of ["PYP", "MYP"] as const) {
    const sorted = periods.filter((period) => period.source === source).sort((left, right) => left.start - right.start);
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const gapStart = sorted[index]!.end;
      const gapEnd = sorted[index + 1]!.start;
      if (gapEnd > gapStart) windows.push({ start: gapStart, end: gapEnd });
    }
  }
  return windows;
}

const inBreakOrLunch = (windows: TimeWindow[], start: number, end: number): boolean =>
  windows.some((window) => start < window.end && window.start < end);

/**
 * Decide whether an over-capacity space is a workable (amber) or non-workable (red) clash.
 * A space with a `workableCapacity` (Main Pool, pitches) absorbs that many groups as low risk —
 * except a `workableCapacityClassTimeOnly` space (Main Pitches) is non-workable at break/lunch.
 * Otherwise — or for spaces without a soft cap (gym zones) — it falls back to relocation capacity.
 */
function assessOverCapacity(
  facility: Facility,
  occupancy: number,
  facilities: SimulationDataset["facilities"],
  activeEvents: OccupancyEvent[],
  term: TermId,
  duringBreakOrLunch: boolean,
): { workable: boolean; detail: string } {
  if (facility.workableCapacity !== undefined && occupancy <= facility.workableCapacity) {
    if (facility.workableCapacityClassTimeOnly && duringBreakOrLunch) {
      return { workable: false, detail: `Non-workable — the ${facility.name} cannot take a second group during break or lunch.` };
    }
    return { workable: true, detail: `Workable — the ${facility.name} can run ${facility.workableCapacity} groups at once.` };
  }
  const relocation = relocationAnalysis(facility.id, facilities, activeEvents, term);
  const overflow = occupancy - facility.capacity;
  return relocation.workable
    ? { workable: true, detail: `Workable — move ${overflow} group${overflow === 1 ? "" : "s"} to ${relocation.alternatives.join(" or ")}.` }
    : { workable: false, detail: `Non-workable — ${occupancy} / ${facility.capacity} occupancy and no confirmed suitable alternative is available.` };
}

export function getFacilityViews(dataset: SimulationDataset, selection: Selection): FacilityView[] {
  const active = eventsForSelection(dataset, selection);
  const byFacility = new Map<FacilityId, OccupancyEvent[]>();
  for (const event of active) {
    const events = byFacility.get(event.facilityId) ?? [];
    events.push(event);
    byFacility.set(event.facilityId, events);
  }
  const duringBreakOrLunch = inBreakOrLunch(breakLunchWindows(dataset.periods), selection.time, selection.time + 1);

  return dataset.facilities.map((datasetFacility) => {
    // Capacity/workability rules live in code, so prefer the canonical facility over the snapshot's
    // serialized copy (which may predate a rule change like the pitch/pool soft capacities).
    const facility = FACILITY_BY_ID.get(datasetFacility.id) ?? datasetFacility;
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
      const assessment = assessOverCapacity(facility, events.length, dataset.facilities, active, selection.term, duringBreakOrLunch);
      return {
        facility,
        events,
        status: assessment.workable ? "conditional" : "conflict",
        label: `${events.length} / ${displayCapacity(facility)}`,
      };
    }
    if (events.length > 0) {
      return { facility, events, status: "occupied", label: `${events.length} / ${displayCapacity(facility)}` };
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
  duringBreakOrLunch: boolean,
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
    const assessment = assessOverCapacity(facility, events.length, facilities, intervalEvents, term, duringBreakOrLunch);
    return {
      id: `capacity-${suffix}`,
      severity: assessment.workable ? "workable" : "non-workable",
      type: "capacity",
      facilityId,
      term,
      week,
      day: day as 0 | 1 | 2 | 3 | 4,
      start,
      end,
      title: facility.name,
      detail: assessment.detail,
      eventIds: sortedIds,
    };
  }
  return null;
}

export function getTermIssues(dataset: SimulationDataset, term: TermId, week: WeekId): Issue[] {
  const relevant = dataset.events.filter((event) => event.term === term && event.weeks.includes(week));
  const windows = breakLunchWindows(dataset.periods);
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
      const duringBreakOrLunch = inBreakOrLunch(windows, start, end);
      for (const facility of dataset.facilities) {
        const active = intervalEvents.filter(
          (event) => event.facilityId === facility.id && event.start < end && start < event.end,
        );
        const issue = issueForInterval(facility.id, active, term, week, day, start, end, dataset.facilities, intervalEvents, duringBreakOrLunch);
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
