import rawDataset from "../data/snapshot.json";
import type { SimulationDataset } from "../types";
import { regenerateFromTimetables } from "./xmlIngest";

function timetableXml(source: "primary" | "secondary") {
  const primary = source === "primary";
  return `<?xml version="1.0"?>
    <timetable>
      <periods><period><period>1</period><short>1</short><starttime>${primary ? "08:00" : "08:10"}</starttime><endtime>${primary ? "08:40" : "09:10"}</endtime></period></periods>
      <subjects><subject><id>s1</id><name>${primary ? "PHE PYP" : "PHE Girls"}</name></subject></subjects>
      <teachers><teacher><id>t1</id><name>Test Teacher</name></teacher></teachers>
      <classrooms></classrooms>
      <classes><class><id>c1</id><name>${primary ? "2A" : "6A"}</name></class></classes>
      <groups></groups>
      <lessons><lesson><id>l1</id><subjectid>s1</subjectid><classids>c1</classids><teacherids>t1</teacherids></lesson></lessons>
      <cards><card><lessonid>l1</lessonid><period>1</period><days>10000</days><weeks>10</weeks><terms>100000</terms></card></cards>
    </timetable>`;
}

describe("browser timetable regeneration", () => {
  it("rebuilds PHE events from both XML files and preserves sanitized assignments", () => {
    const regenerated = regenerateFromTimetables(
      rawDataset as SimulationDataset,
      { name: "new-primary.xml", text: timetableXml("primary"), sha256: "primary-hash" },
      { name: "new-secondary.xml", text: timetableXml("secondary"), sha256: "secondary-hash" },
    );

    expect(regenerated.events.map((event) => event.cohort)).toEqual(["Grade 2 Boys", "Grade 2 Girls", "6 Girls"]);
    expect(regenerated.events.every((event) => event.term === "T1a" && event.weeks.includes("A"))).toBe(true);
    expect(regenerated.periods.map((period) => period.start)).toEqual([480, 490]);
    expect(regenerated.metadata.sources.map((source) => source.name)).toEqual([
      "new-primary.xml",
      "new-secondary.xml",
      "PHE Spaces (1).xlsx",
    ]);
  });

  it("rejects a secondary export with no recognized PHE lessons", () => {
    const invalidSecondary = timetableXml("secondary").replace("PHE Girls", "Mathematics");
    expect(() => regenerateFromTimetables(
      rawDataset as SimulationDataset,
      { name: "primary.xml", text: timetableXml("primary"), sha256: "one" },
      { name: "secondary.xml", text: invalidSecondary, sha256: "two" },
    )).toThrow("Secondary XML contains no recognized Grade 6–10 PHE timetable events");
  });
});
