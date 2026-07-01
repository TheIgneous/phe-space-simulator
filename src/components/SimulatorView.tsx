import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { FacilityTimeline } from "./FacilityTimeline";
import { TimetableImport } from "./TimetableImport";
import { FACILITY_BY_ID } from "../domain/facilities";
import { formatTime } from "../domain/simulation";
import { DAYS, TERMS, WEEKS, type DayIndex, type Issue, type Selection, type SimulationDataset, type TermId, type WeekId } from "../types";

type ClashSeverity = "workable" | "non-workable";

interface SimulatorViewProps {
  dataset: SimulationDataset;
  selection: Selection;
  isPlaying: boolean;
  termIssues: Issue[];
  currentIssues: Issue[];
  onTermChange: (term: TermId) => void;
  onWeekChange: (week: WeekId) => void;
  onDayChange: (day: DayIndex) => void;
  onPlayToggle: () => void;
  onStep: (direction: -1 | 1) => void;
  onReset: () => void;
  onScrub: (time: number) => void;
  onImport: (dataset: SimulationDataset) => void;
}

export function SimulatorView({
  dataset,
  selection,
  isPlaying,
  termIssues,
  currentIssues,
  onTermChange,
  onWeekChange,
  onDayChange,
  onPlayToggle,
  onStep,
  onReset,
  onScrub,
  onImport,
}: SimulatorViewProps) {
  const [showWarnings, setShowWarnings] = useState(false);
  const [openClashes, setOpenClashes] = useState<ClashSeverity | null>(null);

  // Close the clash-details popover on outside-click or Escape (state lives here, not in the effect body).
  useEffect(() => {
    if (!openClashes) return;
    const onDown = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".sv-clash-pop") && !target.closest(".sv-count")) setOpenClashes(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpenClashes(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openClashes]);

  const occupiedNow = useMemo(() => {
    const facilities = new Set<string>();
    for (const event of dataset.events) {
      if (
        event.term === selection.term &&
        event.weeks.includes(selection.week) &&
        event.day === selection.day &&
        event.start <= selection.time &&
        selection.time < event.end
      ) {
        facilities.add(event.facilityId);
      }
    }
    return facilities.size;
  }, [dataset.events, selection]);

  const totalSpaces = dataset.facilities.length;
  const freeNow = totalSpaces - occupiedNow;
  const clashesNow = currentIssues.length;

  // Clash issues for this term, split by severity and sorted for the details popover.
  const clashesBySeverity = useMemo(() => {
    const eventById = new Map(dataset.events.map((event) => [event.id, event]));
    const byDayTime = (left: Issue, right: Issue) =>
      (left.day ?? 0) - (right.day ?? 0) || (left.start ?? 0) - (right.start ?? 0);
    const build = (severity: ClashSeverity) =>
      termIssues
        .filter((issue) => issue.severity === severity)
        .sort(byDayTime)
        .map((issue) => ({
          id: issue.id,
          when: `${issue.day !== undefined ? DAYS[issue.day] : ""} ${issue.start !== undefined ? formatTime(issue.start) : ""}`.trim(),
          where: (issue.facilityId ? FACILITY_BY_ID.get(issue.facilityId)?.name : undefined) ?? issue.title,
          who: issue.eventIds.map((eventId) => eventById.get(eventId)?.cohort).filter(Boolean).join(", "),
          detail: issue.detail,
        }));
    return { workable: build("workable"), "non-workable": build("non-workable") };
  }, [termIssues, dataset.events]);
  const workable = clashesBySeverity.workable.length;
  const nonWorkable = clashesBySeverity["non-workable"].length;

  const toggleClashes = (severity: ClashSeverity) =>
    setOpenClashes((current) => (current === severity ? null : severity));

  return (
    <section className="sim-v2" aria-label="Simulator">
      <div className="sv-card">
        {/* header */}
        <header className="sv-head">
          <div className="sv-brand">
            <div className="sv-brand-name">PHE Space Simulator</div>
            <div className="sv-brand-sub">AY {dataset.metadata.academicYear} · space validation</div>
          </div>
          <div className="sv-move">
            <div className="sv-now">
              <div className="sv-eyebrow">Now</div>
              <div className="sv-clock">{formatTime(selection.time)}</div>
              <div className="sv-now-sub">{DAYS[selection.day]} · {selection.term} · Wk {selection.week}</div>
            </div>
            <div className="sv-playgroup">
              <button type="button" className="sv-play" aria-pressed={isPlaying} onClick={onPlayToggle}>
                {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                {isPlaying ? "Pause" : "Play"}
              </button>
              <div className="sv-transport">
                <button type="button" aria-label="Previous timetable boundary" onClick={() => onStep(-1)}><SkipBack size={14} /></button>
                <button type="button" aria-label="Next timetable boundary" onClick={() => onStep(1)}><SkipForward size={14} /></button>
                <button type="button" aria-label="Reset" onClick={onReset}><RotateCcw size={14} /></button>
              </div>
            </div>
          </div>
        </header>

        <div className="sv-main">
          <div className="sv-summary">
            <div className="sv-controls">
              <label className="sv-pill">
                <span>Term</span>
                <select aria-label="Term" value={selection.term} onChange={(event) => onTermChange(event.target.value as TermId)}>
                  {TERMS.map((term) => <option key={term}>{term}</option>)}
                </select>
              </label>
              <label className="sv-pill">
                <span>Wk</span>
                <select aria-label="Week" value={selection.week} onChange={(event) => onWeekChange(event.target.value as WeekId)}>
                  {WEEKS.map((week) => <option key={week}>{week}</option>)}
                </select>
              </label>
              <label className="sv-pill sv-pill-day">
                <span>Day</span>
                <select aria-label="Day" value={selection.day} onChange={(event) => onDayChange(Number(event.target.value) as DayIndex)}>
                  {DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
                </select>
              </label>
            </div>
            <div className={`sv-summary-status ${clashesNow > 0 ? "is-clash" : "is-ok"}`}>
              {clashesNow > 0 ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
              <div>
                <strong>{clashesNow > 0 ? `${clashesNow} clash${clashesNow === 1 ? "" : "es"} at ${formatTime(selection.time)}` : `No clashes at ${formatTime(selection.time)}`}</strong>
                <small>{freeNow} of {totalSpaces} spaces free right now</small>
              </div>
            </div>
            <div className="sv-summary-counts">
              <button
                type="button"
                className="sv-count sv-count-workable"
                aria-expanded={openClashes === "workable"}
                aria-label={`Workable clashes: ${workable}. Show details`}
                onClick={() => toggleClashes("workable")}
              >
                <span>Workable clashes</span>
                <span className="sv-count-val"><b>{workable}</b><Info size={13} aria-hidden="true" /></span>
              </button>
              <button
                type="button"
                className="sv-count sv-count-nonworkable"
                aria-expanded={openClashes === "non-workable"}
                aria-label={`Non-workable clashes: ${nonWorkable}. Show details`}
                onClick={() => toggleClashes("non-workable")}
              >
                <span>Non{"‑"}workable clashes</span>
                <span className="sv-count-val"><b>{nonWorkable}</b><Info size={13} aria-hidden="true" /></span>
              </button>
              {openClashes ? (
                <div className="sv-clash-pop" role="dialog" aria-label={`${openClashes === "workable" ? "Workable" : "Non-workable"} clash details`}>
                  <div className="sv-clash-pop-head">
                    <strong>{openClashes === "workable" ? "Workable clashes" : "Non-workable clashes"}</strong>
                    <button type="button" className="sv-clash-pop-close" aria-label="Close details" onClick={() => setOpenClashes(null)}>×</button>
                  </div>
                  {clashesBySeverity[openClashes].length === 0 ? (
                    <p className="sv-clash-empty">No {openClashes === "workable" ? "workable" : "non-workable"} clashes this term.</p>
                  ) : (
                    <ul className="sv-clash-list">
                      {clashesBySeverity[openClashes].map((clash) => (
                        <li key={clash.id}>
                          <div className="sv-clash-row">
                            <span className="sv-clash-when">{clash.when}</span>
                            <span className="sv-clash-where">{clash.where}</span>
                          </div>
                          {clash.who ? <div className="sv-clash-who">{clash.who}</div> : null}
                          <div className="sv-clash-detail">{clash.detail}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <FacilityTimeline dataset={dataset} selection={selection} termIssues={termIssues} onScrub={onScrub} />
        </div>

        {/* footer */}
        <footer className="sv-foot">
          <div className="sv-foot-checks">
            <div className="sv-foot-checkrow">
              <span className="sv-check"><span className="sv-dot sv-dot-ok" />Tennis available all day</span>
              <span className="sv-check"><span className="sv-dot sv-dot-ok" />Main + Side Pools may overlap</span>
              <span className="sv-check"><span className="sv-dot sv-dot-warn" />EY Pool closed T1a/T3b</span>
              {dataset.warnings.length > 0 ? (
                <button type="button" className="sv-warn-toggle" aria-expanded={showWarnings} onClick={() => setShowWarnings((open) => !open)}>
                  <Info size={13} /> {dataset.warnings.length} source-data warning{dataset.warnings.length === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>
            {showWarnings && dataset.warnings.length > 0 ? (
              <ul className="sv-warn-list">
                {dataset.warnings.slice(0, 12).map((warning) => <li key={warning.id}>{warning.message}</li>)}
              </ul>
            ) : null}
            <div className="sv-foot-meta">
              <span>Sanitized snapshot · {new Date(dataset.metadata.generatedAt).toLocaleDateString("en-GB")}</span>
              <span>{dataset.metadata.sources.map((source) => source.name).join(" · ")}</span>
            </div>
          </div>
          <TimetableImport dataset={dataset} onImport={onImport} />
        </footer>
      </div>
    </section>
  );
}
