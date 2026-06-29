/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { XMLParser } from "fast-xml-parser";
import { FACILITY_BY_ID, relocationPoolFor } from "../src/domain/facilities.ts";
import { DAYS, TERMS, type DayIndex, type PheAssignment, type SimulationDataset, type TermId, type WeekId } from "../src/types.ts";

type SourceName = "primary" | "secondary";

interface Arguments {
  primary: string;
  secondary: string;
  snapshot: string;
  output: string;
}

interface XmlContext {
  source: SourceName;
  root: any;
  periods: Map<string, any>;
  subjects: Map<string, any>;
  teachers: Map<string, any>;
  classrooms: Map<string, any>;
  classes: Map<string, any>;
  groups: Map<string, any>;
  cardsByLesson: Map<string, any[]>;
}

interface ExportRow {
  allocation_id: string;
  term: TermId;
  phase: "Primary" | "Secondary";
  subject: string;
  xml_lesson_id: string;
  xml_card_index: string;
  day: string;
  period: string;
  start_time: string;
  end_time: string;
  week_pattern: string;
  class_names: string;
  class_group_pairs: string;
  canonical_group: string;
  allocation_cohort: string;
  xml_teacher_names: string;
  planned_lead_teacher: string;
  support_teachers: string;
  required_teacher_presence: string;
  staffing_status: "confirmed_xml" | "confirmed_override" | "confirmed_conditional_support";
  xml_room: string;
  activity: string;
  planned_facility: string;
  space_units: string;
  alternative_facilities: string;
  mapping_status: "confirmed" | "unresolved_group" | "missing_allocation";
  notes: string;
}

const HEADERS: Array<keyof ExportRow> = [
  "allocation_id",
  "term",
  "phase",
  "subject",
  "xml_lesson_id",
  "xml_card_index",
  "day",
  "period",
  "start_time",
  "end_time",
  "week_pattern",
  "class_names",
  "class_group_pairs",
  "canonical_group",
  "allocation_cohort",
  "xml_teacher_names",
  "planned_lead_teacher",
  "support_teachers",
  "required_teacher_presence",
  "staffing_status",
  "xml_room",
  "activity",
  "planned_facility",
  "space_units",
  "alternative_facilities",
  "mapping_status",
  "notes",
];

const arrayify = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const splitIds = (value: unknown): string[] => String(value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
const csvCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;

function parseArgs(argv: string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("Use --primary, --secondary, --snapshot and --output arguments.");
    values.set(flag.slice(2), value);
  }
  for (const key of ["primary", "secondary", "output"]) {
    if (!values.has(key)) throw new Error(`Missing --${key} argument.`);
  }
  return {
    primary: resolve(values.get("primary")!),
    secondary: resolve(values.get("secondary")!),
    snapshot: resolve(values.get("snapshot") ?? "src/data/snapshot.json"),
    output: resolve(values.get("output")!),
  };
}

function mapById(section: any, childName: string): Map<string, any> {
  return new Map(arrayify(section?.[childName]).map((item: any) => [String(item.id), item]));
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

function termsFromMask(mask: unknown): TermId[] {
  const indexes = activeIndexes(String(mask ?? ""), TERMS.length);
  return indexes.length === 0 ? [...TERMS] : indexes.map((index) => TERMS[index]!).filter(Boolean);
}

function weeksFromMask(mask: unknown): WeekId[] {
  const indexes = activeIndexes(String(mask ?? ""), 2);
  return indexes.length === 0 ? ["A", "B"] : indexes.map((index) => (index === 0 ? "A" : "B"));
}

function daysFromMask(mask: unknown): DayIndex[] {
  return activeIndexes(String(mask ?? ""), 5).filter((index): index is DayIndex => index >= 0 && index <= 4);
}

function normalizeTime(value: unknown): string {
  const [hours, minutes] = String(value ?? "").split(":");
  return `${String(hours).padStart(2, "0")}:${String(minutes ?? "00").padStart(2, "0")}`;
}

async function parseXml(path: string, source: SourceName): Promise<XmlContext> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseAttributeValue: false });
  const root = parser.parse(await readFile(path, "utf8"))?.timetable;
  if (!root) throw new Error(`${source} XML is not a supported timetable export.`);
  const cardsByLesson = new Map<string, any[]>();
  for (const card of arrayify<any>(root.cards?.card)) {
    const key = String(card.lessonid);
    cardsByLesson.set(key, [...(cardsByLesson.get(key) ?? []), card]);
  }
  return {
    source,
    root,
    periods: new Map(arrayify<any>(root.periods?.period).map((item) => [String(item.period), item])),
    subjects: mapById(root.subjects, "subject"),
    teachers: mapById(root.teachers, "teacher"),
    classrooms: mapById(root.classrooms, "classroom"),
    classes: mapById(root.classes, "class"),
    groups: mapById(root.groups, "group"),
    cardsByLesson,
  };
}

