import { useCallback, useEffect, useMemo, useState } from "react";
import { BUNDLED_SNAPSHOT, fetchSnapshot } from "./loadDataset";
import { ControlBar } from "./components/ControlBar";
import { DayTimeline } from "./components/DayTimeline";
import { FacilityBoard } from "./components/FacilityBoard";
import { IssuesPanel } from "./components/IssuesPanel";
import { TimeScrubber } from "./components/TimeScrubber";
import { TimetableImport } from "./components/TimetableImport";
import { PlanPage } from "./components/PlanPage";
import { ClassTimetablePage } from "./components/ClassTimetablePage";
import { YearOverviewPage } from "./components/YearOverviewPage";
import {
  DAY_END,
  findAdjacentStep,
  getCurrentIssues,
  getFacilityViews,
  getStepTimes,
  getTermIssues,
} from "./domain/simulation";
import { applyPlanAssignments } from "./domain/plan";
import { mergeStaffMembers } from "./domain/staff";
import { BASE_UNITS, mergeUnits } from "./domain/units";
import { DAYS, type DayIndex, type FacilityId, type Issue, type PheAssignment, type Selection, type SimulationDataset, type TermId, type WeekId } from "./types";

type ViewId = "simulator" | "plan" | "classes" | "overview";
const VIEW_TABS: Array<{ id: ViewId; label: string }> = [
  { id: "simulator", label: "Simulator" },
  { id: "plan", label: "Plan" },
  { id: "classes", label: "Classes" },
  { id: "overview", label: "Year overview" },
];

const initialDataset = BUNDLED_SNAPSHOT;
const INITIAL_SELECTION: Selection = { term: "T1a", week: "A", day: 0, time: 8 * 60 };

