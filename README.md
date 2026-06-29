# PHE Space Simulator

Standalone React/Vite simulator for validating PHE facility allocations against the Primary and Secondary timetables.

## Setup

```powershell
npm install
npm run ingest -- --primary "C:\path\primary.xml" --secondary "C:\path\secondary.xml" --spaces "C:\path\PHE Spaces.xlsx"
npm run dev
```

The raw XML/XLSX files remain outside the project. The ingest command writes only a sanitized `src/data/snapshot.json`; student records, emails, mobile numbers, and student IDs are never copied into the application data.

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
npm run ingest -- --primary <file> --secondary <file> --spaces <file>
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
- The outdoor EY Pool is unavailable in T1a and T3b.
- Tennis Courts are available throughout the school day and can host two groups concurrently.
- Activity/space suitability is accepted from the workbook unless one of the confirmed rules above says otherwise.
- The four Main Sports Hall gym zones are mutually suitable relocation spaces. A gym capacity clash is **workable** when their combined spare capacity can absorb every simultaneous gym overflow; otherwise it is **non-workable**.
- No relocation equivalence is inferred for pools, pitches, tennis, EY Gym, Fitness Suite, or C2-14 without a confirmed suitability rule.
