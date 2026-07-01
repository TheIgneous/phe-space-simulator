import { useMemo } from "react";
import { FACILITY_BY_ID } from "../domain/facilities";
import { DAY_END, DAY_START, formatTime, hourMarks } from "../domain/simulation";
import { DAYS, type OccupancyEvent, type PeriodDefinition, type SimulationDataset, type TermId } from "../types";

/** Vertical scale of the calendar: pixels per minute of the school day. */
const PX_PER_MIN = 1.5;
const SPAN = DAY_END - DAY_START;
const topOf = (time: number): number => (time - DAY_START) * PX_PER_MIN;

/** Distinct colours assigned to each overlaid class, cycled if there are more classes than colours. */
const CLASS_COLORS = [
  { bg: "#e3edfb", border: "#3b6fb6", text: "#274c86" },
  { bg: "#e6f4ec", border: "#2f9463", text: "#1f6a45" },
  { bg: "#fceccf", border: "#c98a1e", text: "#8a5e10" },
  { bg: "#f7e2ec", border: "#c14b82", text: "#8f2f5c" },
  { bg: "#ece3fb", border: "#7b57c9", text: "#553b93" },
  { bg: "#dbf0f2", border: "#2b98a6", text: "#1c6c76" },
];

const facilityName = (facilityId: OccupancyEvent["facilityId"]): string => FACILITY_BY_ID.get(facilityId)?.name ?? facilityId;
const schoolOf = (events: OccupancyEvent[]): "PYP" | "MYP" => (events.some((event) => event.phase === "Secondary") ? "MYP" : "PYP");

/** The event's period label in its *own* school's timetable, e.g. "MYP P2" — how the two grids reconcile. */
function periodTag(event: OccupancyEvent, periods: PeriodDefinition[]): string {
  const source = event.phase === "Secondary" ? "MYP" : "PYP";
  const def = periods.find((period) => period.source === source && period.start === event.start);
  return def ? `${source} ${def.label}` : source;
}

/** Pack a day's events into columns so time-overlapping sessions sit side by side instead of colliding. */
function packDay(events: OccupancyEvent[]): { laneOf: Map<string, number>; lanes: number } {
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const event of [...events].sort((left, right) => left.start - right.start || left.end - right.end)) {
    let lane = laneEnds.findIndex((end) => end <= event.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(event.end);
    } else {
      laneEnds[lane] = event.end;
    }
    laneOf.set(event.id, lane);
  }
  return { laneOf, lanes: Math.max(laneEnds.length, 1) };
}

/** Event ids that genuinely coincide (same day, intersecting weeks, overlapping time) and the shaded bands to draw. */
function dayOverlaps(events: OccupancyEvent[]): { ids: Set<string>; bands: Array<[number, number]> } {
  const ids = new Set<string>();
  const raw: Array<[number, number]> = [];
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      const a = events[i]!;
      const b = events[j]!;
      if (a.cohort === b.cohort) continue;
      if (!(a.start < b.end && b.start < a.end)) continue;
      if (!a.weeks.some((week) => b.weeks.includes(week))) continue;
      ids.add(a.id);
      ids.add(b.id);
      raw.push([Math.max(a.start, b.start), Math.min(a.end, b.end)]);
    }
  }
  // Merge the bands so overlapping highlights don't stack into darker patches.
  raw.sort((left, right) => left[0] - right[0]);
  const bands: Array<[number, number]> = [];
  for (const [start, end] of raw) {
    const last = bands[bands.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else bands.push([start, end]);
  }
  return { ids, bands };
}

interface ClassOverlayProps {
  dataset: SimulationDataset;
  term: TermId;
  selected: string[];
}

