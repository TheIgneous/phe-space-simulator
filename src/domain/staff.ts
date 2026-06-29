import type { StaffMember } from "../types";

const STAFF_ALIASES: Record<string, string> = {
  "aimee": "Aimee Langton",
  "anna": "Anna Ward",
  "anna w": "Anna Ward",
  "ben j": "Benjamin Jenkins",
  "ben w": "Ben Willgoss",
  "charlotte": "Charlotte Picknell",
  "claire butler": "Claire Butler",
  "miles": "Miles Dibsdall",
  "stephen": "Stephen Whitley",
};

export function normalizeStaffNames(names: string[]): string[] {
  return [...new Set(names
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && name.toLowerCase() !== "new phe")
    .map((name) => STAFF_ALIASES[name.toLowerCase()] ?? name))];
}

export function mergeStaffMembers(staff: StaffMember[], selectedNames: string[]): StaffMember[] {
  const byName = new Map(staff.map((member) => [member.name, member]));
  for (const name of normalizeStaffNames(selectedNames)) {
    if (!byName.has(name)) {
      byName.set(name, { id: `assignment-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name });
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
