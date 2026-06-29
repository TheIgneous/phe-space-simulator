import { useState, type DragEvent } from "react";
import { Check, GripVertical, RotateCcw } from "lucide-react";
import { TERMS, type Facility, type FacilityId, type PheAssignment, type StaffMember, type TermId } from "../types";

interface PlanPageProps {
  assignments: PheAssignment[];
  facilities: Facility[];
  staff: StaffMember[];
  units: string[];
  isDirty: boolean;
  onFacilityChange: (cohort: string, term: TermId, facilityId: FacilityId) => void;
  onActivityChange: (cohort: string, term: TermId, activity: string) => void;
  onTeacherChange: (cohort: string, teachers: string[]) => void;
  onSwap: (cohort: string, from: TermId, to: TermId) => void;
  onApply: () => void;
  onDiscard: () => void;
}

interface PlanRow {
  cohort: string;
  teachers: string[];
  assignments: Map<TermId, PheAssignment>;
}

interface BlockPosition {
  cohort: string;
  term: TermId;
}

function planRows(assignments: PheAssignment[]): PlanRow[] {
  const rows = new Map<string, PlanRow>();
  for (const assignment of assignments) {
    const row = rows.get(assignment.cohort) ?? {
      cohort: assignment.cohort,
      teachers: assignment.teachers,
      assignments: new Map<TermId, PheAssignment>(),
    };
    if (row.teachers.length === 0 && assignment.teachers.length > 0) row.teachers = assignment.teachers;
    row.assignments.set(assignment.term, assignment);
    rows.set(assignment.cohort, row);
  }
  return [...rows.values()];
}

function StaffPicker({ cohort, staff, selected, onChange }: {
  cohort: string;
  staff: StaffMember[];
  selected: string[];
  onChange: (teachers: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="staff-picker" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={`${cohort} staff`}>{selected.length > 0 ? selected.join(" / ") : "Unassigned"}</summary>
      {open && <div className="staff-picker-options">
        {staff.map((member) => (
          <label key={member.id}>
            <input
              type="checkbox"
              checked={selected.includes(member.name)}
              onChange={(event) => onChange(event.target.checked
                ? [...selected, member.name]
                : selected.filter((name) => name !== member.name))}
            />
            <span>{member.name}</span>
          </label>
        ))}
      </div>}
    </details>
  );
}

export function PlanPage({
  assignments,
  facilities,
  staff,
  units,
  isDirty,
  onFacilityChange,
  onActivityChange,
  onTeacherChange,
  onSwap,
  onApply,
  onDiscard,
}: PlanPageProps) {
  const rows = planRows(assignments);
  const [swapSource, setSwapSource] = useState<BlockPosition | null>(null);

  const finishSwap = (target: BlockPosition) => {
    if (!swapSource) {
      setSwapSource(target);
      return;
    }
    if (swapSource.cohort === target.cohort && swapSource.term !== target.term) {
      onSwap(target.cohort, swapSource.term, target.term);
      setSwapSource(null);
      return;
    }
    setSwapSource(swapSource.cohort === target.cohort && swapSource.term === target.term ? null : target);
  };

  const dropBlock = (event: DragEvent<HTMLTableCellElement>, target: BlockPosition) => {
    event.preventDefault();
    if (swapSource?.cohort === target.cohort && swapSource.term !== target.term) {
      onSwap(target.cohort, swapSource.term, target.term);
    }
    setSwapSource(null);
  };

  return (
    <section className="plan-page" aria-labelledby="plan-title">
      <header className="plan-header">
        <div>
          <h1 id="plan-title">PHE space allocation plan</h1>
          <p>Change units, staff and spaces. Drag a block between terms in the same group to swap its unit and space.</p>
          <p className="swap-status" aria-live="polite">
            {swapSource ? `Selected ${swapSource.cohort} ${swapSource.term}. Choose another term in this row to swap.` : "You can also select two swap handles to move blocks without dragging."}
          </p>
        </div>
        <div className="plan-actions">
          <span className={isDirty ? "plan-dirty" : "plan-saved"}>{isDirty ? "Unsaved changes" : "Plan matches simulator"}</span>
          <button type="button" className="button secondary plan-action-button" onClick={onDiscard} disabled={!isDirty}>
            <RotateCcw size={17} /> Discard
          </button>
          <button type="button" className="button primary plan-action-button" onClick={onApply} disabled={!isDirty}>
            <Check size={18} /> Test plan in simulator
          </button>
        </div>
      </header>

      <div className="plan-table-wrap">
        <table className="plan-table">
          <thead>
            <tr>
              <th scope="col">Groups</th>
              <th scope="col">Staff</th>
              {TERMS.map((term) => <th scope="col" key={term}>{term}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.cohort}>
                <th scope="row">{row.cohort}</th>
                <td className="teacher-cell">
                  <StaffPicker cohort={row.cohort} staff={staff} selected={row.teachers} onChange={(teachers) => onTeacherChange(row.cohort, teachers)} />
                </td>
                {TERMS.map((term) => {
                  const assignment = row.assignments.get(term);
                  const position = { cohort: row.cohort, term };
                  const selected = swapSource?.cohort === row.cohort && swapSource.term === term;
                  const canSwap = swapSource?.cohort === row.cohort && swapSource.term !== term;
                  return (
                    <td
                      key={term}
                      className={`${assignment?.activity.toLowerCase().includes("swim") ? "plan-cell-swimming " : ""}${selected ? "plan-cell-selected " : ""}${canSwap ? "plan-cell-target" : ""}`}
                      onDragOver={(event) => {
                        if (canSwap) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={(event) => dropBlock(event, position)}
                    >
                      {assignment ? (
                        <div className="plan-block">
                          <button
                            type="button"
                            className="swap-handle"
                            draggable
                            aria-pressed={selected}
                            aria-label={selected
                              ? `Cancel ${row.cohort} ${term} block swap`
                              : canSwap
                                ? `Swap ${row.cohort} ${term} block with ${swapSource.term}`
                                : `Select ${row.cohort} ${term} block for swap`}
                            onClick={() => finishSwap(position)}
                            onDragStart={(event) => {
                              setSwapSource(position);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", `${row.cohort}|${term}`);
                            }}
                            onDragEnd={() => setSwapSource(null)}
                          >
                            <GripVertical size={15} aria-hidden="true" />
                          </button>
                          <div className="plan-block-fields">
                            <select
                              aria-label={`${row.cohort} ${term} unit`}
                              value={assignment.activity}
                              onChange={(event) => onActivityChange(row.cohort, term, event.target.value)}
                            >
                              {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                            </select>
                            <select
                              aria-label={`${row.cohort} ${term} space`}
                              value={assignment.facilityId ?? ""}
                              onChange={(event) => onFacilityChange(row.cohort, term, event.target.value as FacilityId)}
                            >
                              {facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
                            </select>
                          </div>
                        </div>
                      ) : <span className="plan-missing">Missing</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
