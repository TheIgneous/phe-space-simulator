import { AlertTriangle, Check, Clock3, UserRound } from "lucide-react";
import { displayCapacity } from "../domain/facilities";
import { formatTime } from "../domain/simulation";
import type { FacilityView, OccupancyEvent } from "../types";

interface FacilityCardProps {
  view: FacilityView;
}

function eventClassLabel(event: OccupancyEvent): string {
  const classes = event.classes.length > 0 ? event.classes.join(" + ") : event.cohort;
  const division = event.cohort.match(/\b(Boys|Girls)$/)?.[1];
  return `${classes}${division ? ` (${division})` : ""}`;
}

export function FacilityCard({ view }: FacilityCardProps) {
  const { facility, events, status, label } = view;
  return (
    <article className={`facility-card status-${status}`} aria-label={`${facility.name}: ${label}`}>
      <div className="facility-heading">
        <h3>{facility.name}</h3>
        {events.length > 0 ? <strong>{events.length} / {displayCapacity(facility)}</strong> : null}
      </div>
      {events.length === 0 ? (
        <div className="empty-facility">
          {status === "unavailable" ? <Clock3 size={25} /> : <Check size={27} />}
          <span>{label}</span>
        </div>
      ) : (
        <div className="occupant-list">
          {events.map((event) => (
            <div className={`occupant phase-${event.phase.toLowerCase()}`} key={event.id}>
              <UserRound size={16} aria-hidden="true" />
              <div>
                <strong>
                  {eventClassLabel(event)} — {event.activity}
                </strong>
                <small>{event.cohort} · {formatTime(event.start)}–{formatTime(event.end)}</small>
              </div>
            </div>
          ))}
        </div>
      )}
      {status === "conditional" ? (
        <div className="workable-clash"><AlertTriangle size={17} /> Workable clash</div>
      ) : null}
      {status === "conflict" ? (
        <div className="hard-clash"><AlertTriangle size={17} /> Non-workable clash</div>
      ) : null}
    </article>
  );
}
