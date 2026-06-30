import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

describe("PHE Space Simulator", () => {
  it("starts at T1a Monday 08:00 and shows XML class names", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "PHE Space Simulator" })).toBeInTheDocument();
    expect(screen.getByLabelText("Term")).toHaveValue("T1a");
    expect(screen.getByLabelText("Day")).toHaveValue("0");
    expect(screen.getAllByText("08:00").length).toBeGreaterThan(0);
    expect(screen.getByText("2MZ (Boys) — Gymnastics")).toBeVisible();
    expect(screen.getByText("2MZ (Girls) — Swimming")).toBeVisible();
    expect(screen.getByText("3LC + 3DR (Boys) — Adventure Challenge")).toBeVisible();
  });

  it("changes term and steps through real timetable boundaries", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Next timetable boundary" }));
    expect(screen.getAllByText("08:10").length).toBeGreaterThan(0);
  });

  it("resets all controls to the approved initial state", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText("Day"), "3");
    await user.selectOptions(screen.getByLabelText("Term"), "T3a");
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Day")).toHaveValue("0");
    expect(screen.getByLabelText("Term")).toHaveValue("T1a");
    expect(screen.getAllByText("08:00").length).toBeGreaterThan(0);
  });

  it("accepts allocation CSV or both XML exports before regeneration", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Update model inputs" }));
    expect(screen.getByRole("dialog", { name: "Update model inputs" })).toBeVisible();
    expect(screen.getByLabelText("Primary timetable XML")).toBeVisible();
    expect(screen.getByLabelText("Secondary timetable XML")).toBeVisible();
    expect(screen.getByLabelText("PHE space allocation CSV")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download current template" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Regenerate simulator" })).toBeDisabled();
  });

  it("edits the spreadsheet plan and applies it to the simulator", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByRole("heading", { name: "PHE space allocation plan" })).toBeVisible();
    expect(screen.getByLabelText("Grade 2 Boys T1a space")).toHaveValue("primary-gym-2");

    await user.selectOptions(screen.getByLabelText("Grade 2 Boys T1a space"), "main-pitch-1");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Test plan in simulator" }));

    expect(screen.getByLabelText("Term")).toHaveValue("T1a");
    expect(screen.getByText("2MZ (Boys) — Gymnastics")).toBeVisible();
    expect(screen.getByLabelText("Main Pitch 1: 1 / 2")).toContainElement(screen.getByText("2MZ (Boys) — Gymnastics"));
  }, 15_000);

  it("swaps term blocks and uses preset staff objects", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Plan" }));

    expect(screen.getByLabelText("Grade 1 T1a unit")).toHaveValue("Mixed Swim");
    expect(screen.getByLabelText("Grade 1 T1a space")).toHaveValue("main-pool");
    await user.click(screen.getByRole("button", { name: "Select Grade 1 T1a block for swap" }));
    await user.click(screen.getByRole("button", { name: "Swap Grade 1 T1b block with T1a" }));
    expect(screen.getByLabelText("Grade 1 T1a unit")).toHaveValue("Athletics");
    expect(screen.getByLabelText("Grade 1 T1a space")).toHaveValue("primary-gym-1");
    expect(screen.getByLabelText("Grade 1 T1b unit")).toHaveValue("Mixed Swim");
    expect(screen.getByLabelText("Grade 1 T1b space")).toHaveValue("main-pool");

    await user.click(screen.getByLabelText("Grade 2 Boys staff"));
    expect(screen.getByRole("checkbox", { name: "Benjamin Jenkins" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Ben Willgoss" })).toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Grade 2 Boys teachers" })).not.toBeInTheDocument();
  }, 15_000);
});
