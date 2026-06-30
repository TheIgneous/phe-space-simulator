/* eslint-disable @typescript-eslint/no-explicit-any */
import { XMLParser } from "fast-xml-parser";
import { dedupeEvents } from "./events";
import { normalizeXmlFacility } from "./facilities";
import {
  TERMS,
  type DataWarning,
  type DayIndex,
  type FacilityId,
  type OccupancyEvent,
  type PeriodDefinition,
  type PheAssignment,
  type SimulationDataset,
  type StaffMember,
  type TermId,
  type WeekId,
} from "../types";

type SourceName = "primary" | "secondary";

/**
 * Subjects that represent timetabled PHE for each phase. The Primary export carries
 * Early-Years and Minis PHE under the dedicated "EY PE"/"EY2PE" subjects rather than
 * "PHE PYP"; treating them as PHE keeps Minis/EY1/EY2 on their pool/gym allocations
 * instead of leaking into the EY Gym as "existing bookings".
 */
const PRIMARY_PHE_SUBJECTS = new Set(["PHE PYP", "EY PE", "EY2PE"]);
const SECONDARY_PHE_SUBJECTS = new Set(["PHE Girls", "PHE Boys"]);

const isPheSubject = (source: SourceName, subject: string): boolean =>
  (source === "primary" ? PRIMARY_PHE_SUBJECTS : SECONDARY_PHE_SUBJECTS).has(subject);

interface XmlContext {
  root: any;
  source: SourceName;
  periods: Map<string, { start: number; end: number; name: string }>;
  lunchPeriods: Set<string>;
  subjects: Map<string, any>;
  teachers: Map<string, any>;
  classrooms: Map<string, any>;
  classes: Map<string, any>;
  groups: Map<string, any>;
  cardsByLesson: Map<string, any[]>;
}

export interface TimetableUpload {
  name: string;
  text: string;
  sha256: string;
}

const arrayify = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

