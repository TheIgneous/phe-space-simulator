export const TERMS = ["T1a", "T1b", "T2a", "T2b", "T3a", "T3b"] as const;
export type TermId = (typeof TERMS)[number];

export const WEEKS = ["A", "B"] as const;
export type WeekId = (typeof WEEKS)[number];

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
export type DayName = (typeof DAYS)[number];
export type DayIndex = 0 | 1 | 2 | 3 | 4;

export type Phase = "Primary" | "Secondary" | "Existing";
export type FacilityGroup = "Main Sports Hall" | "Pools" | "Outdoor" | "Other spaces";
export type FacilityStatus = "available" | "occupied" | "conditional" | "conflict" | "unavailable";

export type FacilityId =
  | "primary-gym-1"
  | "primary-gym-2"
  | "secondary-gym-1"
  | "secondary-gym-2"
  | "main-pool"
  | "side-pool"
  | "ey-pool"
  | "main-pitch-1"
  | "main-pitch-2"
  | "back-pitch-1"
  | "back-pitch-2"
  | "tennis-courts"
  | "ey-gym"
  | "fitness-suite"
  | "c2-14";

export interface Facility {
  id: FacilityId;
  name: string;
  group: FacilityGroup;
  capacity: number;
  unavailableTerms?: TermId[];
  unavailableReason?: string;
}

export interface PeriodDefinition {
  source: "PYP" | "MYP";
  period: number;
  label: string;
  start: number;
  end: number;
}

export interface OccupancyEvent {
  id: string;
  source: "primary" | "secondary";
  phase: Phase;
  term: TermId;
  weeks: WeekId[];
  day: DayIndex;
  start: number;
  end: number;
  facilityId: FacilityId;
  cohort: string;
  classes: string[];
  activity: string;
  teachers: string[];
  kind: "PHE" | "existing-booking";
}

export interface PheAssignment {
  cohort: string;
  term: TermId;
  activity: string;
  teachers: string[];
  facilityId: FacilityId | null;
}

export interface StaffMember {
  id: string;
  name: string;
}

export interface DataWarning {
  id: string;
  code: "missing-unit" | "missing-assignment" | "unmatched-space";
  message: string;
  cohort?: string;
  term?: TermId;
}

export interface SimulationDataset {
  metadata: {
    generatedAt: string;
    academicYear: string;
    sources: Array<{ name: string; sha256: string }>;
    privacy: string;
  };
  facilities: Facility[];
  staff: StaffMember[];
  assignments: PheAssignment[];
  periods: PeriodDefinition[];
  events: OccupancyEvent[];
  warnings: DataWarning[];
}

export interface Selection {
  term: TermId;
  week: WeekId;
  day: DayIndex;
  time: number;
}

export interface FacilityView {
  facility: Facility;
  status: FacilityStatus;
  events: OccupancyEvent[];
  label: string;
}

export interface Issue {
  id: string;
  severity: "workable" | "non-workable" | "data";
  type: "capacity" | "unavailable" | "data";
  facilityId?: FacilityId;
  term: TermId;
  week?: WeekId;
  day?: DayIndex;
  start?: number;
  end?: number;
  title: string;
  detail: string;
  eventIds: string[];
}
