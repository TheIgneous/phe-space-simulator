/**
 * Baseline PHE unit titles always offered in the planner, merged with whatever units already
 * exist in the loaded allocations plus any titles staff create in the planning section.
 * "Yoga" is included here so it is always selectable.
 */
export const BASE_UNITS = [
  "Athletics",
  "Dance",
  "Fitness",
  "Gymnastics",
  "Swimming",
  "Yoga",
];

/** Unique, human-sorted unit list from the base units plus any extras (activities, custom titles). */
export function mergeUnits(...sources: string[][]): string[] {
  const units = new Set<string>();
  for (const source of sources) {
    for (const unit of source) {
      const trimmed = unit.trim();
      if (trimmed) units.add(trimmed);
    }
  }
  return [...units].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}
