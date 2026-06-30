import { useMemo, useState } from "react";
import { CalendarRange, Printer } from "lucide-react";
import { FACILITY_BY_ID, isEarlyYearsCohort } from "../domain/facilities";
import { formatTime } from "../domain/simulation";
import { DAYS, TERMS, type OccupancyEvent, type PeriodDefinition, type SimulationDataset, type TermId } from "../types";

interface ClassTimetablePageProps {
  dataset: SimulationDataset;
}

interface Slot {
  start: number;
  end: number;
  label: string;
  lunch: boolean;
}

const facilityName = (facilityId: OccupancyEvent["facilityId"]): string => FACILITY_BY_ID.get(facilityId)?.name ?? facilityId;

function cohortPhase(events: OccupancyEvent[]): "Primary" | "Secondary" {
  return events.find((event) => event.phase === "Secondary") ? "Secondary" : "Primary";
}

function periodLabel(periods: PeriodDefinition[], source: "PYP" | "MYP", start: number): PeriodDefinition | undefined {
  return periods.find((period) => period.source === source && period.start === start);
}

/**
 * Time slots a cohort occupies in a term. The lunch break is added as a slot only when
 * `includeLunch` is set — Minis/EY1/EY2 may run PHE during lunch (their day differs), so we let
 * their own sessions drive the grid rather than overlaying a Lunch row.
 */
function termSlots(cohortEvents: OccupancyEvent[], periods: PeriodDefinition[], phase: "Primary" | "Secondary", includeLunch: boolean): Slot[] {
  const source = phase === "Primary" ? "PYP" : "MYP";
  const byStart = new Map<number, Slot>();
  for (const event of cohortEvents) {
    const def = periodLabel(periods, source, event.start);
    byStart.set(event.start, {
      start: event.start,
      end: event.end,
      label: def?.label ?? `${formatTime(event.start)}`,
      lunch: false,
    });
  }
  if (includeLunch) {
    for (const period of periods) {
      if (period.source === source && period.lunch && !byStart.has(period.start)) {
        byStart.set(period.start, { start: period.start, end: period.end, label: period.label, lunch: true });
      }
    }
  }
  return [...byStart.values()].sort((left, right) => left.start - right.start);
}

export function ClassTimetablePage({ dataset }: ClassTimetablePageProps) {
  const cohorts = useMemo(
    () => [...new Set(dataset.events.filter((event) => event.kind === "PHE").map((event) => event.cohort))]
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
    [dataset.events],
  );
  const [cohort, setCohort] = useState(cohorts[0] ?? "");
  const [term, setTerm] = useState<TermId>("T1a");

  const cohortEvents = useMemo(
    () => dataset.events.filter((event) => event.kind === "PHE" && event.cohort === cohort),
    [dataset.events, cohort],
  );
  const phase = useMemo(() => cohortPhase(cohortEvents), [cohortEvents]);
  const termEvents = useMemo(() => cohortEvents.filter((event) => event.term === term), [cohortEvents, term]);
  const slots = useMemo(
    () => termSlots(termEvents, dataset.periods, phase, !isEarlyYearsCohort(cohort)),
    [termEvents, dataset.periods, phase, cohort],
  );
  const assignment = useMemo(
    () => dataset.assignments.find((item) => item.cohort === cohort && item.term === term),
    [dataset.assignments, cohort, term],
  );

  const cellEvents = (slot: Slot, day: number): OccupancyEvent[] =>
    termEvents.filter((event) => event.day === day && event.start === slot.start);

  return (
    <section className="class-page" aria-labelledby="class-title">
      <header className="report-header">
        <div>
          <h1 id="class-title"><CalendarRange size={24} aria-hidden="true" /> Class timetable</h1>
          <p>Weekly PHE schedule for a group. Choose a class and term, then export to PDF.</p>
        </div>
        <div className="report-controls no-print">
          <label>
            <span>Class</span>
            <select aria-label="Class" value={cohort} onChange={(event) => setCohort(event.target.value)}>
              {cohorts.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label>
            <span>Term</span>
            <select aria-label="Term" value={term} onChange={(event) => setTerm(event.target.value as TermId)}>
              {TERMS.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <button type="button" className="button secondary report-print" onClick={() => window.print()}>
            <Printer size={17} /> Export PDF
          </button>
        </div>
      </header>

      <div className="report-summary">
        <strong>{cohort || "—"}</strong>
        <span>{term}</span>
        {assignment ? <span>{assignment.activity} · {assignment.facilityId ? facilityName(assignment.facilityId) : "No space"}</span> : <span>No allocation</span>}
        {assignment && assignment.teachers.length > 0 ? <span>{assignment.teachers.join(" / ")}</span> : null}
      </div>

      {slots.length === 0 ? (
        <p className="report-empty">No PHE sessions are scheduled for {cohort || "this class"} in {term}.</p>
      ) : (
        <div className="class-table-wrap">
          <table className="class-table">
            <thead>
              <tr>
                <th scope="col">Period</th>
                {DAYS.map((day) => <th scope="col" key={day}>{day}</th>)}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.start} className={slot.lunch ? "class-row-lunch" : ""}>
                  <th scope="row">
                    <strong>{slot.label}</strong>
                    <small>{formatTime(slot.start)}–{formatTime(slot.end)}</small>
                  </th>
                  {DAYS.map((day, index) => {
                    const events = cellEvents(slot, index);
                    return (
                      <td key={day} className={slot.lunch && events.length === 0 ? "class-lunch-cell" : ""}>
                        {events.length > 0
                          ? events.map((event) => (
                              <div className="class-session" key={event.id}>
                                <strong>{event.activity}</strong>
                                <span>{facilityName(event.facilityId)}</span>
                                {event.weeks.length === 1 ? <em>Wk {event.weeks[0]}</em> : null}
                                {event.teachers.length > 0 ? <small>{event.teachers.join(" / ")}</small> : null}
                              </div>
                            ))
                          : slot.lunch ? <span className="class-lunch-tag">Lunch</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