function groupDetails(context: XmlContext, lesson: any, classIds: string[]): { pairs: string[]; canonical: string; unresolved: boolean } {
  const groups = splitIds(lesson.groupids).map((id) => context.groups.get(id)).filter(Boolean);
  const pairs = classIds.map((classId) => {
    const className = String(context.classes.get(classId)?.name ?? classId);
    const label = String(groups.find((group) => String(group.classid) === classId)?.name ?? "Entire class");
    return `${className}:${label}`;
  });
  const labels = [...new Set(pairs.map((pair) => pair.slice(pair.indexOf(":") + 1)))];
  const canonical = labels.length === 1 ? labels[0]! : labels.join(" + ");
  return { pairs, canonical, unresolved: !["Boys", "Girls", "Entire class"].includes(canonical) };
}

function allocationCohort(source: SourceName, subject: string, classNames: string[], canonicalGroup: string): string {
  const first = classNames[0] ?? "";
  if (source === "secondary") {
    const grade = first.match(/^(6|7|8|9|10)/)?.[1];
    const gender = subject === "PHE Girls" ? "Girls" : subject === "PHE Boys" ? "Boys" : "";
    return grade && gender ? `${grade} ${gender}` : "";
  }
  if (/^Mini\b/i.test(first)) return "Minis";
  if (/^EY1/i.test(first)) return "EY1";
  if (/^EY2/i.test(first)) return "EY2";
  const grade = first.match(/^([1-5])/)?.[1];
  if (grade === "1") return "Grade 1";
  if (grade && (canonicalGroup === "Boys" || canonicalGroup === "Girls")) return `Grade ${grade} ${canonicalGroup}`;
  return "";
}

function roomForCard(context: XmlContext, lesson: any, card: any): string {
  const cardRoomIds = splitIds(card.classroomids);
  const lessonRoomIds = splitIds(lesson.classroomids);
  const roomIds = cardRoomIds.length > 0 ? cardRoomIds : lessonRoomIds.length === 1 ? lessonRoomIds : [];
  return roomIds.map((id) => String(context.classrooms.get(id)?.name ?? id)).join(" | ");
}

function alternativesFor(assignment: PheAssignment | undefined): string {
  if (!assignment?.facilityId) return "";
  const pool = relocationPoolFor(assignment.facilityId);
  return pool
    ?.filter((id) => id !== assignment.facilityId)
    .map((id) => FACILITY_BY_ID.get(id)?.name ?? id)
    .join(" | ") ?? "";
}

function staffingFor(term: TermId, phase: "Primary" | "Secondary", classNames: string[], canonicalGroup: string, xmlTeachers: string[]): {
  lead: string;
  support: string;
  requiredPresence: string;
  status: ExportRow["staffing_status"];
  note: string;
} {
  const isFiveLbCmGirls = phase === "Primary" && classNames.join(" | ") === "5LB | 5CM" && canonicalGroup === "Girls";
  if (isFiveLbCmGirls && term === "T3a") {
    return {
      lead: "",
      support: "Ben Willgoss",
      requiredPresence: "Girls-role teacher present in the same session",
      status: "confirmed_conditional_support",
      note: "Ben Willgoss may support 5LB/5CM Girls while the Boys group is swimming, provided another Girls-role teacher is present.",
    };
  }
  if (isFiveLbCmGirls && term === "T3b") {
    return {
      lead: "Anna Ward",
      support: "",
      requiredPresence: "",
      status: "confirmed_override",
      note: "Anna Ward is the confirmed Girls lead while 5LB/5CM Girls are swimming; the XML lists Ben Willgoss.",
    };
  }
  return {
    lead: xmlTeachers.join(" | "),
    support: "",
    requiredPresence: "",
    status: "confirmed_xml",
    note: "",
  };
}

