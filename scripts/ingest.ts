/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import ExcelJS from "exceljs";
import { XMLParser } from "fast-xml-parser";
import { FACILITIES, normalizeWorkbookFacility, normalizeXmlFacility } from "../src/domain/facilities.ts";
import { normalizeStaffNames } from "../src/domain/staff.ts";
import { TERMS, type DataWarning, type DayIndex, type FacilityId, type OccupancyEvent, type PeriodDefinition, type SimulationDataset, type StaffMember, type TermId, type WeekId } from "../src/types.ts";

type SourceName = "primary" | "secondary";

interface SourcePaths {
  primary: string;
  secondary: string;
  spaces: string;
  output: string;
}

interface WorkbookAssignment {
  cohort: string;
  term: TermId;
  activity: string;
  teacherLabel: string;
  facilityId: FacilityId | null;
  rawFacility: string;
}

interface XmlContext {
  root: any;
  source: SourceName;
  periods: Map<string, { start: number; end: number; name: string }>;
  subjects: Map<string, any>;
  teachers: Map<string, any>;
  classrooms: Map<string, any>;
  classes: Map<string, any>;
  groups: Map<string, any>;
  cardsByLesson: Map<string, any[]>;
}

function parseArgs(argv: string[]): SourcePaths {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error("Arguments must use --primary <file> --secondary <file> --spaces <file>.");
    }
    values.set(flag.slice(2), value);
  }

  for (const required of ["primary", "secondary", "spaces"]) {
    if (!values.has(required)) {
      throw new Error(`Missing required --${required} argument.`);
    }
  }

  return {
    primary: resolve(values.get("primary")!),
    secondary: resolve(values.get("secondary")!),
    spaces: resolve(values.get("spaces")!),
    output: resolve(values.get("output") ?? "src/data/snapshot.json"),
  };
}

const arrayify = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

function splitIds(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseTime(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) {
    throw new Error(`Invalid timetable time: ${value}`);
  }
  return hours * 60 + minutes;
}

function activeIndexes(mask: string, length: number): number[] {
  if (!mask || mask === "1") return Array.from({ length }, (_, index) => index);
  const variants = mask.split(",");
  const result = new Set<number>();
  for (const variant of variants) {
    [...variant].forEach((character, index) => {
      if (character === "1" && index < length) result.add(index);
    });
  }
  return [...result];
}

function weeksFromMask(mask: unknown): WeekId[] {
  const indexes = activeIndexes(String(mask ?? ""), 2);
  return indexes.length === 0 ? ["A", "B"] : indexes.map((index) => (index === 0 ? "A" : "B"));
}

function termsFromMask(mask: unknown): TermId[] {
  const indexes = activeIndexes(String(mask ?? ""), TERMS.length);
  return indexes.length === 0 ? [...TERMS] : indexes.map((index) => TERMS[index]!).filter(Boolean);
}

function daysFromMask(mask: unknown): DayIndex[] {
  return activeIndexes(String(mask ?? ""), 5).filter((index): index is DayIndex => index >= 0 && index <= 4);
}

function canonicalCohort(raw: string): string {
  const compact = raw.trim().replace(/\s+/g, " ");
  const noSpaceMatch = compact.match(/^(6|7|8|9|10)\s*(Girls|Boys)$/i);
  if (noSpaceMatch) return `${noSpaceMatch[1]} ${noSpaceMatch[2]![0]!.toUpperCase()}${noSpaceMatch[2]!.slice(1).toLowerCase()}`;
  if (/^Grade 5Girls$/i.test(compact)) return "Grade 5 Girls";
  return compact;
}

function teacherList(label: string): string[] {
  return normalizeStaffNames(label
    .split("/")
    .map((teacher) => teacher.trim())
    .filter(Boolean));
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function readWorkbookAssignments(path: string, warnings: DataWarning[]): Promise<Map<string, WorkbookAssignment>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.getWorksheet("PE Spaces");
  if (!sheet) throw new Error("Workbook is missing the 'PE Spaces' worksheet.");

  const termColumns: Record<TermId, { activity: number; facility: number }> = {
    T1a: { activity: 3, facility: 4 },
    T1b: { activity: 5, facility: 6 },
    T2a: { activity: 7, facility: 8 },
    T2b: { activity: 9, facility: 10 },
    T3a: { activity: 11, facility: 12 },
    T3b: { activity: 13, facility: 14 },
  };

  const assignments = new Map<string, WorkbookAssignment>();
  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const cohortRaw = sheet.getCell(rowNumber, 1).text.trim();
    if (!cohortRaw) continue;
    const cohort = canonicalCohort(cohortRaw);
    const teacherLabel = sheet.getCell(rowNumber, 2).text.trim();

    for (const term of TERMS) {
      const columns = termColumns[term];
      const activity = sheet.getCell(rowNumber, columns.activity).text.trim();
      const rawFacility = sheet.getCell(rowNumber, columns.facility).text.trim();
      if (!rawFacility) {
        warnings.push({
          id: `missing-assignment-${safeId(cohort)}-${term}`,
          code: "missing-assignment",
          message: `${cohort} has no facility assignment for ${term}.`,
          cohort,
          term,
        });
        continue;
      }

      const facilityId = normalizeWorkbookFacility(rawFacility, cohort);
      if (!facilityId) {
        warnings.push({
          id: `unmatched-space-${safeId(cohort)}-${term}`,
          code: "unmatched-space",
          message: `${cohort} uses an unknown facility '${rawFacility}' in ${term}.`,
          cohort,
          term,
        });
      }
      if (!activity) {
        warnings.push({
          id: `missing-unit-${safeId(cohort)}-${term}`,
          code: "missing-unit",
          message: `${cohort} has no named unit for ${term}.`,
          cohort,
          term,
        });
      }

      assignments.set(`${cohort}|${term}`, {
        cohort,
        term,
        activity: activity || "Unit not specified",
        teacherLabel,
        facilityId,
        rawFacility,
      });
    }
  }
  return assignments;
}

