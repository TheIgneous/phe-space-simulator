import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
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

interface FacilityTimelineProps {
  dataset: SimulationDataset;
  selection: Selection;
  termIssues: Issue[];
  onScrub: (time: number) => void;
}

const shortCohort = (event: OccupancyEvent): string =>
  event.cohort.replace(/^Grade /, "Gr").replace(/ Boys$/, " B").replace(/ Girls$/, " G");

export function FacilityTimeline({ dataset, selection, termIssues, onScrub }: FacilityTimelineProps) {
  const scrubRef = useRef<HTMLDivElement>(null);

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
    const map = new Map<string, "workable" | "non-workable">();
    for (const issue of termIssues) {
      if (issue.day !== selection.day || issue.type === "data") continue;
      for (const id of issue.eventIds) {
        if (issue.severity === "non-workable" || !map.has(id)) map.set(id, issue.severity as "workable" | "non-workable");
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

  const scrubTo = (clientX: number) => {
    const node = scrubRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onScrub(clampTime(Math.round((DAY_START + fraction * SPAN) / SLOT_MINUTES) * SLOT_MINUTES));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTo(event.clientX);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons === 1) scrubTo(event.clientX);
  };

  const periodRow = (source: "PYP" | "MYP", periods: PeriodDefinition[]) => (
    <div className="tl-period-row">
      <div className={`tl-period-label tl-${source.toLowerCase()}`}>{source}</div>
      <div className="tl-period-track">
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

      <div className="tl-grid">
        <div
          className="tl-scrub"
          ref={scrubRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          role="slider"
          aria-label="Scrub time"
          aria-valuemin={DAY_START}
          aria-valuemax={DAY_END}
          aria-valuenow={selection.time}
          aria-valuetext={formatTime(selection.time)}
        />
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
                  return (
                    <div className="tl-lane" key={facility.id}>
                      <div className={`tl-lane-name${unavailable && events.length === 0 ? " tl-lane-name-muted" : ""}`}>{facility.name}</div>
                      <div className={`tl-track${unavailable ? " tl-track-unavailable" : ""}`}>
                        {unavailable && events.length === 0 ? (
                          <span className="tl-unavailable-text">{facility.unavailableReason ?? "Unavailable"}</span>
                        ) : (
                          events.map((event) => (
                            <div
                              key={event.id}
                              className={`tl-bar tl-bar-${barStatus(event)}`}
                              style={{ left: `${pct(event.start)}%`, width: `${Math.max(pct(event.end) - pct(event.start), 1.5)}%` }}
                              title={`${facility.name} · ${event.cohort} · ${event.activity} · ${formatTime(event.start)}–${formatTime(event.end)}`}
                              aria-label={`${facility.name}: ${event.cohort} ${event.activity} ${formatTime(event.start)} to ${formatTime(event.end)}`}
                            >
                              {shortCohort(event)}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="tl-legend">
        <span><i className="tl-swatch tl-bar-primary" />Primary</span>
        <span><i className="tl-swatch tl-bar-secondary" />Secondary</span>
        <span><i className="tl-swatch tl-bar-workable" />Workable clash</span>
        <span><i className="tl-swatch tl-bar-non-workable" />Non-workable</span>
        <span><i className="tl-swatch tl-swatch-unavailable" />Unavailable</span>
        <span><i className="tl-swatch-playhead" />Playhead — click or drag to scrub</span>
      </div>
    </div>
  );
}