function exportContext(context: XmlContext, assignments: Map<string, PheAssignment>): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const lesson of arrayify<any>(context.root.lessons?.lesson)) {
    const subject = String(context.subjects.get(String(lesson.subjectid))?.name ?? "");
    const isPhe = context.source === "primary" ? subject === "PHE PYP" : subject === "PHE Girls" || subject === "PHE Boys";
    if (!isPhe) continue;
    const classIds = splitIds(lesson.classids);
    const classNames = classIds.map((id) => String(context.classes.get(id)?.name ?? id));
    const xmlGroups = groupDetails(context, lesson, classIds);
    const groups = context.source === "secondary"
      ? {
          ...xmlGroups,
          canonical: subject === "PHE Girls" ? "Girls" : "Boys",
          unresolved: false,
        }
      : xmlGroups;
    const cohort = allocationCohort(context.source, subject, classNames, groups.canonical);
    const teacherNames = splitIds(lesson.teacherids).map((id) => String(context.teachers.get(id)?.name ?? id));

    for (const [cardIndex, card] of (context.cardsByLesson.get(String(lesson.id)) ?? []).entries()) {
      const period = context.periods.get(String(card.period));
      if (!period) continue;
      for (const term of termsFromMask(card.terms)) {
        const assignment = assignments.get(`${cohort}|${term}`);
        for (const day of daysFromMask(card.days)) {
          const status = !cohort || groups.unresolved ? "unresolved_group" : assignment?.facilityId ? "confirmed" : "missing_allocation";
          const staffing = staffingFor(term, context.source === "primary" ? "Primary" : "Secondary", classNames, groups.canonical, teacherNames);
          rows.push({
            allocation_id: `${context.source}:${lesson.id}:${cardIndex}:${term}:${day}`,
            term,
            phase: context.source === "primary" ? "Primary" : "Secondary",
            subject,
            xml_lesson_id: String(lesson.id),
            xml_card_index: String(cardIndex),
            day: DAYS[day],
            period: String(card.period),
            start_time: normalizeTime(period.starttime),
            end_time: normalizeTime(period.endtime),
            week_pattern: weeksFromMask(card.weeks).join(" | "),
            class_names: classNames.join(" | "),
            class_group_pairs: groups.pairs.join(" | "),
            canonical_group: groups.canonical,
            allocation_cohort: cohort,
            xml_teacher_names: teacherNames.join(" | "),
            planned_lead_teacher: staffing.lead,
            support_teachers: staffing.support,
            required_teacher_presence: staffing.requiredPresence,
            staffing_status: staffing.status,
            xml_room: roomForCard(context, lesson, card),
            activity: assignment?.activity ?? "",
            planned_facility: assignment?.facilityId ? FACILITY_BY_ID.get(assignment.facilityId)?.name ?? assignment.facilityId : "",
            space_units: "1",
            alternative_facilities: alternativesFor(assignment),
            mapping_status: status,
            notes: [groups.unresolved ? "Confirm how this XML group maps to a PHE allocation cohort." : "", staffing.note].filter(Boolean).join(" "),
          });
        }
      }
    }
  }
  return rows;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [primary, secondary, snapshotText] = await Promise.all([
    parseXml(args.primary, "primary"),
    parseXml(args.secondary, "secondary"),
    readFile(args.snapshot, "utf8"),
  ]);
  const dataset = JSON.parse(snapshotText) as SimulationDataset;
  const assignments = new Map(dataset.assignments.map((assignment) => [`${assignment.cohort}|${assignment.term}`, assignment]));
  const rows = [...exportContext(primary, assignments), ...exportContext(secondary, assignments)].sort(
    (left, right) => left.term.localeCompare(right.term) || left.phase.localeCompare(right.phase) || left.day.localeCompare(right.day) || left.start_time.localeCompare(right.start_time),
  );
  const csv = [
    HEADERS.join(","),
    ...rows.map((row) => HEADERS.map((header) => csvCell(row[header])).join(",")),
  ].join("\r\n");
  await writeFile(args.output, `${csv}\r\n`, "utf8");
  const unresolved = rows.filter((row) => row.mapping_status !== "confirmed").length;
  console.log(`Generated ${args.output}`);
  console.log(`${rows.length} XML-aligned allocation rows; ${unresolved} rows need mapping review.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
