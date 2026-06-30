import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Printer } from "lucide-react";
import { FACILITY_BY_ID } from "../domain/facilities";
import { formatTime, getTermIssues } from "../domain/simulation";
import { DAYS, TERMS, WEEKS, type Issue, type SimulationDataset, type TermId } from "../types";

interface YearOverviewPageProps {
  dataset: SimulationDataset;
}

interface TermSummary {
  term: TermId;
  nonWorkable: Issue[];
  workable: Issue[];
}

const facilityName = (facilityId: Issue["facilityId"]): string =>
  (facilityId ? FACILITY_BY_ID.get(facilityId)?.name : undefined) ?? facilityId ?? "—";

/** Collapse A/B-week duplicates so a clash present in both weeks is counted once per term. */
function summarizeTerm(dataset: SimulationDataset, term: TermId): TermSummary {
  const seen = new Map<string, Issue>();
  for (const week of WEEKS) {
    for (const issue of getTermIssues(dataset, term, week)) {
      const key = `${issue.facilityId}-${issue.day}-${issue.start}-${issue.eventIds.join(",")}`;
      if (!seen.has(key)) seen.set(key, issue);
    }
  }
  const issues = [...seen.values()];
  return {
    term,
    nonWorkable: issues.filter((issue) => issue.severity === "non-workable"),
    workable: issues.filter((issue) => issue.severity === "workable"),
  };
}

export function YearOverviewPage({ dataset }: YearOverviewPageProps) {
  const cohorts = useMemo(
    () => [...new Set(dataset.assignments.map((assignment) => assignment.cohort))]
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
    [dataset.assignments],
  );
  const byKey = useMemo(
    () => new Map(dataset.assignments.map((assignment) => [`${assignment.cohort}|${assignment.term}`, assignment])),
    [dataset.assignments],
  );
  const eventsById = useMemo(() => new Map(dataset.events.map((event) => [event.id, event])), [dataset.events]);
  const summaries = useMemo(() => TERMS.map((term) => summarizeTerm(dataset, term)), [dataset]);
  const totals = useMemo(() => ({
    nonWorkable: summaries.reduce((sum, summary) => sum + summary.nonWorkable.length, 0),
    workable: summaries.reduce((sum, summary) => sum + summary.workable.length, 0),
  }), [summaries]);

  const clashCohorts = (issue: Issue): string =>
    [...new Set(issue.eventIds.map((id) => eventsById.get(id)?.cohort).filter(Boolean) as string[])].join(", ");

  return (
    <section className="overview-page" aria-labelledby="overview-title">
      <header className="report-header">
        <div>
          <h1 id="overview-title"><ClipboardList size={24} aria-hidden="true" /> Year overview</h1>
          <p>Whole-year PHE allocations and clash summary for {dataset.metadata.academicYear}. Export to PDF for circulation.</p>
        </div>
        <div className="report-controls no-print">
          <button type="button" className="button secondary report-print" onClick={() => window.print()}>
            <Printer size={17} /> Export PDF
          </button>
        </div>
      </header>

      <div className="overview-totals">
        <div className={totals.nonWorkable > 0 ? "overview-stat danger" : "overview-stat ok"}>
          {totals.nonWorkable > 0 ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <strong>{totals.nonWorkable}</strong> non-workable clash{totals.nonWorkable === 1 ? "" : "es"} this year
        </div>
        <div className={totals.workable > 0 ? "overview-stat warning" : "overview-stat ok"}>
          {totals.workable > 0 ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <strong>{totals.workable}</strong> workable clash{totals.workable === 1 ? "" : "es"} this year
        </div>
      </div>

      <h2 className="overview-section-title">Allocations</h2>
      <div className="overview-table-wrap">
        <table className="overview-table">
          <thead>
            <tr>
              <th scope="col">Group</th>
              {TERMS.map((term) => <th scope="col" key={term}>{term}</th>)}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort) => (
              <tr key={cohort}>
                <th scope="row">{cohort}</th>
                {TERMS.map((term) => {
                  const assignment = byKey.get(`${cohort}|${term}`);
                  return (
                    <td key={term}>
                      {assignment ? (
                        <>
                          <strong>{assignment.activity}</strong>
                          <small>{assignment.facilityId ? facilityName(assignment.facilityId) : "No space"}</small>
                        </>
                      ) : <small className="overview-missing">—</small>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="overview-section-title">Clash summary by term</h2>
      <div className="overview-table-wrap">
        <table className="overview-table compact">
          <thead>
            <tr><th scope="col">Term</th><th scope="col">Non-workable</th><th scope="col">Workable</th></tr>
          </thead>
          <tbody>
            {summaries.map((summary) => (
              <tr key={summary.term}>
                <th scope="row">{summary.term}</th>
                <td className={summary.nonWorkable.length > 0 ? "overview-danger" : ""}>{summary.nonWorkable.length}</td>
                <td className={summary.workable.length > 0 ? "overview-warning" : ""}>{summary.workable.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totals.nonWorkable > 0 ? (
        <>
          <h2 className="overview-section-title">Non-workable clashes</h2>
          <ul className="overview-clash-list">
            {summaries.flatMap((summary) => summary.nonWorkable.map((issue) => (
              <li key={issue.id}>
                <span className="overview-clash-when">{summary.term} · {issue.day !== undefined ? DAYS[issue.day] : ""} {issue.start !== undefined ? formatTime(issue.start) : ""}</span>
                <strong>{facilityName(issue.facilityId)}</strong>
                <span className="overview-clash-detail">{clashCohorts(issue) || issue.detail}</span>
              </li>
            )))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
