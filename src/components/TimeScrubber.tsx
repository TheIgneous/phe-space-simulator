import { DAY_END, DAY_START, formatTime } from "../domain/simulation";
import { SLOT_MINUTES } from "../domain/generation-grid";

interface TimeScrubberProps {
  value: number;
  onChange: (value: number) => void;
}

const HOUR_MARKS = Array.from({ length: 8 }, (_, index) => DAY_START + index * 60);

export function TimeScrubber({ value, onChange }: TimeScrubberProps) {
  const percent = ((value - DAY_START) / (DAY_END - DAY_START)) * 100;
  return (
    <section className="scrubber" aria-label="School day timeline">
      <div className="scrubber-hours" aria-hidden="true">
        {HOUR_MARKS.map((time) => (
          <span key={time} style={{ left: `${((time - DAY_START) / (DAY_END - DAY_START)) * 100}%` }}>
            {formatTime(time)}
          </span>
        ))}
      </div>
      <div className="scrubber-track" aria-hidden="true">
        {HOUR_MARKS.map((time) => (
          <i key={time} style={{ left: `${((time - DAY_START) / (DAY_END - DAY_START)) * 100}%` }} />
        ))}
        <div className="scrubber-playhead" style={{ left: `${percent}%` }}>
          <span>{formatTime(value)}</span>
        </div>
      </div>
      <input
        aria-label="Current simulation time"
        type="range"
        min={DAY_START}
        max={DAY_END}
        step={SLOT_MINUTES}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </section>
  );
}
