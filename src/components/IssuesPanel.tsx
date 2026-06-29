import { AlertTriangle, CalendarDays, CheckCircle2, Info, UserRound } from "lucide-react";
import { DAYS, type DataWarning, type Issue, type Selection } from "../types";
import { formatTime } from "../domain/simulation";

interface IssuesPanelProps {
  selection: Selection;
  currentIssues: Issue[];
  termIssues: Issue[];
  warnings: DataWarning[];
  onJump: (issue: Issue) => void;
}

export function IssuesPanel({ selection, currentIssues, termIssues, warnings, onJump }: IssuesPanelProps) {
  const nonWorkableCount = termIssues.filter((issue) => issue.severity === "non-workable").length;
  const workableCount = termIssues.filter((issue) => issue.severity === "workable").length;
  return (
    <aside className="analysis-rail">
      <section className="analysis-panel current-issues">
        <h2><AlertTriangle size={21} /> Issues at {formatTime(selection.time)}</h2>
        {currentIssues.length === 0 ? (
          <div className="no-issues"><CheckCircle2 size={20} /> No active clashes</div>
        ) : (
          <div className="issue-list">
            {currentIssues.map((issue) => (
              <button key={issue.id} type="button" className={`issue-row issue-${issue.severity}`} onClick={() => onJump(issue)}>
                <AlertTriangle size={19} />
                <span><strong>{issue.title}</strong><small>{issue.detail}</small></span>
                <b>Go to<br />{issue.start !== undefined ? formatTime(issue.start) : "—"}</b>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="analysis-panel term-checks">
        <h2><CalendarDays size={20} /> Term checks</h2>
        <div className="term-check-row success"><Info size={17} /> Tennis available all school day</div>
        <div className="term-check-row success"><Info size={17} /> Main + Side Pools may overlap</div>
        <div className="term-check-row warning"><Info size={17} /> Outdoor EY Pool closed T1a/T3b</div>
        <div className={`term-check-row ${workableCount > 0 ? "warning" : "success"}`}>
          {workableCount > 0 ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
          {workableCount} workable clash interval{workableCount === 1 ? "" : "s"} in {selection.term}, Week {selection.week}
        </div>
        <div className={`term-check-row ${nonWorkableCount > 0 ? "danger" : "success"}`}>
          {nonWorkableCount > 0 ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
          {nonWorkableCount} non-workable clash interval{nonWorkableCount === 1 ? "" : "s"} in {selection.term}, Week {selection.week}
        </div>
        {termIssues.length > 0 ? (
          <details className="term-issues-details">
            <summary>Browse term clashes</summary>
            <div>
              {termIssues.slice(0, 20).map((issue) => (
                <button key={issue.id} type="button" onClick={() => onJump(issue)}>
                  <span>{issue.day !== undefined ? DAYS[issue.day] : ""} {issue.start !== undefined ? formatTime(issue.start) : ""}</span>
                  <strong>{issue.title}</strong>
                </button>
              ))}
            </div>
          </details>
        ) : null}
        {warnings.length > 0 ? (
          <details className="data-warnings">
            <summary>{warnings.length} source-data warning{warnings.length === 1 ? "" : "s"}</summary>
            <ul>{warnings.slice(0, 12).map((warning) => <li key={warning.id}>{warning.message}</li>)}</ul>
          </details>
        ) : null}
      </section>

      <section className="analysis-panel legend">
        <h2>Legend</h2>
        <div><UserRound className="primary-icon" size={18} /> Primary</div>
        <div><UserRound className="secondary-icon" size={18} /> Secondary</div>
        <div><CalendarDays size={18} /> Existing non-PHE booking</div>
        <div><CheckCircle2 className="available-icon" size={18} /> Available</div>
        <div><AlertTriangle className="warning-icon" size={18} /> Workable clash</div>
        <div><AlertTriangle className="danger-icon" size={18} /> Non-workable clash</div>
      </section>

    </aside>
  );
}
