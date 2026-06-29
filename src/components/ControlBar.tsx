import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { DAYS, TERMS, WEEKS, type DayIndex, type Selection, type TermId, type WeekId } from "../types";
import { formatTime } from "../domain/simulation";

interface ControlBarProps {
  selection: Selection;
  isPlaying: boolean;
  onTermChange: (term: TermId) => void;
  onWeekChange: (week: WeekId) => void;
  onDayChange: (day: DayIndex) => void;
  onPlayToggle: () => void;
  onStep: (direction: -1 | 1) => void;
  onReset: () => void;
}

export function ControlBar({
  selection,
  isPlaying,
  onTermChange,
  onWeekChange,
  onDayChange,
  onPlayToggle,
  onStep,
  onReset,
}: ControlBarProps) {
  return (
    <header className="control-bar">
      <div className="brand-lockup">
        <h1>PHE Space Simulator</h1>
        <p>AY 2026/27 space validation</p>
      </div>
      <div className="control-fields" aria-label="Simulation controls">
        <label>
          <span>Term</span>
          <select value={selection.term} onChange={(event) => onTermChange(event.target.value as TermId)}>
            {TERMS.map((term) => (
              <option key={term}>{term}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Week</span>
          <select value={selection.week} onChange={(event) => onWeekChange(event.target.value as WeekId)}>
            {WEEKS.map((week) => (
              <option key={week}>{week}</option>
            ))}
          </select>
        </label>
        <label className="day-control">
          <span>Day</span>
          <select value={selection.day} onChange={(event) => onDayChange(Number(event.target.value) as DayIndex)}>
            {DAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <div className="time-readout" aria-live="polite">
          <span>Time</span>
          <strong>{formatTime(selection.time)}</strong>
        </div>
      </div>
      <div className="transport-controls">
        <button type="button" className="button secondary" onClick={() => onStep(-1)} aria-label="Previous timetable boundary">
          <SkipBack size={19} /> <span>Prev step</span>
        </button>
        <button type="button" className="button primary" onClick={onPlayToggle} aria-pressed={isPlaying}>
          {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          <span>{isPlaying ? "Pause" : "Play"}</span>
        </button>
        <button type="button" className="button secondary" onClick={() => onStep(1)} aria-label="Next timetable boundary">
          <SkipForward size={19} /> <span>Next step</span>
        </button>
        <button type="button" className="button secondary" onClick={onReset}>
          <RotateCcw size={18} /> <span>Reset</span>
        </button>
      </div>
    </header>
  );
}
