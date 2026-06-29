export const SLOT_MINUTES = 10;

export interface TimeRange {
  start: number;
  end: number;
}

export interface GenerationGrid {
  dayStart: number;
  dayEnd: number;
  slotMinutes: number;
  slotCount: number;
}

export function createGenerationGrid(dayStart: number, dayEnd: number): GenerationGrid {
  const duration = dayEnd - dayStart;
  if (duration <= 0 || duration % SLOT_MINUTES !== 0) {
    throw new Error("The school day must be a positive whole number of 10-minute slots.");
  }

  return {
    dayStart,
    dayEnd,
    slotMinutes: SLOT_MINUTES,
    slotCount: duration / SLOT_MINUTES,
  };
}

export function minutesToSlot(minutes: number, grid: GenerationGrid): number {
  const offset = minutes - grid.dayStart;
  if (offset < 0 || minutes > grid.dayEnd || offset % grid.slotMinutes !== 0) {
    throw new Error(`Time ${minutes} is outside the generation grid or is not 10-minute aligned.`);
  }
  return offset / grid.slotMinutes;
}

export function durationToSlots(minutes: number, grid: GenerationGrid): number {
  if (minutes <= 0 || minutes % grid.slotMinutes !== 0) {
    throw new Error(`Duration ${minutes} is not a positive whole number of 10-minute slots.`);
  }
  return minutes / grid.slotMinutes;
}

export function rangesOverlap(left: TimeRange, right: TimeRange): boolean {
  return left.start < right.end && right.start < left.end;
}

export function candidateStartSlots(
  grid: GenerationGrid,
  durationSlots: number,
  unavailable: TimeRange[],
): number[] {
  if (!Number.isInteger(durationSlots) || durationSlots <= 0) {
    throw new Error("Lesson duration must be a positive whole number of slots.");
  }

  const blocked = unavailable.map((range) => ({
    start: minutesToSlot(range.start, grid),
    end: minutesToSlot(range.end, grid),
  }));
  const starts: number[] = [];

  for (let start = 0; start + durationSlots <= grid.slotCount; start += 1) {
    const lesson = { start, end: start + durationSlots };
    if (!blocked.some((range) => rangesOverlap(lesson, range))) starts.push(start);
  }

  return starts;
}

export type RelationshipConversion = "unchanged" | "overlap-aware" | "duration-aware" | "disabled-review";

export function relationshipConversion(type: string, disabled: boolean): RelationshipConversion {
  if (disabled) return "disabled-review";
  if (type === "a_21") return "overlap-aware";
  if (type === "n_0" || type === "a_10") return "duration-aware";
  return "unchanged";
}