export function ClassOverlay({ dataset, term, selected }: ClassOverlayProps) {
  const lanes = useMemo(() => {
    return selected.map((cohort, index) => {
      const events = dataset.events.filter((event) => event.kind === "PHE" && event.cohort === cohort);
      const termEvents = events.filter((event) => event.term === term);
      return {
        cohort,
        color: CLASS_COLORS[index % CLASS_COLORS.length]!,
        school: schoolOf(events),
        events: termEvents,
      };
    });
  }, [dataset.events, selected, term]);

  const schools = new Set(lanes.map((lane) => lane.school));
  const mixedSchools = schools.size > 1;
  const colorOf = useMemo(() => new Map(lanes.map((lane) => [lane.cohort, lane.color])), [lanes]);
  const allTermEvents = useMemo(() => lanes.flatMap((lane) => lane.events), [lanes]);
  const trackHeight = SPAN * PX_PER_MIN;

  if (selected.length === 0) {
    return <p className="report-empty">Select two or more classes above to overlay their weekly timetables.</p>;
  }

  return (
    <div className="cov">
      <div className="cov-legend">
        {lanes.map((lane) => (
          <span className="cov-legend-item" key={lane.cohort}>
            <i style={{ background: lane.color.bg, borderColor: lane.color.border }} />
            {lane.cohort}
            <em>{lane.school}</em>
          </span>
        ))}
      </div>

      {mixedSchools ? (
        <p className="cov-reconcile">
          These classes follow different school timetables ({[...schools].join(" and ")}), whose periods don't line up. Sessions
          are placed on a shared <strong>clock-time</strong> axis, and each block is tagged with its own school's period (e.g.
          <span className="cov-tag-example">MYP&nbsp;P2</span>). Shaded bands mark times when the selected classes genuinely coincide.
        </p>
      ) : null}

      <div className="cov-grid">
        <div className="cov-gutter" style={{ height: trackHeight }} aria-hidden="true">
          {hourMarks().map((time) => (
            <span key={time} style={{ top: topOf(time) }}>{formatTime(time)}</span>
          ))}
        </div>

        {DAYS.map((day, dayIndex) => {
          const dayEvents = allTermEvents.filter((event) => event.day === dayIndex);
          const { laneOf, lanes: laneCount } = packDay(dayEvents);
          const { ids: overlapIds, bands } = dayOverlaps(dayEvents);
          return (
            <div className="cov-day" key={day}>
              <div className="cov-day-head">{day}</div>
              <div className="cov-day-track" style={{ height: trackHeight }}>
                {hourMarks().map((time) => (
                  <div className="cov-hourline" key={time} style={{ top: topOf(time) }} aria-hidden="true" />
                ))}
                {bands.map(([start, end], index) => (
                  <div
                    className="cov-overlap-band"
                    key={`band-${index}`}
                    style={{ top: topOf(start), height: (end - start) * PX_PER_MIN }}
                    aria-hidden="true"
                  />
                ))}
                {dayEvents.map((event) => {
                  const lane = laneOf.get(event.id) ?? 0;
                  const color = colorOf.get(event.cohort)!;
                  const overlapping = overlapIds.has(event.id);
                  return (
                    <div
                      className={`cov-block${overlapping ? " cov-block-overlap" : ""}`}
                      key={event.id}
                      style={{
                        top: topOf(event.start) + 1,
                        height: Math.max((event.end - event.start) * PX_PER_MIN - 2, 16),
                        left: `calc(${(lane / laneCount) * 100}% + 2px)`,
                        width: `calc(${100 / laneCount}% - 4px)`,
                        background: color.bg,
                        borderColor: color.border,
                        color: color.text,
                      }}
                      title={`${event.cohort} · ${event.activity} · ${facilityName(event.facilityId)} · ${periodTag(event, dataset.periods)} · ${formatTime(event.start)}–${formatTime(event.end)}${event.weeks.length === 1 ? ` · Wk ${event.weeks[0]}` : ""}`}
                    >
                      <strong>{event.cohort}</strong>
                      <span className="cov-block-act">{event.activity}</span>
                      <span className="cov-block-loc">{facilityName(event.facilityId)}</span>
                      <span className="cov-block-meta">{periodTag(event, dataset.periods)}{event.weeks.length === 1 ? ` · Wk ${event.weeks[0]}` : ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