function mapById(section: any, childName: string): Map<string, any> {
  return new Map(arrayify(section?.[childName]).map((item: any) => [String(item.id), item]));
}

async function parseXml(path: string, source: SourceName): Promise<XmlContext> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseAttributeValue: false });
  const root = parser.parse(await readFile(path, "utf8")).timetable;
  const periods = new Map<string, { start: number; end: number; name: string }>();
  for (const period of arrayify<any>(root.periods?.period)) {
    periods.set(String(period.period), {
      start: parseTime(String(period.starttime)),
      end: parseTime(String(period.endtime)),
      name: String(period.short ?? period.name ?? period.period),
    });
  }

  const cardsByLesson = new Map<string, any[]>();
  for (const card of arrayify<any>(root.cards?.card)) {
    const key = String(card.lessonid);
    const cards = cardsByLesson.get(key) ?? [];
    cards.push(card);
    cardsByLesson.set(key, cards);
  }

  return {
    root,
    source,
    periods,
    subjects: mapById(root.subjects, "subject"),
    teachers: mapById(root.teachers, "teacher"),
    classrooms: mapById(root.classrooms, "classroom"),
    classes: mapById(root.classes, "class"),
    groups: mapById(root.groups, "group"),
    cardsByLesson,
  };
}

function teacherNames(context: XmlContext, ids: unknown): string[] {
  return splitIds(ids).map((id) => String(context.teachers.get(id)?.name ?? id));
}

