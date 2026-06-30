# PHE Space Simulator

Standalone React/Vite simulator for validating PHE facility allocations against the Primary and Secondary timetables.

## Setup

```powershell
npm install
npm run ingest -- --primary "C:\path\primary.xml" --secondary "C:\path\secondary.xml" --spaces "C:\path\PHE Spaces.xlsx"
npm run dev
```

The raw XML/XLSX files remain outside the project. The ingest command writes only a sanitized `src/data/snapshot.json`; student records, emails, mobile numbers, and student IDs are never copied into the application data.

## Update the data back end (ingest)

`npm run ingest` is the back-end data path: it bakes timetable XML into the committed `src/data/snapshot.json` separately from the running app (no browser upload, no server). The `--spaces` workbook is **optional**:

```powershell
# Re-bake just the timetable XML, reusing the allocations already in snapshot.json
npm run ingest -- --primary "C:\path\primary.xml" --secondary "C:\path\secondary.xml"

# Drive allocations from a CSV instead of the workbook (same columns as the in-app template)
npm run ingest -- --primary "C:\path\primary.xml" --secondary "C:\path\secondary.xml" --allocations "C:\path\PHE-space-allocations.csv"

# Full rebuild from the workbook
npm run ingest -- --primary "C:\path\primary.xml" --secondary "C:\path\secondary.xml" --spaces "C:\path\PHE Spaces.xlsx"
```

When `--spaces` is omitted the existing `src/data/snapshot.json` is reused for the unit/space/teacher allocations, so a new timetable can be re-baked on its own. `--output <file>` overrides the snapshot path. The in-browser **Update model inputs** uploader still works for ad-hoc, browser-only changes.

The importer recognises Early-Years and Minis PHE (the `EY PE`/`EY2PE` subjects) as PHE, de-duplicates occupancies that several homeroom classes share (e.g. Grade 2), and labels the PYP lunch period (P8 for Grades 1–5) as **Lunch**.

## One timetable, many apps (shared snapshot)

The raw XMLs live in [`data/`](data/) as the single source of truth. On every push to `main`, the **Deploy GitHub Pages** workflow re-runs the ingest on those files and publishes the sanitized `snapshot.json` at the site root, e.g. `https://<user>.github.io/phe-space-simulator/snapshot.json`.

Apps load their data at runtime:

1. The bundled `snapshot.json` renders instantly (offline fallback).
2. On load, the app fetches the published snapshot and swaps it in if newer.

`ingest` writes two copies — `src/data/snapshot.json` (bundled fallback) and `public/snapshot.json` (the served, fetchable file).

To point **another** app at this hub, set an env var at its build time so it fetches the same file:

```
VITE_SNAPSHOT_URL=https://<user>.github.io/phe-space-simulator/snapshot.json
```

Leaving `VITE_SNAPSHOT_URL` unset makes an app fetch its own same-origin `./snapshot.json`. GitHub Pages serves these with permissive CORS, so cross-app fetches work. **Update the XML in `data/` once → push → every app reflects it on next load, with no per-app rebuild.**

## Updating the plan (units & spaces)

The **plan** — which unit and space each group gets per term — lives in `data/allocations.csv` (one row per cohort × term: `cohort,term,activity,facility,teachers`, where `activity` is the unit and `facility` is the space). CI feeds it to the ingest, overriding the units/spaces/teachers in the published snapshot. The plan and the timetable XML are updated independently.

Workflow:

1. In the app, open **Plan**, change units / spaces / staff, and click **Test plan in simulator** to preview the clash impact.
2. When happy, open **Update model inputs → Download current template** — this exports your edited plan as `allocations.csv`.
3. Replace `data/allocations.csv` with that file and push to `main`.

CI re-ingests and redeploys; both apps reflect the change on next load.

## Pages

- **Simulator** — minute-by-minute facility occupancy and clash detection.
- **Plan** — edit units, spaces and staff; **Add unit** creates a new unit title; **Export PDF** prints the allocation plan.
- **Classes** — weekly PHE timetable for a chosen group (cohort) and term, with **Export PDF**.
- **Year overview** — whole-year allocations and a clash summary, with **Export PDF**.

PDF export uses the browser's print dialog ("Save as PDF") with print-optimised layouts, so it works offline and on GitHub Pages with no extra dependencies.

## Plan editor

The **Plan** page allows staff to test changes before adopting them:

- drag a term block onto another term in the same cohort to swap its unit and facility;
- use the swap handles as a keyboard-friendly alternative to dragging;
- select a different preset unit or facility for an individual term;
- select staff from teacher objects extracted from the timetable XML, rather than entering free text;
- apply the draft plan to rerun clash checks in the simulator.

Plan changes remain local to the browser and do not modify the source XML or workbook.

## Update timetables in the simulator

Use **Update model inputs** at the bottom of the board to replace the timetable XML, PHE allocation CSV, or both. The selected files are processed locally and are not uploaded, saved, or added to the repository. Reloading the page restores the shipped snapshot.

The dialog can download the current allocations as a CSV template. It has one row per cohort and term with these columns:

```csv
cohort,term,activity,facility,teachers
```

Edit the activity, facility, or teachers and upload the complete file. CSV allocations immediately remap the currently loaded timetable. Primary and Secondary XML must still be supplied as a pair when replacing timetable structure.

## Commands

```powershell
npm run dev
npm run ingest -- --primary <file> --secondary <file> [--spaces <file.xlsx>] [--allocations <file.csv>] [--output <file>]
npm run generation:model -- --secondary <file.xml> --relationships <capture.har>
npm run lint
npm test
npm run build
npm run test:e2e
```

## 10-minute generation model

`generation:model` converts the Secondary timetable into a 10-minute atomic grid. A Secondary lesson occupies six contiguous slots; the future Primary import will occupy four. The generated model also extracts the relationship baseline from the HAR without retaining cookies, request headers, users, or student data.

The converter deliberately uses the first relationship fetch in the HAR as the baseline. Any add/update/delete request recorded later in the capture is listed under `metadata.excludedHarMutations` and is not silently treated as an original constraint.

The model distinguishes relationship rules that remain valid on a smaller time quantum from rules that need overlap- or duration-aware translation. In particular, “same start” rules survive unchanged, while “not on the same period” must become “must not overlap.”

## Confirmed rules

- Primary XML contributes Minis–Grade 5; Secondary XML contributes Grades 6–10.
- Grade 2 timetable slots are split into simultaneous Boys and Girls groups.
- Generic `Swimming Pool` assignments send Minis/EY to the indoor Side Pool and Grade 1+ to the Main Pool.
- Main and Side Pools are independent and may operate simultaneously.
- The Main Pool can run **two** groups at once as a low-risk (workable, amber) clash; three or more is non-workable. The Side Pool stays single-group.
- Back Pitches can run **two** groups at once as a workable (amber) clash. Main Pitches can too **except during break or lunch**, when a second group is non-workable (red).
- Minis/EY1/EY2 may run PHE during the Grades 1–5 lunch (their day differs), so the lunch label never blocks their sessions.
- The outdoor EY Pool is unavailable in T1a and T3b.
- Tennis Courts are available throughout the school day and can host two groups concurrently.
- Activity/space suitability is accepted from the workbook unless one of the confirmed rules above says otherwise.
- The four Main Sports Hall gym zones are mutually suitable relocation spaces. A gym capacity clash is **workable** when their combined spare capacity can absorb every simultaneous gym overflow; otherwise it is **non-workable**.
- No relocation equivalence is inferred for pools, pitches, tennis, EY Gym, Fitness Suite, or C2-14 without a confirmed suitability rule.
