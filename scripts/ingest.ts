/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import ExcelJS from "exceljs";
import { XMLParser } from "fast-xml-parser";
import { FACILITIES, normalizeWorkbookFacility, normalizeXmlFacility } from "../src/domain/facilities.ts";
import { dedupeEvents } from "../src/domain/events.ts";
import { normalizeStaffNames } from "../src/domain/staff.ts";
import { TERMS, type DataWarning, type DayIndex, type FacilityId, type OccupancyEvent, type PeriodDefinition, type SimulationDataset, type StaffMember, type TermId, type WeekId } from "../src/types.ts";

type SourceName = "primary" | "secondary";

/** Subjects that represent timetabled PHE per phase (Primary EY/Minis use EY PE/EY2PE). */
const PRIMARY_PHE_SUBJECTS = new Set(["PHE PYP", "EY PE", "EY2PE"]);
const SECONDARY_PHE_SUBJECTS = new Set(["PHE Girls", "PHE Boys"]);
const isPheSubject = (source: SourceName, subject: string): boolean =>
  (source === "primary" ? PRIMARY_PHE_SUBJECTS : SECONDARY_PHE_SUBJECTS).has(subject);

interface SourcePaths {
  primary: string;
  secondary: string;
  spaces: string | null;
  allocations: string | null;
  output: string;
}

/** Normalized allocation used to place PHE events, regardless of where it was read from. */
interface IngestAssignment {
  cohort: string;
  term: TermId;
  activity: string;
  facilityId: FacilityId | null;
  teachers: string[];
}

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

function parseArgs(argv: string[]): SourcePaths {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error("Arguments must use --primary <file> --secondary <file> [--spaces <file>] [--allocations <file.csv>] [--output <file>].");
    }
    values.set(flag.slice(2), value);
  }

  for (const required of ["primary", "secondary"]) {
    if (!values.has(required)) {
      throw new Error(`Missing required --${required} argument.`);
    }
  }

  return {
    primary: resolve(values.get("primary")!),
    secondary: resolve(values.get("secondary")!),
    spaces: values.has("spaces") ? resolve(values.get("spaces")!) : null,
    allocations: values.has("allocations") ? resolve(values.get("allocations")!) : null,
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

async function readWorkbookAssignments(path: string, warnings: DataWarning[]): Promise<Map<string, IngestAssignment>> {
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

  const assignments = new Map<string, IngestAssignment>();
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
        facilityId,
        teachers: teacherList(teacherLabel),
      });
    }
  }
  return assignments;
}

/** Reuse the allocations already baked into an existing snapshot when no workbook is supplied. */
async function readSnapshotAssignments(path: string): Promise<Map<string, IngestAssignment>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`No --spaces workbook was given and no existing snapshot was found at ${path} to reuse allocations from.`);
  }
  const snapshot = JSON.parse(text) as SimulationDataset;
  const assignments = new Map<string, IngestAssignment>();
  for (const assignment of snapshot.assignments ?? []) {
    assignments.set(`${assignment.cohort}|${assignment.term}`, {
      cohort: assignment.cohort,
      term: assignment.term,
      activity: assignment.activity,
      facilityId: assignment.facilityId,
      teachers: [...assignment.teachers],
    });
  }
  if (assignments.size === 0) throw new Error(`Existing snapshot ${path} has no allocations to reuse. Supply --spaces or --allocations.`);
  return assignments;
}

/** Minimal CSV row parser (handles quoted fields with embedded commas/quotes). */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (character === '"') {
      if (quoted && normalized[index + 1] === '"') { field += '"'; index += 1; } else { quoted = !quoted; }
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && normalized[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

/** Read allocations from a CSV using the same columns as the in-app allocation template. */
async function readCsvAssignments(path: string): Promise<Map<string, IngestAssignment>> {
  const rows = parseCsvRows(await readFile(path, "utf8"));
  if (rows.length < 2) throw new Error("Allocation CSV has no assignment rows.");
  const headers = rows[0]!.map((header) => header.trim().toLowerCase());
  const indexOf = (column: string) => headers.indexOf(column);
  for (const required of ["cohort", "term", "activity", "facility"]) {
    if (indexOf(required) === -1) throw new Error(`Allocation CSV is missing the '${required}' column.`);
  }
  const teachersIndex = indexOf("teachers");
  const assignments = new Map<string, IngestAssignment>();
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]!;
    const cohort = row[indexOf("cohort")] ?? "";
    const termValue = row[indexOf("term")] ?? "";
    const activity = row[indexOf("activity")] ?? "";
    const facilityValue = row[indexOf("facility")] ?? "";
    if (!cohort || !termValue || !activity || !facilityValue) throw new Error(`Allocation CSV row ${index + 1} has a blank required value.`);
    if (!TERMS.includes(termValue as TermId)) throw new Error(`Allocation CSV row ${index + 1} has invalid term '${termValue}'.`);
    const facilityId = normalizeWorkbookFacility(facilityValue, cohort);
    if (!facilityId) throw new Error(`Allocation CSV row ${index + 1} uses unknown facility '${facilityValue}'.`);
    const teachersValue = teachersIndex === -1 ? "" : row[teachersIndex] ?? "";
    assignments.set(`${cohort}|${termValue}`, {
      cohort,
      term: termValue as TermId,
      activity,
      facilityId,
      teachers: teachersValue.split(/\s*[;/]\s*/).map((teacher) => teacher.trim()).filter(Boolean),
    });
  }
  return assignments;
}

