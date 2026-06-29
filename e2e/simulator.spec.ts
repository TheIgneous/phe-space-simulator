import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("loads the approved simulator and navigates an issue", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("PHE Space Simulator");
  await expect(page.getByRole("heading", { level: 1, name: "PHE Space Simulator" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Term", exact: true })).toHaveValue("T1a");
  await expect(page.getByRole("combobox", { name: "Day", exact: true })).toHaveValue("0");
  await expect(page.getByText("2MZ (Boys) — Gymnastics", { exact: true })).toBeVisible();
  await expect(page.getByText("2MZ (Girls) — Swimming", { exact: true })).toBeVisible();
  await expect(page.getByText("Main + Side Pools may overlap")).toBeVisible();

  await page.getByRole("button", { name: "Next timetable boundary" }).click();
  await expect(page.getByText("08:10", { exact: true }).first()).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("stays usable at tablet width", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/");
  await expect(page.getByLabel("Simulation controls")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Main Sports Hall" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Issues at/ })).toBeVisible();
});

test("edits the allocation plan and tests it against the timetable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "PHE space allocation plan" })).toBeVisible();
  await expect(page.getByLabel("Grade 2 Boys T1a space")).toHaveValue("primary-gym-2");
  await page.getByLabel("Grade 2 Boys T1a space").selectOption("main-pitch-1");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Test plan in simulator" }).click();

  await expect(page.getByRole("combobox", { name: "Term", exact: true })).toHaveValue("T1a");
  await expect(page.getByRole("combobox", { name: "Day", exact: true })).toHaveValue("0");
  await expect(page.getByLabel("Main Pitch 1: 1 / 1").getByText("2MZ (Boys) — Gymnastics")).toBeVisible();
});

test("swaps term blocks and limits staff to XML presets", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Plan", exact: true }).click();

  await expect(page.getByLabel("Grade 1 T1a unit")).toHaveValue("Mixed Swim");
  await page.getByRole("button", { name: "Select Grade 1 T1a block for swap" }).dragTo(page.getByLabel("Grade 1 T1b unit"));
  await expect(page.getByLabel("Grade 1 T1a unit")).toHaveValue("Athletics");
  await expect(page.getByLabel("Grade 1 T1a space")).toHaveValue("primary-gym-1");
  await expect(page.getByLabel("Grade 1 T1b unit")).toHaveValue("Mixed Swim");
  await expect(page.getByLabel("Grade 1 T1b space")).toHaveValue("main-pool");

  await page.getByLabel("Grade 2 Boys staff").click();
  await expect(page.getByRole("checkbox", { name: "Benjamin Jenkins" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Ben Willgoss" })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Grade 2 Boys teachers" })).toHaveCount(0);
});

test("distinguishes workable and non-workable gym clashes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Term", exact: true }).selectOption("T1b");
  await page.getByRole("combobox", { name: "Day", exact: true }).selectOption("1");
  await page.getByRole("slider", { name: "Current simulation time" }).fill("580");
  await expect(page.getByLabel("Primary Gym 2: 2 / 1").getByText("Workable clash")).toBeVisible();
  await expect(page.getByText("Workable — move 1 group to Primary Gym 1 or Secondary Gym 2.")).toBeVisible();

  await page.getByRole("combobox", { name: "Term", exact: true }).selectOption("T3b");
  await expect(page.getByLabel("Primary Gym 1: 2 / 1").getByText("Non-workable clash")).toBeVisible();
  await expect(page.getByText("Non-workable — 2 / 1 occupancy and no confirmed suitable alternative is available.")).toBeVisible();
});

test("regenerates the simulator from primary and secondary XML uploads", async ({ page }) => {
  const timetableXml = (source: "primary" | "secondary") => {
    const primary = source === "primary";
    return `<timetable>
      <periods><period><period>1</period><short>1</short><starttime>08:00</starttime><endtime>${primary ? "08:40" : "09:00"}</endtime></period></periods>
      <subjects><subject><id>s</id><name>${primary ? "PHE PYP" : "PHE Girls"}</name></subject></subjects>
      <teachers><teacher><id>t</id><name>Teacher</name></teacher></teachers>
      <classrooms></classrooms>
      <classes><class><id>c</id><name>${primary ? "2A" : "6A"}</name></class></classes>
      <groups></groups>
      <lessons><lesson><id>l</id><subjectid>s</subjectid><classids>c</classids><teacherids>t</teacherids></lesson></lessons>
      <cards><card><lessonid>l</lessonid><period>1</period><days>10000</days><weeks>10</weeks><terms>100000</terms></card></cards>
    </timetable>`;
  };

  await page.goto("/");
  await page.getByRole("button", { name: "Update model inputs" }).click();
  await page.getByLabel("Primary timetable XML").setInputFiles({
    name: "replacement-primary.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(timetableXml("primary")),
  });
  await page.getByLabel("Secondary timetable XML").setInputFiles({
    name: "replacement-secondary.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(timetableXml("secondary")),
  });
  await page.getByRole("button", { name: "Regenerate simulator" }).click();
  await expect(page.getByRole("dialog", { name: "Update model inputs" })).toBeHidden();
  await expect(page.getByText("replacement-primary.xml", { exact: false })).toBeVisible();
  await expect(page.getByText("replacement-secondary.xml", { exact: false })).toBeVisible();
  await page.getByRole("combobox", { name: "Term", exact: true }).selectOption("T1a");
  await page.getByRole("combobox", { name: "Day", exact: true }).selectOption("0");
  await page.getByRole("slider", { name: "Current simulation time" }).fill("480");
  await expect(page.getByText("2A (Boys)", { exact: false })).toBeVisible();
  await expect(page.getByText("2A (Girls)", { exact: false })).toBeVisible();
});

test("downloads, edits, and applies a complete PHE allocation CSV", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Update model inputs" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download current template" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("PHE-space-allocations.csv");
  const path = await download.path();
  if (!path) throw new Error("Downloaded allocation template has no local path.");
  const template = await readFile(path, "utf8");
  const line = template.split("\r\n").find((candidate) => candidate.startsWith('"6 Girls","T3a",'));
  if (!line) throw new Error("Grade 6 allocation row was not found in the template.");
  const cells = line.slice(1, -1).split('","');
  cells[3] = "Primary Gym 1";
  const reconfigured = template.replace(line, cells.map((cell) => `"${cell}"`).join(","));

  await page.getByLabel("PHE space allocation CSV").setInputFiles({
    name: "reconfigured-allocations.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(reconfigured),
  });
  await page.getByRole("button", { name: "Regenerate simulator" }).click();
  await expect(page.getByRole("dialog", { name: "Update model inputs" })).toBeHidden();
  await expect(page.getByText("reconfigured-allocations.csv", { exact: false })).toBeVisible();
  await page.getByRole("combobox", { name: "Term", exact: true }).selectOption("T3a");
  await page.getByRole("combobox", { name: "Day", exact: true }).selectOption("3");
  await page.getByRole("slider", { name: "Current simulation time" }).fill("780");
  await expect(page.getByLabel("Primary Gym 1: 1 / 1").getByText("6A + 6B + 6C (Girls) — Indoor Team Sports")).toBeVisible();
});
