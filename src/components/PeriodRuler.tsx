import { type PointerEvent as ReactPointerEvent } from "react";
import { DAY_END, DAY_START, formatTime, hourMarks } from "../domain/simulation";
import { SLOT_MINUTES } from "../domain/generation-grid";
import type { PeriodDefinition, Selection, SimulationDataset } from "../types";

const SPAN = DAY_END - DAY_START;
const GUTTER = 150;
const pct = (time: number): number => ((time - DAY_START) / SPAN) * 100;
const fractionOf = (time: number): number => (time - DAY_START) / SPAN;
const clampTime = (time: number): number => Math.min(DAY_END, Math.max(DAY_START, time));

interface PeriodRulerProps {
  dataset: SimulationDataset;
  selection: Selection;
  onScrub?: (time: number) => void;
  className?: string;
}

/**
 * The hour axis + PYP/MYP period bands + a "now" playhead, on a shared clock-time scale.
 * Used above the Spaces board so it carries the same time context as the gantt.
 */
export function PeriodRuler({ dataset, selection, onScrub, className }: PeriodRulerProps) {
  const scrubFrom = (clientX: number, track: HTMLElement) => {
    if (!onScrub) return;
    const rect = track.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onScrub(clampTime(Math.round((DAY_START + fraction * SPAN) / SLOT_MINUTES) * SLOT_MINUTES));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onScrub) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubFrom(event.clientX, event.currentTarget);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (onScrub && event.buttons === 1) scrubFrom(event.clientX, event.currentTarget);
  };

  const periodRow = (source: "PYP" | "MYP", periods: PeriodDefinition[]) => (
    <div className="tl-period-row">
      <div className={`tl-period-label tl-${source.toLowerCase()}`}>{source}</div>
      <div className={`tl-period-track${onScrub ? "" : " tl-period-track-static"}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
        {periods.filter((period) => period.source === source).map((period) => (
          <div
            key={`${source}-${period.period}`}
            className={`tl-period-block tl-${source.toLowerCase()}${period.lunch ? " tl-period-break" : ""}`}
            style={{ left: `${pct(period.start)}%`, width: `${Math.max(pct(period.end) - pct(period.start), 1)}%` }}
          >
            {period.label}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className={`tl-rulerblock${className ? ` ${className}` : ""}`}>
      <div className="tl-ruler" aria-hidden="true">
        <div className="tl-gutter" />
        <div className="tl-axis">
          {hourMarks().map((time) => <span key={time} style={{ left: `${pct(time)}%` }}>{formatTime(time).slice(0, 2)}</span>)}
        </div>
      </div>
      <div className="tl-grid">
        <div className="tl-playhead" style={{ left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${fractionOf(selection.time)})` }} aria-hidden="true">
          <span>{formatTime(selection.time)}</span>
        </div>
        <div className="tl-periods">
          {periodRow("PYP", dataset.periods)}
          {periodRow("MYP", dataset.periods)}
        </div>
      </div>
    </div>
  );
}
