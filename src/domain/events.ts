import type { OccupancyEvent } from "../types";

/**
 * Collapse duplicate occupancies into one. Several homeroom classes can map to the same
 * PHE cohort (e.g. every Grade-2 class becomes "Grade 2 Boys"/"Grade 2 Girls"), so a single
 * timetabled slot can emit the same group/space/time more than once. Merge events that share
 * source, kind, cohort, term, weeks, day, time, space and unit — unioning their class lists
 * and teachers — so the viewer shows one occupancy instead of phantom duplicates.
 *
 * Kept dependency-free (types only) so both the browser importer and the Node ingest CLI can
 * use it without pulling DOM types into the Node build.
 */
export function dedupeEvents(events: OccupancyEvent[]): OccupancyEvent[] {
  const merged = new Map<string, OccupancyEvent>();
  for (const event of events) {
    const key = [
      event.source,
      event.kind,
      event.cohort,
      event.term,
      [...event.weeks].sort().join(""),
      event.day,
      event.start,
      event.end,
      event.facilityId,
      event.activity,
    ].join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...event, classes: [...event.classes], teachers: [...event.teachers] });
      continue;
    }
    existing.classes = [...new Set([...existing.classes, ...event.classes])];
    existing.teachers = [...new Set([...existing.teachers, ...event.teachers])];
  }
  return [...merged.values()];
}
