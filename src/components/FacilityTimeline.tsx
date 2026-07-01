import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { FACILITY_BY_ID, FACILITY_GROUPS, isFacilityUnavailable } from "../domain/facilities";
import { DAY_END, DAY_START, formatTime, hourMarks } from "../domain/simulation";
import { SLOT_MINUTES } from "../domain/generation-grid";
import type { Issue, OccupancyEvent, PeriodDefinition, Selection, SimulationDataset } from "../types";

const SPAN = DAY_END - DAY_START;
const GUTTER = 150;
const pct = (time: number): number => ((time - DAY_START) / SPAN) * 100;
const fractionOf = (time: number): number => (time - DAY_START) / SPAN;
const clampTime = (time: number): number => Math.min(DAY_END, Math.max(DAY_START, time));

type BarStatus = "primary" | "secondary" | "existing" | "workable" | "non-workable";
type Severity = "workable" | "non-workable";

const STATUS_TEXT: Record<Severity, string> = { workable: "Workable clash", "non-workable": "Non-workable clash" };
const genderInitial = (cohort: string): string => cohort.match(/(Boys|Girls)$/)?.[1]?.[0] ?? "";

/** Bar label: the actual class name(s) plus a gender initial, e.g. "3LC B". */
function barLabel(event: OccupancyEvent): string {
  const classes = event.classes.length > 0 ? event.classes.join(" + ") : event.cohort;
  const initial = genderInitial(event.cohort);
  return initial ? `${classes} ${initial}` : classes;
}

interface FacilityTimelineProps {
  dataset: SimulationDataset;
  selection: Selection;
  termIssues: Issue[];
  onScrub: (time: number) => void;
}

/** Pack a lane's events into sub-rows so overlapping (clashing) bookings stack instead of colliding. */
function stackRows(events: OccupancyEvent[]): { rowOf: Map<string, number>; rowCount: number } {
  const sorted = [...events].sort((left, right) => left.start - right.start || left.end - right.end);
  const rowEnds: number[] = [];
  const rowOf = new Map<string, number>();
  for (const event of sorted) {
    let row = rowEnds.findIndex((end) => end <= event.start);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(event.end);
    } else {
      rowEnds[row] = event.end;
    }
    rowOf.set(event.id, row);
  }
  return { rowOf, rowCount: Math.max(rowEnds.length, 1) };
}

interface Selected {
  event: OccupancyEvent;
  x: number;
  y: number;
}

