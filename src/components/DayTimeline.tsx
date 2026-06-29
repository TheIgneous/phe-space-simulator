import { UserRound } from "lucide-react";
import { DAY_END, DAY_START, formatTime } from "../domain/simulation";
import type { DayName, PeriodDefinition } from "../types";

interface DayTimelineProps {
  day: DayName;
  periods: PeriodDefinition[];
  currentTime: number;
}

function PeriodRow({ source, periods }: { source: "PYP" | "MYP"; periods: PeriodDefinition[] }) {
  return (
    <div className={`period-row period-${source.toLowerCase()}`}>
      <div className="period-label"><UserRound size={18} /> <strong>{source}</strong> <span>({source === "PYP" ? "40" : "60"} min)</span></div>
      <div className="period-track">
        {periods.filter((period) => period.source === source).map((period) => (
          <div
            className="period-block"
            key={`${source}-${period.period}`}
            style={{
              left: `${((period.start - DAY_START) / (DAY_END - DAY_START)) * 100}%`,
              width: `${((period.end - period.start) / (DAY_END - DAY_START)) * 100}%`,
            }}
          >
            <span>{formatTime(period.start)}–{formatTime(period.end)}</span>
            <strong>{period.label}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DayTimeline({ day, periods, currentTime }: DayTimelineProps) {
  const percent = ((currentTime - DAY_START) / (DAY_END - DAY_START)) * 100;
  const trackPercent = 16 + percent * 0.84;
  return (
    <section className="day-timeline">
      <h2>{day} timeline <small>10-minute generation grid</small></h2>
      <div className="timeline-hours" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => DAY_START + index * 60).map((time) => (
          <span key={time} style={{ left: `${((time - DAY_START) / (DAY_END - DAY_START)) * 100}%` }}>{formatTime(time)}</span>
        ))}
      </div>
      <div className="timeline-content">
        <div className="timeline-playhead" style={{ left: `${trackPercent}%` }} aria-hidden="true" />
        <PeriodRow source="PYP" periods={periods} />
        <PeriodRow source="MYP" periods={periods} />
      </div>
    </section>
  );
}
