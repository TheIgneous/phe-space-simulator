import { useMemo } from "react";
import { CheckCircle2, Users } from "lucide-react";
import { FACILITY_GROUPS } from "../domain/facilities";
import { formatTime, getFacilityViews } from "../domain/simulation";
import { PeriodRuler } from "./PeriodRuler";
import type { FacilityView, OccupancyEvent, Selection, SimulationDataset } from "../types";

interface FacilityBoardProps {
  dataset: SimulationDataset;
  selection: Selection;
  onScrub: (time: number) => void;
}

const genderOf = (cohort: string): string => cohort.match(/(Boys|Girls)$/)?.[1] ?? "";

/** Class codes running in a space, e.g. "5AD + SMS (Boys)" — mirrors the timeline bar label. */
function eventLabel(event: OccupancyEvent): string {
  const base = event.classes.length > 0 ? event.classes.join(" + ") : event.activity;
  const gender = genderOf(event.cohort);
  return gender ? `${base} (${gender})` : base;
}

export function FacilityBoard({ dataset, selection, onScrub }: FacilityBoardProps) {
  const views = useMemo(() => getFacilityViews(dataset, selection), [dataset, selection]);
  const byGroup = useMemo(() => {
    const map = new Map<string, FacilityView[]>();
    for (const view of views) {
      const list = map.get(view.facility.group) ?? [];
      list.push(view);
      map.set(view.facility.group, list);
    }
    return map;
  }, [views]);

  const inUse = views.filter((view) => view.events.length > 0).length;

  return (
    <div className="fb">
      <PeriodRuler dataset={dataset} selection={selection} onScrub={onScrub} className="fb-ruler" />
      <p className="fb-caption">
        <strong>{inUse}</strong> of {views.length} spaces in use at {formatTime(selection.time)}
        <span className="fb-caption-hint">— coloured boxes are occupied right now</span>
      </p>
      <div className="fb-groups">
        {FACILITY_GROUPS.map((group) => {
          const groupViews = byGroup.get(group) ?? [];
          if (groupViews.length === 0) return null;
          return (
            <section className="fb-group" key={group}>
              <h3 className="fb-group-title">{group}</h3>
              <div className="fb-boxes">
                {groupViews.map((view) => (
                  <article className={`fb-box fb-box-${view.status}`} key={view.facility.id}>
                    <header className="fb-box-head">
                      <span className="fb-box-name">{view.facility.name}</span>
                      {view.events.length > 0 ? <span className="fb-box-cap">{view.label}</span> : null}
                    </header>
                    {view.events.length > 0 ? (
                      <ul className="fb-box-events">
                        {view.events.map((event) => (
                          <li key={event.id}>
                            <span className="fb-ev-title"><Users size={13} aria-hidden="true" /> {eventLabel(event)}</span>
                            <span className="fb-ev-sub">{event.cohort} · {formatTime(event.start)}–{formatTime(event.end)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="fb-box-status">
                        {view.status === "unavailable"
                          ? <><span className="fb-dot fb-dot-warn" aria-hidden="true" /> {view.label}</>
                          : <><CheckCircle2 size={13} aria-hidden="true" /> Available</>}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