export function FacilityTimeline({ dataset, selection, termIssues, onScrub }: FacilityTimelineProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Selected | null>(null);

  // Close the details popover when clicking away, pressing Escape, or changing the day/term/week.
  useEffect(() => {
    if (!selected) return;
    const onDown = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".tl-pop") && !target.closest(".tl-bar")) setSelected(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [selected]);

  // Ignore a stale selection once the day/term/week moves off the selected booking.
  const active = selected
    && selected.event.term === selection.term
    && selected.event.day === selection.day
    && selected.event.weeks.includes(selection.week)
    ? selected
    : null;

  const eventsByFacility = useMemo(() => {
    const map = new Map<string, OccupancyEvent[]>();
    for (const event of dataset.events) {
      if (event.term !== selection.term || !event.weeks.includes(selection.week) || event.day !== selection.day) continue;
      const list = map.get(event.facilityId) ?? [];
      list.push(event);
      map.set(event.facilityId, list);
    }
    return map;
  }, [dataset.events, selection.term, selection.week, selection.day]);

  const severityByEvent = useMemo(() => {
    const map = new Map<string, Severity>();
    for (const issue of termIssues) {
      if (issue.day !== selection.day || issue.type === "data") continue;
      for (const id of issue.eventIds) {
        if (issue.severity === "non-workable" || !map.has(id)) map.set(id, issue.severity as Severity);
      }
    }
    return map;
  }, [termIssues, selection.day]);

  const barStatus = (event: OccupancyEvent): BarStatus => {
    const severity = severityByEvent.get(event.id);
    if (severity) return severity;
    if (event.kind === "existing-booking") return "existing";
    return event.phase === "Secondary" ? "secondary" : "primary";
  };

  const scrubFromTrack = (clientX: number, track: HTMLElement) => {
    const rect = track.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onScrub(clampTime(Math.round((DAY_START + fraction * SPAN) / SLOT_MINUTES) * SLOT_MINUTES));
  };
  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubFromTrack(event.clientX, event.currentTarget);
  };
  const onTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons === 1) scrubFromTrack(event.clientX, event.currentTarget);
  };

  const openDetails = (event: OccupancyEvent, mouse: ReactMouseEvent<HTMLButtonElement>) => {
    const grid = gridRef.current;
    if (!grid) return;
    const gridRect = grid.getBoundingClientRect();
    const barRect = mouse.currentTarget.getBoundingClientRect();
    const x = Math.max(6, Math.min(barRect.left - gridRect.left, gridRect.width - 236));
    setSelected({ event, x, y: barRect.bottom - gridRect.top + 5 });
  };

  const periodRow = (source: "PYP" | "MYP", periods: PeriodDefinition[]) => (
    <div className="tl-period-row">
      <div className={`tl-period-label tl-${source.toLowerCase()}`}>{source}</div>
      <div className="tl-period-track" onPointerDown={onTrackPointerDown} onPointerMove={onTrackPointerMove}>
        {periods.filter((period) => period.source === source).map((period) => (
          <div
            key={`${source}-${period.period}`}
            className={`tl-period-block tl-${source.toLowerCase()}${period.lunch ? " tl-period-break" : ""}`}
            style={{ left: `${pct(period.start)}%`, width: `${Math.max(pct(period.end) - pct(period.start), 1)}%` }}
          >
            {period.label}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="tl">
      <div className="tl-ruler" aria-hidden="true">
        <div className="tl-gutter" />
        <div className="tl-axis">
          {hourMarks().map((time) => <span key={time} style={{ left: `${pct(time)}%` }}>{formatTime(time).slice(0, 2)}</span>)}
        </div>
      </div>

      <div className="tl-grid" ref={gridRef}>
        <div className="tl-playhead" style={{ left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${fractionOf(selection.time)})` }} aria-hidden="true">
          <span>{formatTime(selection.time)}</span>
        </div>

        <div className="tl-periods">
          {periodRow("PYP", dataset.periods)}
          {periodRow("MYP", dataset.periods)}
        </div>

        <div className="tl-lanes">
          {FACILITY_GROUPS.map((group) => {
            const facilities = dataset.facilities.filter((facility) => facility.group === group);
            if (facilities.length === 0) return null;
            return (
              <div className="tl-group" key={group}>
                <div className="tl-group-label">{group}</div>
                {facilities.map((datasetFacility) => {
                  const facility = FACILITY_BY_ID.get(datasetFacility.id) ?? datasetFacility;
                  const events = eventsByFacility.get(facility.id) ?? [];
                  const unavailable = isFacilityUnavailable(facility, selection.term);
                  const { rowOf, rowCount } = stackRows(events);
                  return (
                    <div className="tl-lane" key={facility.id}>
                      <div className={`tl-lane-name${unavailable && events.length === 0 ? " tl-lane-name-muted" : ""}`}>{facility.name}</div>
                      <div
                        className={`tl-track${unavailable ? " tl-track-unavailable" : ""}`}
                        style={rowCount > 1 ? { height: rowCount * 15 + 2 } : undefined}
                        onPointerDown={onTrackPointerDown}
                        onPointerMove={onTrackPointerMove}
                      >
                        {unavailable && events.length === 0 ? (
                          <span className="tl-unavailable-text">{facility.unavailableReason ?? "Unavailable"}</span>
                        ) : (
                          events.map((event) => {
                            const row = rowOf.get(event.id) ?? 0;
                            return (
                              <button
                                type="button"
                                key={event.id}
                                className={`tl-bar tl-bar-${barStatus(event)}${active?.event.id === event.id ? " tl-bar-selected" : ""}`}
                                style={{
                                  left: `${pct(event.start)}%`,
                                  width: `${Math.max(pct(event.end) - pct(event.start), 1.5)}%`,
                                  top: `calc(${(row / rowCount) * 100}% + 2px)`,
                                  height: `calc(${100 / rowCount}% - 4px)`,
                                }}
                                onPointerDown={(mouse) => mouse.stopPropagation()}
                                onClick={(mouse) => openDetails(event, mouse)}
                                title={`${facility.name} · ${event.cohort} · ${event.activity} · ${formatTime(event.start)}–${formatTime(event.end)}`}
                                aria-label={`${facility.name}: ${event.cohort} ${event.activity} ${formatTime(event.start)} to ${formatTime(event.end)}`}
                              >
                                {barLabel(event)}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {active ? (() => {
          const event = active.event;
          const severity = severityByEvent.get(event.id);
          const facilityName = FACILITY_BY_ID.get(event.facilityId)?.name ?? event.facilityId;
          return (
            <div className="tl-pop" style={{ left: active.x, top: active.y }} role="dialog" aria-label="Booking details">
              <div className="tl-pop-head">
                <strong>{barLabel(event)}</strong>
                <button type="button" className="tl-pop-close" aria-label="Close details" onClick={() => setSelected(null)}>×</button>
              </div>
              <div className={`tl-pop-status tl-status-${severity ?? "clear"}`}>{severity ? STATUS_TEXT[severity] : "Clear"}</div>
              <dl className="tl-pop-body">
                <div><dt>Group</dt><dd>{event.cohort}</dd></div>
                <div><dt>Unit</dt><dd>{event.activity}</dd></div>
                <div><dt>Space</dt><dd>{facilityName}</dd></div>
                <div><dt>Time</dt><dd>{formatTime(event.start)}–{formatTime(event.end)}</dd></div>
                <div><dt>Staff</dt><dd>{event.teachers.length > 0 ? event.teachers.join(", ") : "—"}</dd></div>
              </dl>
            </div>
          );
        })() : null}
      </div>

      <div className="tl-legend">
        <span><i className="tl-swatch tl-bar-primary" />Primary</span>
        <span><i className="tl-swatch tl-bar-secondary" />Secondary</span>
        <span><i className="tl-swatch tl-bar-workable" />Workable clash</span>
        <span><i className="tl-swatch tl-bar-non-workable" />Non-workable</span>
        <span><i className="tl-swatch tl-swatch-unavailable" />Unavailable</span>
        <span><i className="tl-swatch-playhead" />Playhead — click or drag to scrub · click a bar for details</span>
      </div>
    </div>
  );
}
