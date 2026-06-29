/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { XMLParser } from "fast-xml-parser";
import {
  candidateStartSlots,
  createGenerationGrid,
  durationToSlots,
  minutesToSlot,
  relationshipConversion,
} from "../src/domain/generation-grid.ts";

interface Arguments {
  secondary: string;
  relationships: string;
  output: string;
}

const arrayify = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

function parseArgs(argv: string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error("Use --secondary <xml> --relationships <har> [--output <json>].");
    }
    values.set(flag.slice(2), value);
  }
  if (!values.has("secondary") || !values.has("relationships")) {
    throw new Error("Both --secondary and --relationships are required.");
  }
  return {
    secondary: resolve(values.get("secondary")!),
    relationships: resolve(values.get("relationships")!),
    output: resolve(values.get("output") ?? "src/data/generation-model.json"),
  };
}

function splitIds(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseTime(value: unknown): number {
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid timetable time '${String(value)}'.`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function activeIndexes(mask: unknown, length: number): number[] {
  const text = String(mask ?? "");
  if (!text || text === "1") return Array.from({ length }, (_, index) => index);
  const active = new Set<number>();
  for (const variant of text.split(",")) {
    [...variant].forEach((character, index) => {
      if (character === "1" && index < length) active.add(index);
    });
  }
  return [...active];
}

function byId(rows: any[]): Map<string, any> {
  return new Map(rows.map((row) => [String(row.id), row]));
}

function names(ids: unknown, rows: Map<string, any>): string[] {
  return splitIds(ids).map((id) => String(rows.get(id)?.name ?? rows.get(id)?.short ?? id));
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function findBaselineRelationshipPayload(har: any): { payload: any; capturedAt: string; excludedMutations: any[] } {
  const entries = arrayify<any>(har?.log?.entries).sort((left, right) =>
    String(left.startedDateTime).localeCompare(String(right.startedDateTime)),
  );
  const mutations: any[] = [];
  let baseline: { payload: any; capturedAt: string } | null = null;

  for (const entry of entries) {
    if (!String(entry.request?.url ?? "").includes("ttdoc.js")) continue;
    let request: any;
    let response: any;
    try {
      request = JSON.parse(String(entry.request?.postData?.text ?? "{}"));
      response = JSON.parse(String(entry.response?.content?.text ?? "{}"));
    } catch {
      continue;
    }
    const operation = request?.__args?.[2]?.op;
    const table = arrayify<any>(response?.r?.tables).find((candidate) => candidate.id === "cardrelationships");
    if (operation === "fetch" && table && baseline === null) {
      baseline = { payload: response, capturedAt: String(entry.startedDateTime) };
    } else if (operation && operation !== "fetch") {
      mutations.push({
        capturedAt: String(entry.startedDateTime),
        operation,
        table: request?.__args?.[2]?.data?.table ?? "unknown",
        returnedIds: arrayify<string>(response?.r?.data),
      });
    }
  }

  if (!baseline) throw new Error("The HAR does not contain a baseline cardrelationships fetch.");
  return { ...baseline, excludedMutations: mutations };
}

async function main(): Promise<void> {
  const paths = parseArgs(process.argv.slice(2));
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseAttributeValue: false });
  const [xmlText, harText] = await Promise.all([
    readFile(paths.secondary, "utf8"),
    readFile(paths.relationships, "utf8"),
  ]);
  const root = parser.parse(xmlText).timetable;
  const har = JSON.parse(harText);
  const { payload: relationshipPayload, capturedAt, excludedMutations } = findBaselineRelationshipPayload(har);

  const periodRows = arrayify<any>(root.periods?.period);
  const breakRows = arrayify<any>(root.breaks?.break);
  const dayStart = Math.min(...periodRows.map((period) => parseTime(period.starttime)));
  const dayEnd = Math.max(...periodRows.map((period) => parseTime(period.endtime)));
  const grid = createGenerationGrid(dayStart, dayEnd);
  const periods = periodRows.map((period) => {
    const start = parseTime(period.starttime);
    const end = parseTime(period.endtime);
    return {
      id: String(period.period),
      label: String(period.short ?? period.name ?? period.period),
      start,
      end,
      startSlot: minutesToSlot(start, grid),
      endSlot: minutesToSlot(end, grid),
      durationSlots: durationToSlots(end - start, grid),
    };
  });
  const periodById = new Map(periods.map((period) => [period.id, period]));
  const breaks = breakRows.map((item) => ({
    label: String(item.short ?? item.name ?? "Break"),
    start: parseTime(item.starttime),
    end: parseTime(item.endtime),
  }));

  const subjects = byId(arrayify<any>(root.subjects?.subject));
  const classes = byId(arrayify<any>(root.classes?.class));
  const teachers = byId(arrayify<any>(root.teachers?.teacher));
  const classrooms = byId(arrayify<any>(root.classrooms?.classroom));
  const cardsByLesson = new Map<string, any[]>();
  for (const card of arrayify<any>(root.cards?.card)) {
    const lessonCards = cardsByLesson.get(String(card.lessonid)) ?? [];
    lessonCards.push(card);
    cardsByLesson.set(String(card.lessonid), lessonCards);
  }

  const lessons = arrayify<any>(root.lessons?.lesson).map((lesson) => {
    const cards = cardsByLesson.get(String(lesson.id)) ?? [];
    const periodsPerCard = Number(lesson.periodspercard ?? 1);
    return {
      id: String(lesson.id),
      subject: names(lesson.subjectid, subjects)[0] ?? String(lesson.subjectid),
      classes: names(lesson.classids, classes),
      teachers: names(lesson.teacherids, teachers),
      preferredClassrooms: names(lesson.classroomids, classrooms),
      periodsPerWeek: Number(lesson.periodsperweek ?? cards.length),
      durationSlots: 6 * periodsPerCard,
      placements: cards.map((card, cardIndex) => {
        const period = periodById.get(String(card.period));
        if (!period) throw new Error(`Card for lesson ${String(lesson.id)} uses unknown period ${String(card.period)}.`);
        return {
          id: `${String(lesson.id)}-${cardIndex}`,
          dayIndexes: activeIndexes(card.days, 5),
          weekIndexes: activeIndexes(card.weeks, 2),
          termIndexes: activeIndexes(card.terms, 6),
          startSlot: period.startSlot,
          durationSlots: period.durationSlots * periodsPerCard,
          classroomOverrides: names(card.classroomids, classrooms),
        };
      }),
    };
  });

  const relationshipTables = new Map(
    arrayify<any>(relationshipPayload?.r?.tables).map((table) => [String(table.id), table]),
  );
  const relationTable = relationshipTables.get("cardrelationships");
  if (!relationTable) throw new Error("Baseline HAR fetch has no cardrelationships table.");
  const relationSubjects = byId(arrayify<any>(relationshipTables.get("subjects")?.data_rows));
  const relationClasses = byId(arrayify<any>(relationshipTables.get("classes")?.data_rows));
  const typeLabels = new Map<string, string>();
  for (const combo of arrayify<any>(relationTable.combos)) {
    if (combo.column !== "typ") continue;
    for (const option of arrayify<any>(combo.db)) typeLabels.set(String(option.id), String(option.name));
  }
  const relationships = arrayify<any>(relationTable.data_rows).map((relation) => ({
    id: String(relation.id),
    type: String(relation.typ),
    typeLabel: typeLabels.get(String(relation.typ)) ?? "Unknown relationship",
    importance: String(relation.importance ?? "normal"),
    disabled: Boolean(relation.disabled),
    conversion: relationshipConversion(String(relation.typ), Boolean(relation.disabled)),
    note: String(relation.note ?? ""),
    subjects: arrayify<string>(relation.subjectids).map((id) => String(relationSubjects.get(id)?.name ?? id)).filter(Boolean),
    classes: arrayify<string>(relation.classids).map((id) => String(relationClasses.get(id)?.name ?? id)).filter(Boolean),
    subject2: arrayify<string>(relation.subject2ids).map((id) => String(relationSubjects.get(id)?.name ?? id)).filter(Boolean),
    class2: arrayify<string>(relation.class2ids).map((id) => String(relationClasses.get(id)?.name ?? id)).filter(Boolean),
    param1: Number(relation.param1 ?? 0),
    param2: Number(relation.param2 ?? 0),
  }));

  const model = {
    metadata: {
      generatedAt: new Date().toISOString(),
      privacy: "Sanitized: HAR cookies, headers, users, and student data are not retained.",
      sources: await Promise.all([paths.secondary, paths.relationships].map(async (path) => ({
        name: basename(path),
        sha256: await sha256(path),
      }))),
      relationshipBaselineCapturedAt: capturedAt,
      excludedHarMutations: excludedMutations,
    },
    grid,
    phaseRules: {
      secondary: {
        nominalLessonMinutes: 60,
        minimumDurationSlots: 6,
        legacyStartSlots: periods.map((period) => period.startSlot),
        candidateStartSlots: candidateStartSlots(grid, 6, breaks),
      },
      primary: {
        nominalLessonMinutes: 40,
        minimumDurationSlots: 4,
        status: "Awaiting the current-year Primary timetable and its relationship export.",
      },
    },
    breaks,
    periods,
    secondary: {
      lessons,
      lessonCount: lessons.length,
      placementCount: lessons.reduce((total, lesson) => total + lesson.placements.length, 0),
    },
    relationships: {
      count: relationships.length,
      rows: relationships,
    },
  };

  await mkdir(dirname(paths.output), { recursive: true });
  await writeFile(paths.output, `${JSON.stringify(model, null, 2)}\n`, "utf8");
  console.log(`Generated ${paths.output}`);
  console.log(`${lessons.length} Secondary lessons, ${model.secondary.placementCount} placements, ${relationships.length} baseline relationships.`);
  console.log(`${excludedMutations.length} HAR mutation(s) excluded from the baseline.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