function splitIds(value: unknown): string[] {
  return String(value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

function parseTime(value: string): number {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid timetable time '${value}'.`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function activeIndexes(mask: string, length: number): number[] {
  if (!mask || mask === "1") return Array.from({ length }, (_, index) => index);
  const result = new Set<number>();
  for (const variant of mask.split(",")) {
    [...variant].forEach((character, index) => {
      if (character === "1" && index < length) result.add(index);
    });
  }
  return [...result];
}

const weeksFromMask = (mask: unknown): WeekId[] => {
  const indexes = activeIndexes(String(mask ?? ""), 2);
  return indexes.length === 0 ? ["A", "B"] : indexes.map((index) => (index === 0 ? "A" : "B"));
};
const termsFromMask = (mask: unknown): TermId[] => {
  const indexes = activeIndexes(String(mask ?? ""), TERMS.length);
  return indexes.length === 0 ? [...TERMS] : indexes.map((index) => TERMS[index]!).filter(Boolean);
};
const daysFromMask = (mask: unknown): DayIndex[] =>
  activeIndexes(String(mask ?? ""), 5).filter((index): index is DayIndex => index >= 0 && index <= 4);

const safeId = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const mapById = (section: any, childName: string): Map<string, any> =>
  new Map(arrayify(section?.[childName]).map((item: any) => [String(item.id), item]));

function parseXml(text: string, source: SourceName): XmlContext {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseAttributeValue: false });
  const root = parser.parse(text)?.timetable;
  if (!root) throw new Error(`${source === "primary" ? "Primary" : "Secondary"} file is not a supported timetable XML export.`);

  const periods = new Map<string, { start: number; end: number; name: string }>();
  for (const period of arrayify<any>(root.periods?.period)) {
    periods.set(String(period.period), {
      start: parseTime(String(period.starttime)),
      end: parseTime(String(period.endtime)),
      name: String(period.short ?? period.name ?? period.period),
    });
  }
  if (periods.size === 0) throw new Error(`${source === "primary" ? "Primary" : "Secondary"} XML has no timetable periods.`);

  const cardsByLesson = new Map<string, any[]>();
  for (const card of arrayify<any>(root.cards?.card)) {
    const key = String(card.lessonid);
    cardsByLesson.set(key, [...(cardsByLesson.get(key) ?? []), card]);
  }

  const subjects = mapById(root.subjects, "subject");
  return {
    root,
    source,
    periods,
    lunchPeriods: lunchPeriodIds(root, subjects, cardsByLesson),
    subjects,
    teachers: mapById(root.teachers, "teacher"),
    classrooms: mapById(root.classrooms, "classroom"),
    classes: mapById(root.classes, "class"),
    groups: mapById(root.groups, "group"),
    cardsByLesson,
  };
}

/** Period ids that host a lunch subject (e.g. "Lunch PYP" at P8 for Grades 1–5). */
function lunchPeriodIds(root: any, subjects: Map<string, any>, cardsByLesson: Map<string, any[]>): Set<string> {
  const lunchSubjectIds = new Set(
    [...subjects.entries()].filter(([, subject]) => /lunch/i.test(String(subject?.name ?? ""))).map(([id]) => id),
  );
  const periods = new Set<string>();
  for (const lesson of arrayify<any>(root.lessons?.lesson)) {
    if (!lunchSubjectIds.has(String(lesson.subjectid))) continue;
    for (const card of cardsByLesson.get(String(lesson.id)) ?? []) periods.add(String(card.period));
  }
  return periods;
}

const namesFor = (map: Map<string, any>, ids: unknown): string[] => splitIds(ids).map((id) => String(map.get(id)?.name ?? id));

function pheStaff(contexts: XmlContext[]): StaffMember[] {
  const staff = new Map<string, StaffMember>();
  for (const context of contexts) {
    for (const lesson of arrayify<any>(context.root.lessons?.lesson)) {
      const subject = String(context.subjects.get(String(lesson.subjectid))?.name ?? "");
      if (!isPheSubject(context.source, subject)) continue;
      for (const id of splitIds(lesson.teacherids)) {
        const name = String(context.teachers.get(id)?.name ?? "").trim();
        if (name) staff.set(name, { id, name });
      }
    }
  }
  return [...staff.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function primaryCohorts(classes: string[], groups: string[]): string[] {
  const first = classes[0] ?? "";
  if (/^Mini\b/i.test(first)) return ["Minis"];
  if (/^EY1/i.test(first)) return ["EY1"];
  if (/^EY2/i.test(first)) return ["EY2"];
  const grade = first.match(/^(\d+)/)?.[1];
  if (grade === "1") return ["Grade 1"];
  if (grade === "2") return ["Grade 2 Boys", "Grade 2 Girls"];
  if (["3", "4", "5"].includes(grade ?? "")) {
    const gender = groups.find((group) => group === "Boys" || group === "Girls");
    return gender ? [`Grade ${grade} ${gender}`] : [];
  }
  return [];
}

function secondaryCohort(subject: string, classes: string[]): string | null {
  const grade = classes[0]?.match(/^(6|7|8|9|10)/)?.[1];
  if (!grade) return null;
  if (subject === "PHE Girls") return `${grade} Girls`;
  if (subject === "PHE Boys") return `${grade} Boys`;
  return null;
}

function timetablePeriods(context: XmlContext): PeriodDefinition[] {
  return [...context.periods.entries()].map(([period, definition]) => {
    const lunch = context.lunchPeriods.has(period);
    return {
      source: context.source === "primary" ? "PYP" : "MYP",
      period: Number(period),
      label: lunch ? "Lunch" : `P${definition.name}`,
      start: definition.start,
      end: definition.end,
      ...(lunch ? { lunch: true } : {}),
    };
  });
}

function addPheEvents(
  context: XmlContext,
  assignments: Map<string, PheAssignment>,
  warnings: DataWarning[],
  events: OccupancyEvent[],
): number {
  let added = 0;
  for (const lesson of arrayify<any>(context.root.lessons?.lesson)) {
    const subject = String(context.subjects.get(String(lesson.subjectid))?.name ?? "");
    if (!isPheSubject(context.source, subject)) continue;
    const classes = namesFor(context.classes, lesson.classids);
    const groups = namesFor(context.groups, lesson.groupids);
    const cohorts = context.source === "primary"
      ? primaryCohorts(classes, groups)
      : [secondaryCohort(subject, classes)].filter(Boolean) as string[];
    const xmlTeachers = namesFor(context.teachers, lesson.teacherids);

    for (const [cardIndex, card] of (context.cardsByLesson.get(String(lesson.id)) ?? []).entries()) {
      const period = context.periods.get(String(card.period));
      if (!period) continue;
      for (const cohort of cohorts) {
        for (const term of termsFromMask(card.terms)) {
          const assignment = assignments.get(`${cohort}|${term}`);
          if (!assignment?.facilityId) {
            const id = `event-missing-${safeId(cohort)}-${term}`;
            if (!warnings.some((warning) => warning.id === id)) warnings.push({
              id,
              code: "missing-assignment",
              message: `${cohort} cannot be placed in ${term} because its assignment is missing or unknown.`,
              cohort,
              term,
            });
            continue;
          }
          for (const day of daysFromMask(card.days)) {
            events.push({
              id: `${context.source}-${safeId(String(lesson.id))}-${cardIndex}-${safeId(cohort)}-${term}-${day}`,
              source: context.source,
              phase: context.source === "primary" ? "Primary" : "Secondary",
              term,
              weeks: weeksFromMask(card.weeks),
              day,
              start: period.start,
              end: period.end,
              facilityId: assignment.facilityId,
              cohort,
              classes,
              activity: assignment.activity,
              teachers: assignment.teachers.length > 0 ? assignment.teachers : xmlTeachers,
              kind: "PHE",
            });
            added += 1;
          }
        }
      }
    }
  }
  return added;
}

const isPrimaryClass = (name: string): boolean => /^Mini\b|^EY[12]|^[1-5][A-Z]/i.test(name);

function addExistingBookings(context: XmlContext, events: OccupancyEvent[]): void {
  for (const lesson of arrayify<any>(context.root.lessons?.lesson)) {
    const subject = String(context.subjects.get(String(lesson.subjectid))?.name ?? "Unspecified booking");
    if (isPheSubject(context.source, subject)) continue;
    const classes = namesFor(context.classes, lesson.classids);
    if (context.source === "primary" && (classes.length === 0 || !classes.every(isPrimaryClass))) continue;
    const fallbackRoomIds = splitIds(lesson.classroomids);

    for (const [cardIndex, card] of (context.cardsByLesson.get(String(lesson.id)) ?? []).entries()) {
      const period = context.periods.get(String(card.period));
      if (!period) continue;
      const cardRoomIds = splitIds(card.classroomids);
      const roomIds = cardRoomIds.length > 0 ? cardRoomIds : fallbackRoomIds.length === 1 ? fallbackRoomIds : [];
      const facilities = roomIds
        .map((id) => String(context.classrooms.get(id)?.name ?? ""))
        .map((name) => normalizeXmlFacility(name, context.source))
        .filter((facility): facility is FacilityId => facility !== null);
      for (const facilityId of new Set(facilities)) {
        for (const term of termsFromMask(card.terms)) {
          for (const day of daysFromMask(card.days)) {
            events.push({
              id: `existing-${context.source}-${safeId(String(lesson.id))}-${cardIndex}-${facilityId}-${term}-${day}`,
              source: context.source,
              phase: "Existing",
              term,
              weeks: weeksFromMask(card.weeks),
              day,
              start: period.start,
              end: period.end,
              facilityId,
              cohort: classes.join(" + ") || "Existing booking",
              classes,
              activity: subject,
              teachers: namesFor(context.teachers, lesson.teacherids),
              kind: "existing-booking",
            });
          }
        }
      }
    }
  }
}

export { dedupeEvents };

export function regenerateFromTimetables(
  current: SimulationDataset,
  primaryUpload: TimetableUpload,
  secondaryUpload: TimetableUpload,
): SimulationDataset {
  const primary = parseXml(primaryUpload.text, "primary");
  const secondary = parseXml(secondaryUpload.text, "secondary");
  const assignments = new Map(current.assignments.map((assignment) => [`${assignment.cohort}|${assignment.term}`, assignment]));
  const warnings = current.warnings.filter((warning) => !warning.id.startsWith("event-missing-"));
  const events: OccupancyEvent[] = [];
  const primaryCount = addPheEvents(primary, assignments, warnings, events);
  const secondaryCount = addPheEvents(secondary, assignments, warnings, events);
  if (primaryCount === 0) throw new Error("Primary XML contains no recognized Minis–Grade 5 PHE timetable events.");
  if (secondaryCount === 0) throw new Error("Secondary XML contains no recognized Grade 6–10 PHE timetable events.");
  addExistingBookings(primary, events);
  addExistingBookings(secondary, events);

  const allocationSource = current.metadata.sources.find((source) => /\.(xlsx|csv)$/i.test(source.name));
  return {
    ...current,
    metadata: {
      ...current.metadata,
      generatedAt: new Date().toISOString(),
      sources: [
        { name: primaryUpload.name, sha256: primaryUpload.sha256 },
        { name: secondaryUpload.name, sha256: secondaryUpload.sha256 },
        ...(allocationSource ? [allocationSource] : []),
      ],
    },
    periods: [...timetablePeriods(primary), ...timetablePeriods(secondary)],
    staff: pheStaff([primary, secondary]),
    events: dedupeEvents(events).sort((left, right) => left.term.localeCompare(right.term) || left.day - right.day || left.start - right.start),
    warnings,
  };
}

export async function fileUpload(file: File): Promise<TimetableUpload> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { name: file.name, text: new TextDecoder().decode(bytes), sha256 };
}