function pheStaff(contexts: XmlContext[]): StaffMember[] {
  const staff = new Map<string, StaffMember>();
  for (const context of contexts) {
    for (const lesson of arrayify<any>(context.root.lessons?.lesson)) {
      const subject = String(context.subjects.get(String(lesson.subjectid))?.name ?? "");
      if (subject !== "PHE PYP" && subject !== "PHE Girls" && subject !== "PHE Boys") continue;
      for (const id of splitIds(lesson.teacherids)) {
        const name = String(context.teachers.get(id)?.name ?? "").trim();
        if (name) staff.set(name, { id, name });
      }
    }
  }
  return [...staff.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function classNames(context: XmlContext, ids: unknown): string[] {
  return splitIds(ids).map((id) => String(context.classes.get(id)?.name ?? id));
}

function groupNames(context: XmlContext, ids: unknown): string[] {
  return splitIds(ids).map((id) => String(context.groups.get(id)?.name ?? id));
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
  const source = context.source === "primary" ? "PYP" : "MYP";
  return [...context.periods.entries()].map(([period, definition]) => ({
    source,
    period: Number(period),
    label: `P${definition.name}`,
    start: definition.start,
    end: definition.end,
  }));
}

function addPheEvents(
  context: XmlContext,
  assignments: Map<string, WorkbookAssignment>,
  warnings: DataWarning[],
  events: OccupancyEvent[],
): void {
  for (const lesson of arrayify<any>(context.root.lessons?.lesson)) {
    const subject = String(context.subjects.get(String(lesson.subjectid))?.name ?? "");
    const isPrimaryPhe = context.source === "primary" && subject === "PHE PYP";
    const isSecondaryPhe = context.source === "secondary" && (subject === "PHE Girls" || subject === "PHE Boys");
    if (!isPrimaryPhe && !isSecondaryPhe) continue;

    const classes = classNames(context, lesson.classids);
    const groups = groupNames(context, lesson.groupids);
    const cohorts = isPrimaryPhe ? primaryCohorts(classes, groups) : [secondaryCohort(subject, classes)].filter(Boolean) as string[];
    if (cohorts.length === 0) continue;

    const xmlTeachers = teacherNames(context, lesson.teacherids);
    for (const [cardIndex, card] of (context.cardsByLesson.get(String(lesson.id)) ?? []).entries()) {
      const period = context.periods.get(String(card.period));
      if (!period) continue;
      const days = daysFromMask(card.days);
      const weeks = weeksFromMask(card.weeks);
      const terms = termsFromMask(card.terms);

      for (const cohort of cohorts) {
        for (const term of terms) {
          const assignment = assignments.get(`${cohort}|${term}`);
          if (!assignment?.facilityId) {
            if (!warnings.some((warning) => warning.id === `event-missing-${safeId(cohort)}-${term}`)) {
              warnings.push({
                id: `event-missing-${safeId(cohort)}-${term}`,
                code: "missing-assignment",
                message: `${cohort} cannot be placed in ${term} because its assignment is missing or unknown.`,
                cohort,
                term,
              });
            }
            continue;
          }
          for (const day of days) {
            events.push({
              id: `${context.source}-${safeId(String(lesson.id))}-${cardIndex}-${safeId(cohort)}-${term}-${day}`,
              source: context.source,
              phase: context.source === "primary" ? "Primary" : "Secondary",
              term,
              weeks,
              day,
              start: period.start,
              end: period.end,
              facilityId: assignment.facilityId,
              cohort,
              classes,
              activity: assignment.activity,
              teachers: teacherList(assignment.teacherLabel).length > 0 ? teacherList(assignment.teacherLabel) : xmlTeachers,
              kind: "PHE",
            });
          }
        }
      }
    }
  }
}

function isPrimaryClass(className: string): boolean {
  return /^Mini\b|^EY[12]|^[1-5][A-Z]/i.test(className);
}

function addExistingBookings(context: XmlContext, events: OccupancyEvent[]): void {
  for (const lesson of arrayify<any>(context.root.lessons?.lesson)) {
    const subject = String(context.subjects.get(String(lesson.subjectid))?.name ?? "Unspecified booking");
    const isPhe = subject === "PHE PYP" || subject === "PHE Girls" || subject === "PHE Boys";
    if (isPhe) continue;
    const classes = classNames(context, lesson.classids);
    if (context.source === "primary" && (classes.length === 0 || !classes.every(isPrimaryClass))) continue;
    const lessonRoomIds = splitIds(lesson.classroomids);
    const fallbackRoomIds = lessonRoomIds.length === 1 ? lessonRoomIds : [];

    for (const [cardIndex, card] of (context.cardsByLesson.get(String(lesson.id)) ?? []).entries()) {
      const period = context.periods.get(String(card.period));
      if (!period) continue;
      const cardRoomIds = splitIds(card.classroomids);
      const roomIds = cardRoomIds.length > 0 ? cardRoomIds : fallbackRoomIds;
      const facilities = roomIds
        .map((roomId) => String(context.classrooms.get(roomId)?.name ?? ""))
        .map((roomName) => normalizeXmlFacility(roomName, context.source))
        .filter((facility): facility is FacilityId => facility !== null);
      if (facilities.length === 0) continue;

      const days = daysFromMask(card.days);
      const weeks = weeksFromMask(card.weeks);
      const terms = termsFromMask(card.terms);
      for (const facilityId of new Set(facilities)) {
        for (const term of terms) {
          for (const day of days) {
            events.push({
              id: `existing-${context.source}-${safeId(String(lesson.id))}-${cardIndex}-${facilityId}-${term}-${day}`,
              source: context.source,
              phase: "Existing",
              term,
              weeks,
              day,
              start: period.start,
              end: period.end,
              facilityId,
              cohort: classes.join(" + ") || "Existing booking",
              classes,
              activity: subject,
              teachers: teacherNames(context, lesson.teacherids),
              kind: "existing-booking",
            });
          }
        }
      }
    }
  }
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function main(): Promise<void> {
  const paths = parseArgs(process.argv.slice(2));
  const warnings: DataWarning[] = [];
  const [assignments, primary, secondary] = await Promise.all([
    readWorkbookAssignments(paths.spaces, warnings),
    parseXml(paths.primary, "primary"),
    parseXml(paths.secondary, "secondary"),
  ]);
  const events: OccupancyEvent[] = [];
  addPheEvents(primary, assignments, warnings, events);
  addPheEvents(secondary, assignments, warnings, events);
  addExistingBookings(primary, events);
  addExistingBookings(secondary, events);

  const dataset: SimulationDataset = {
    metadata: {
      generatedAt: new Date().toISOString(),
      academicYear: "2026/27",
      sources: await Promise.all(
        [paths.primary, paths.secondary, paths.spaces].map(async (path) => ({ name: basename(path), sha256: await sha256(path) })),
      ),
      privacy: "Sanitized: no student records, names, emails, mobile numbers, or student IDs are retained.",
    },
    facilities: FACILITIES,
    staff: pheStaff([primary, secondary]),
    assignments: [...assignments.values()].map((assignment) => ({
      cohort: assignment.cohort,
      term: assignment.term,
      activity: assignment.activity,
      teachers: teacherList(assignment.teacherLabel),
      facilityId: assignment.facilityId,
    })),
    periods: [...timetablePeriods(primary), ...timetablePeriods(secondary)],
    events: events.sort((left, right) => left.term.localeCompare(right.term) || left.day - right.day || left.start - right.start),
    warnings,
  };

  await mkdir(dirname(paths.output), { recursive: true });
  await writeFile(paths.output, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  console.log(`Generated ${paths.output}`);
  console.log(`${dataset.events.length} sanitized events; ${dataset.warnings.length} data warnings.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
