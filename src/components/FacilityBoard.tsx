import { Building2, Dumbbell, Waves, Trees } from "lucide-react";
import { FACILITY_GROUPS } from "../domain/facilities";
import type { FacilityGroup, FacilityView } from "../types";
import { FacilityCard } from "./FacilityCard";

const GROUP_ICONS: Record<FacilityGroup, typeof Building2> = {
  "Main Sports Hall": Building2,
  Pools: Waves,
  Outdoor: Trees,
  "Other spaces": Dumbbell,
};

interface FacilityBoardProps {
  views: FacilityView[];
}

export function FacilityBoard({ views }: FacilityBoardProps) {
  return (
    <div className="facility-board">
      {FACILITY_GROUPS.map((group) => {
        const Icon = GROUP_ICONS[group];
        return (
          <section className={`facility-group group-${group.toLowerCase().replaceAll(" ", "-")}`} key={group}>
            <h2><Icon size={21} aria-hidden="true" /> {group}</h2>
            <div className="facility-grid">
              {views.filter((view) => view.facility.group === group).map((view) => (
                <FacilityCard key={view.facility.id} view={view} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
