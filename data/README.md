# Timetable source files

This is the **single source of truth** for the raw aSc timetable exports. Drop the current files here:

- `primary-timetable.xml` — the PYP / Minis–Grade 5 export
- `secondary-timetable.xml` — the MYP / Grades 6–10 export

## How an update flows to every app

1. Replace a file in this folder and commit it to `main`.
2. The **Deploy GitHub Pages** workflow re-runs `npm run ingest` on these XMLs and rebuilds.
3. The sanitized `snapshot.json` is published at the site root (`<pages-url>/snapshot.json`).
4. Every app that fetches that URL (see `VITE_SNAPSHOT_URL` in the project README) picks up the change on next load — no per-app rebuild.

To preview locally before committing:

```powershell
npm run ingest -- --primary "data/primary-timetable.xml" --secondary "data/secondary-timetable.xml"
npm run dev
```

> These exports here contain dummy student data only. If you ever switch to real exports, move this
> folder to a private store — the ingest already strips student PII from `snapshot.json`, but the
> raw XML should not be public.
