import { FACILITY_BY_ID, normalizeWorkbookFacility } from "./facilities";
import { TERMS, type PheAssignment, type SimulationDataset, type TermId } from "../types";

const REQUIRED_COLUMNS = ["cohort", "term", "activity", "facility"] as const;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("Allocation CSV contains an unclosed quoted field.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const csvCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;
const assignmentKey = (cohort: string, term: TermId): string => `${cohort}|${term}`;

/** Serialize a plan (one row per cohort × term) to the ingest CSV format. */
export function assignmentsToCsv(assignments: PheAssignment[]): string {
  const byKey = new Map(assignments.map((assignment) => [assignmentKey(assignment.cohort, assignment.term), assignment]));
  const cohorts = [...new Set(assignments.map((assignment) => assignment.cohort))].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const rows = ["cohort,term,activity,facility,teachers"];
  for (const cohort of cohorts) {
    for (const term of TERMS) {
      const assignment = byKey.get(assignmentKey(cohort, term));
      const facility = assignment?.facilityId ? FACILITY_BY_ID.get(assignment.facilityId)?.name ?? assignment.facilityId : "";
      rows.push([
        cohort,
        term,
        assignment?.activity ?? "",
        facility,
        assignment?.teachers.join(" / ") ?? "",
      ].map(csvCell).join(","));
    }
  }
  return `${rows.join("\r\n")}\r\n`;
}

export function allocationTemplateCsv(dataset: SimulationDataset): string {
  return assignmentsToCsv(dataset.assignments);
}

export function applyAllocationCsv(
  current: SimulationDataset,
  csvText: string,
  source: { name: string; sha256: string },
): SimulationDataset {
  const rows = parseCsv(csvText.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("Allocation CSV has no assignment rows.");
  const headers = rows[0]!.map((header) => header.trim().toLowerCase());
  const indexes = new Map(headers.map((header, index) => [header, index]));
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !indexes.has(column));
  if (missingColumns.length > 0) throw new Error(`Allocation CSV is missing column${missingColumns.length === 1 ? "" : "s"}: ${missingColumns.join(", ")}.`);

  const assignments: PheAssignment[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]!;
    const line = index + 1;
    const cohort = row[indexes.get("cohort")!] ?? "";
    const termValue = row[indexes.get("term")!] ?? "";
    const activity = row[indexes.get("activity")!] ?? "";
    const facilityValue = row[indexes.get("facility")!] ?? "";
    const teachersValue = indexes.has("teachers") ? row[indexes.get("teachers")!] ?? "" : "";
    if (!cohort || !termValue || !activity || !facilityValue) throw new Error(`Allocation CSV row ${line} has a blank required value.`);
    if (!TERMS.includes(termValue as TermId)) throw new Error(`Allocation CSV row ${line} has invalid term '${termValue}'.`);
    const term = termValue as TermId;
    const key = assignmentKey(cohort, term);
    if (seen.has(key)) throw new Error(`Allocation CSV contains duplicate assignment '${cohort}' / ${term}.`);
    const facilityId = normalizeWorkbookFacility(facilityValue, cohort);
    if (!facilityId) throw new Error(`Allocation CSV row ${line} uses unknown facility '${facilityValue}'.`);
    seen.add(key);
    assignments.push({
      cohort,
      term,
      activity,
      facilityId,
      teachers: teachersValue.split(/\s*[;/]\s*/).map((teacher) => teacher.trim()).filter(Boolean),
    });
  }

  const expectedCohorts = [...new Set(current.assignments.map((assignment) => assignment.cohort))];
  const missingAssignments = expectedCohorts.flatMap((cohort) => TERMS.map((term) => assignmentKey(cohort, term))).filter((key) => !seen.has(key));
  if (missingAssignments.length > 0) {
    throw new Error(`Allocation CSV is incomplete: ${missingAssignments.length} cohort/term assignment${missingAssignments.length === 1 ? "" : "s"} missing, including ${missingAssignments.slice(0, 3).join(", ")}.`);
  }

  const byKey = new Map(assignments.map((assignment) => [assignmentKey(assignment.cohort, assignment.term), assignment]));
  return {
    ...current,
    metadata: {
      ...current.metadata,
      generatedAt: new Date().toISOString(),
      sources: [...current.metadata.sources.filter((item) => !/\.(xlsx|csv)$/i.test(item.name)), source],
    },
    assignments,
    events: current.events.map((event) => {
      if (event.kind !== "PHE") return event;
      const assignment = byKey.get(assignmentKey(event.cohort, event.term));
      if (!assignment?.facilityId) return event;
      return {
        ...event,
        facilityId: assignment.facilityId,
        activity: assignment.activity,
        teachers: assignment.teachers.length > 0 ? assignment.teachers : event.teachers,
      };
    }),
    warnings: [],
  };
}

export async function allocationFile(file: File): Promise<{ text: string; source: { name: string; sha256: string } }> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    text: new TextDecoder().decode(bytes),
    source: {
      name: file.name,
      sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    },
  };
}
