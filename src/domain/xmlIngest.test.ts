import rawDataset from "../data/snapshot.json";
import type { OccupancyEvent, SimulationDataset } from "../types";
import { dedupeEvents, regenerateFromTimetables } from "./xmlIngest";

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

  it("routes EY PE / EY2PE lessons to the Minis/EY cohorts (not the EY Gym as an existing booking)", () => {
    const primary = `<?xml version="1.0"?>
      <timetable>
        <periods><period><period>1</period><short>1</short><starttime>08:00</starttime><endtime>08:40</endtime></period></periods>
        <subjects>
          <subject><id>s1</id><name>EY PE</name></subject>
          <subject><id>s2</id><name>EY2PE</name></subject>
        </subjects>
        <teachers><teacher><id>t1</id><name>Test Teacher</name></teacher></teachers>
        <classrooms><classroom><id>r1</id><name>EY GYM</name></classroom></classrooms>
        <classes>
          <class><id>c1</id><name>Mini Falcons NB</name></class>
          <class><id>c2</id><name>EY2KW Wadi</name></class>
        </classes>
        <groups></groups>
        <lessons>
          <lesson><id>l1</id><subjectid>s1</subjectid><classids>c1</classids><teacherids>t1</teacherids><classroomids>r1</classroomids></lesson>
          <lesson><id>l2</id><subjectid>s2</subjectid><classids>c2</classids><teacherids>t1</teacherids><classroomids>r1</classroomids></lesson>
        </lessons>
        <cards>
          <card><lessonid>l1</lessonid><period>1</period><days>10000</days><weeks>10</weeks><terms>100000</terms></card>
          <card><lessonid>l2</lessonid><period>1</period><days>10000</days><weeks>10</weeks><terms>100000</terms></card>
        </cards>
      </timetable>`;

    const regenerated = regenerateFromTimetables(
      rawDataset as SimulationDataset,
      { name: "primary.xml", text: primary, sha256: "p" },
      { name: "secondary.xml", text: timetableXml("secondary"), sha256: "s" },
    );

    const minis = regenerated.events.find((event) => event.cohort === "Minis");
    const ey2 = regenerated.events.find((event) => event.cohort === "EY2");
    expect(minis?.kind).toBe("PHE");
    expect(ey2?.kind).toBe("PHE");
    // Their facility is taken from the allocation (ey-gym in T1a), never an "existing booking".
    expect(minis?.facilityId).toBe("ey-gym");
    expect(regenerated.events.some((event) => event.kind === "existing-booking")).toBe(false);
  });

  it("labels the PYP lunch period (P8) as Lunch", () => {
    const primary = `<?xml version="1.0"?>
      <timetable>
        <periods>
          <period><period>1</period><short>1</short><starttime>08:00</starttime><endtime>08:40</endtime></period>
          <period><period>8</period><short>8</short><starttime>13:00</starttime><endtime>13:30</endtime></period>
        </periods>
        <subjects>
          <subject><id>s1</id><name>PHE PYP</name></subject>
          <subject><id>s2</id><name>Lunch PYP</name></subject>
        </subjects>
        <teachers><teacher><id>t1</id><name>Test Teacher</name></teacher></teachers>
        <classrooms></classrooms>
        <classes><class><id>c1</id><name>2A</name></class></classes>
        <groups></groups>
        <lessons>
          <lesson><id>l1</id><subjectid>s1</subjectid><classids>c1</classids><teacherids>t1</teacherids></lesson>
          <lesson><id>l2</id><subjectid>s2</subjectid><classids>c1</classids></lesson>
        </lessons>
        <cards>
          <card><lessonid>l1</lessonid><period>1</period><days>10000</days><weeks>10</weeks><terms>100000</terms></card>
          <card><lessonid>l2</lessonid><period>8</period><days>10000</days><weeks>10</weeks><terms>100000</terms></card>
        </cards>
      </timetable>`;

    const regenerated = regenerateFromTimetables(
      rawDataset as SimulationDataset,
      { name: "primary.xml", text: primary, sha256: "p" },
      { name: "secondary.xml", text: timetableXml("secondary"), sha256: "s" },
    );
    const lunch = regenerated.periods.find((period) => period.source === "PYP" && period.start === 13 * 60);
    expect(lunch?.lunch).toBe(true);
    expect(lunch?.label).toBe("Lunch");
  });
});

describe("dedupeEvents", () => {
  const base: OccupancyEvent = {
    id: "a", source: "primary", phase: "Primary", term: "T1a", weeks: ["A", "B"], day: 0,
    start: 480, end: 520, facilityId: "primary-gym-1", cohort: "Grade 2 Boys", classes: ["2NB"],
    activity: "Gymnastics", teachers: ["Anna Ward"], kind: "PHE",
  };

  it("merges identical occupancies and unions their class lists and teachers", () => {
    const merged = dedupeEvents([
      base,
      { ...base, id: "b", classes: ["2SR"], teachers: ["Ben Willgoss"] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.classes).toEqual(["2NB", "2SR"]);
    expect(merged[0]!.teachers).toEqual(["Anna Ward", "Ben Willgoss"]);
  });

  it("keeps occupancies that differ by space, time, cohort or week separate", () => {
    const merged = dedupeEvents([
      base,
      { ...base, id: "b", facilityId: "primary-gym-2" },
      { ...base, id: "c", cohort: "Grade 2 Girls" },
      { ...base, id: "d", weeks: ["A"] },
    ]);
    expect(merged).toHaveLength(4);
  });
});