function mapById(section: any, childName: string): Map<string, any> {
  return new Map(arrayify(section?.[childName]).map((item: any) => [String(item.id), item]));
}

/** Period ids hosting a lunch subject (e.g. "Lunch PYP" at P8 for Grades 1–5). */
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

function teacherNames(context: XmlContext, ids: unknown): string[] {
  return splitIds(ids).map((id) => String(context.teachers.get(id)?.name ?? id));
}

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
  return [...context.periods.entries()].map(([period, definition]) => {
    const lunch = context.lunchPeriods.has(period);
    return {
      source,
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
  assignments: Map<string, IngestAssignment>,
  warnings: DataWarning[],
  events: OccupancyEvent[],
): void {
  for (const lesson of arrayify<any>(context.root.lessons?.lesson)) {
    const subject = String(context.subjects.get(String(lesson.subjectid))?.name ?? "");
    if (!isPheSubject(context.source, subject)) continue;

    const classes = classNames(context, lesson.classids);
    const groups = groupNames(context, lesson.groupids);
    const cohorts = context.source === "primary"
      ? primaryCohorts(classes, groups)
      : [secondaryCohort(subject, classes)].filter(Boolean) as string[];
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
              teachers: assignment.teachers.length > 0 ? assignment.teachers : xmlTeachers,
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
    if (isPheSubject(context.source, subject)) continue;
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
  const [primary, secondary] = await Promise.all([
    parseXml(paths.primary, "primary"),
    parseXml(paths.secondary, "secondary"),
  ]);
  // Allocations come from the workbook when supplied, otherwise from an --allocations CSV, and
  // failing both from the existing snapshot — so a new timetable XML can be re-baked on its own.
  const assignments = paths.spaces
    ? await readWorkbookAssignments(paths.spaces, warnings)
    : paths.allocations
      ? await readCsvAssignments(paths.allocations)
      : await readSnapshotAssignments(paths.output);

  const events: OccupancyEvent[] = [];
  addPheEvents(primary, assignments, warnings, events);
  addPheEvents(secondary, assignments, warnings, events);
  addExistingBookings(primary, events);
  addExistingBookings(secondary, events);

  const sourceFiles = [paths.primary, paths.secondary, ...(paths.spaces ? [paths.spaces] : []), ...(paths.allocations ? [paths.allocations] : [])];
  const sources = await Promise.all(
    sourceFiles.map(async (path) => ({ name: basename(path), sha256: await sha256(path) })),
  );

  const dataset: SimulationDataset = {
    metadata: {
      generatedAt: new Date().toISOString(),
      academicYear: "2026/27",
      sources,
      privacy: "Sanitized: no student records, names, emails, mobile numbers, or student IDs are retained.",
    },
    facilities: FACILITIES,
    staff: pheStaff([primary, secondary]),
    assignments: [...assignments.values()].map((assignment) => ({
      cohort: assignment.cohort,
      term: assignment.term,
      activity: assignment.activity,
      teachers: assignment.teachers,
      facilityId: assignment.facilityId,
    })),
    periods: [...timetablePeriods(primary), ...timetablePeriods(secondary)],
    events: dedupeEvents(events).sort((left, right) => left.term.localeCompare(right.term) || left.day - right.day || left.start - right.start),
    warnings,
  };

  const serialized = `${JSON.stringify(dataset, null, 2)}\n`;
  await mkdir(dirname(paths.output), { recursive: true });
  await writeFile(paths.output, serialized, "utf8");

  // When writing the default bundled snapshot, also publish a served copy that the app (and any
  // sibling apps) can fetch at runtime from `<base>/snapshot.json`.
  if (paths.output === resolve("src/data/snapshot.json")) {
    const servedPath = resolve("public/snapshot.json");
    await mkdir(dirname(servedPath), { recursive: true });
    await writeFile(servedPath, serialized, "utf8");
    console.log(`Published served copy ${servedPath}`);
  }
  const allocationSource = paths.spaces
    ? `workbook ${basename(paths.spaces)}`
    : paths.allocations
      ? `CSV ${basename(paths.allocations)}`
      : `reused from ${basename(paths.output)}`;
  console.log(`Generated ${paths.output}`);
  console.log(`${dataset.events.length} sanitized events; ${dataset.warnings.length} data warnings.`);
  console.log(`Allocations: ${allocationSource}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
