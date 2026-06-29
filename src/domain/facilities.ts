import type { Facility, FacilityGroup, FacilityId, TermId } from "../types";

export const FACILITIES: Facility[] = [
  { id: "primary-gym-1", name: "Primary Gym 1", group: "Main Sports Hall", capacity: 1 },
  { id: "primary-gym-2", name: "Primary Gym 2", group: "Main Sports Hall", capacity: 1 },
  { id: "secondary-gym-1", name: "Secondary Gym 1", group: "Main Sports Hall", capacity: 1 },
  { id: "secondary-gym-2", name: "Secondary Gym 2", group: "Main Sports Hall", capacity: 1 },
  { id: "main-pool", name: "Main Pool", group: "Pools", capacity: 1 },
  { id: "side-pool", name: "Side Pool", group: "Pools", capacity: 1 },
  {
    id: "ey-pool",
    name: "EY Pool",
    group: "Pools",
    capacity: 1,
    unavailableTerms: ["T1a", "T3b"],
    unavailableReason: "Unavailable — hot term",
  },
  { id: "main-pitch-1", name: "Main Pitch 1", group: "Outdoor", capacity: 1 },
  { id: "main-pitch-2", name: "Main Pitch 2", group: "Outdoor", capacity: 1 },
  { id: "back-pitch-1", name: "Back Pitch 1", group: "Outdoor", capacity: 1 },
  { id: "back-pitch-2", name: "Back Pitch 2", group: "Outdoor", capacity: 1 },
  { id: "tennis-courts", name: "Tennis Courts", group: "Outdoor", capacity: 2 },
  { id: "ey-gym", name: "EY Gym", group: "Other spaces", capacity: 1 },
  { id: "fitness-suite", name: "Fitness Suite", group: "Other spaces", capacity: 1 },
  { id: "c2-14", name: "C2-14", group: "Other spaces", capacity: 1 },
];

export const FACILITY_GROUPS: FacilityGroup[] = ["Main Sports Hall", "Pools", "Outdoor", "Other spaces"];

export const FACILITY_BY_ID = new Map(FACILITIES.map((facility) => [facility.id, facility]));

const GYM_ZONE_IDS: FacilityId[] = ["primary-gym-1", "primary-gym-2", "secondary-gym-1", "secondary-gym-2"];

/** Confirmed spaces that can absorb one another's excess gym occupancy. */
export const RELOCATION_POOLS: FacilityId[][] = [GYM_ZONE_IDS];

export function relocationPoolFor(facilityId: FacilityId): FacilityId[] | null {
  return RELOCATION_POOLS.find((pool) => pool.includes(facilityId)) ?? null;
}

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function isEarlyYearsCohort(cohort: string): boolean {
  return /^(minis|ey1|ey2)$/i.test(cohort.trim());
}

export function normalizeWorkbookFacility(raw: string, cohort: string): FacilityId | null {
  const key = compact(raw);
  const aliases: Record<string, FacilityId> = {
    eygym: "ey-gym",
    primarygym1: "primary-gym-1",
    primarygym2: "primary-gym-2",
    secondarygym1: "secondary-gym-1",
    secondarygym2: "secondary-gym-2",
    mainpitch1: "main-pitch-1",
    mainpitch2: "main-pitch-2",
    backpitch1: "back-pitch-1",
    backpitch2: "back-pitch-2",
    tenniscourt: "tennis-courts",
    tenniscourts: "tennis-courts",
    fitnesssuite: "fitness-suite",
    c214: "c2-14",
    eypool: "ey-pool",
    mainpool: "main-pool",
    sidepool: "side-pool",
  };

  if (key === "swimmingpool" || key === "pool") {
    return isEarlyYearsCohort(cohort) ? "side-pool" : "main-pool";
  }

  return aliases[key] ?? null;
}

export function normalizeXmlFacility(raw: string, source: "primary" | "secondary"): FacilityId | null {
  const key = compact(raw);
  const phaseGym: Record<string, FacilityId> =
    source === "primary"
      ? { maingym1: "primary-gym-1", maingym2: "primary-gym-2" }
      : { maingym1: "secondary-gym-1", maingym2: "secondary-gym-2" };

  return (
    phaseGym[key] ??
    ({
      eygym: "ey-gym",
      mainpool: "main-pool",
      sidepool: "side-pool",
      fitnesssuite: "fitness-suite",
      c214: "c2-14",
    } as Record<string, FacilityId>)[key] ??
    null
  );
}

export function isFacilityUnavailable(facility: Facility, term: TermId): boolean {
  return facility.unavailableTerms?.includes(term) ?? false;
}