export function App() {
  const [view, setView] = useState<ViewId>("simulator");
  const [selection, setSelection] = useState<Selection>(INITIAL_SELECTION);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dataset, setDataset] = useState<SimulationDataset>(initialDataset);
  const [draftAssignments, setDraftAssignments] = useState<PheAssignment[]>(() => initialDataset.assignments.map((assignment) => ({ ...assignment, teachers: [...assignment.teachers] })));
  const [extraUnits, setExtraUnits] = useState<string[]>([]);

  const facilityViews = useMemo(() => getFacilityViews(dataset, selection), [dataset, selection]);
  const termIssues = useMemo(() => getTermIssues(dataset, selection.term, selection.week), [dataset, selection.term, selection.week]);
  const currentIssues = useMemo(() => getCurrentIssues(termIssues, selection), [termIssues, selection]);
  const stepTimes = useMemo(
    () => getStepTimes(dataset, { term: selection.term, week: selection.week, day: selection.day }),
    [dataset, selection.term, selection.week, selection.day],
  );
  const isPlanDirty = useMemo(() => JSON.stringify(draftAssignments) !== JSON.stringify(dataset.assignments), [dataset.assignments, draftAssignments]);
  const units = useMemo(
    () => mergeUnits(BASE_UNITS, draftAssignments.map((assignment) => assignment.activity), extraUnits),
    [draftAssignments, extraUnits],
  );
  const staff = useMemo(
    () => mergeStaffMembers(dataset.staff ?? [], draftAssignments.flatMap((assignment) => assignment.teachers)),
    [dataset.staff, draftAssignments],
  );

  // Pull the latest published snapshot once on load; if it is unavailable the bundled copy stays.
  useEffect(() => {
    const controller = new AbortController();
    fetchSnapshot(controller.signal).then((remote) => {
      if (!remote) return;
      setDataset(remote);
      setDraftAssignments(remote.assignments.map((assignment) => ({ ...assignment, teachers: [...assignment.teachers] })));
    });
    return () => controller.abort();
  }, []);

  const updateSelection = useCallback((change: Partial<Selection>) => {
    setSelection((current) => ({ ...current, ...change }));
  }, []);

  const step = useCallback(
    (direction: -1 | 1) => {
      setIsPlaying(false);
      setSelection((current) => ({ ...current, time: findAdjacentStep(stepTimes, current.time, direction) }));
    },
    [stepTimes],
  );

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setSelection((current) => {
        const next = findAdjacentStep(stepTimes, current.time, 1);
        if (next >= DAY_END) setIsPlaying(false);
        return { ...current, time: next };
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isPlaying, stepTimes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, button, summary")) return;
      if (event.code === "Space") {
        event.preventDefault();
        setIsPlaying((current) => !current);
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step]);

  const jumpToIssue = useCallback((issue: Issue) => {
    if (issue.day === undefined || issue.start === undefined) return;
    setIsPlaying(false);
    setSelection((current) => ({ ...current, day: issue.day!, time: issue.start! }));
  }, []);

  return (
    <main className="app-frame">
      <nav className="view-tabs no-print" aria-label="Viewer pages">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={view === tab.id ? "active" : ""}
            aria-current={view === tab.id ? "page" : undefined}
            onClick={() => setView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {view === "classes" ? (
        <ClassTimetablePage dataset={dataset} />
      ) : view === "overview" ? (
        <YearOverviewPage dataset={dataset} />
      ) : view === "plan" ? (
        <PlanPage
          assignments={draftAssignments}
          facilities={dataset.facilities}
          staff={staff}
          units={units}
          isDirty={isPlanDirty}
          onCreateUnit={(unit) => setExtraUnits((current) => (current.includes(unit) ? current : [...current, unit]))}
          onFacilityChange={(cohort, term, facilityId: FacilityId) => {
            setDraftAssignments((current) => current.map((assignment) =>
              assignment.cohort === cohort && assignment.term === term ? { ...assignment, facilityId } : assignment,
            ));
          }}
          onActivityChange={(cohort, term, activity) => {
            setDraftAssignments((current) => current.map((assignment) =>
              assignment.cohort === cohort && assignment.term === term ? { ...assignment, activity } : assignment,
            ));
          }}
          onTeacherChange={(cohort, teachers) => {
            setDraftAssignments((current) => current.map((assignment) =>
              assignment.cohort === cohort ? { ...assignment, teachers } : assignment,
            ));
          }}
          onSwap={(cohort, from, to) => {
            setDraftAssignments((current) => {
              const source = current.find((assignment) => assignment.cohort === cohort && assignment.term === from);
              const target = current.find((assignment) => assignment.cohort === cohort && assignment.term === to);
              if (!source || !target) return current;
              return current.map((assignment) => {
                if (assignment.cohort !== cohort) return assignment;
                if (assignment.term === from) return { ...assignment, activity: target.activity, facilityId: target.facilityId };
                if (assignment.term === to) return { ...assignment, activity: source.activity, facilityId: source.facilityId };
                return assignment;
              });
            });
          }}
          onDiscard={() => setDraftAssignments(dataset.assignments.map((assignment) => ({ ...assignment, teachers: [...assignment.teachers] })))}
          onApply={() => {
            const nextDataset = applyPlanAssignments(dataset, draftAssignments);
            setDataset(nextDataset);
            setDraftAssignments(nextDataset.assignments.map((assignment) => ({ ...assignment, teachers: [...assignment.teachers] })));
            setSelection(INITIAL_SELECTION);
            setIsPlaying(false);
            setView("simulator");
          }}
        />
      ) : (<>
      <ControlBar
        selection={selection}
        isPlaying={isPlaying}
        onTermChange={(term: TermId) => updateSelection({ term })}
        onWeekChange={(week: WeekId) => updateSelection({ week })}
        onDayChange={(day: DayIndex) => updateSelection({ day })}
        onPlayToggle={() => setIsPlaying((current) => !current)}
        onStep={step}
        onReset={() => {
          setIsPlaying(false);
          setSelection(INITIAL_SELECTION);
        }}
      />
      <TimeScrubber
        value={selection.time}
        onChange={(time) => {
          setIsPlaying(false);
          updateSelection({ time });
        }}
      />
      <div className="workspace">
        <div className="operations-canvas">
          <FacilityBoard views={facilityViews} />
          <DayTimeline day={DAYS[selection.day]} periods={dataset.periods} currentTime={selection.time} />
        </div>
        <IssuesPanel
          selection={selection}
          currentIssues={currentIssues}
          termIssues={termIssues}
          warnings={dataset.warnings}
          onJump={jumpToIssue}
        />
      </div>
      <footer className="data-provenance">
        <span>Sanitized snapshot generated {new Date(dataset.metadata.generatedAt).toLocaleDateString("en-GB")}</span>
        <span>{dataset.metadata.sources.map((source) => source.name).join(" · ")}</span>
        <TimetableImport
          dataset={dataset}
          onImport={(nextDataset) => {
            setIsPlaying(false);
            setSelection(INITIAL_SELECTION);
            setDataset(nextDataset);
            setDraftAssignments(nextDataset.assignments.map((assignment) => ({ ...assignment, teachers: [...assignment.teachers] })));
          }}
        />
      </footer>
      </>)}
    </main>
  );
}
