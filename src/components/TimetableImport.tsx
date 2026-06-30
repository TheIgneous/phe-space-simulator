import { useEffect, useRef, useState } from "react";
import { Download, FileUp, RefreshCw, X } from "lucide-react";
import type { SimulationDataset } from "../types";

interface TimetableImportProps {
  dataset: SimulationDataset;
  onImport: (dataset: SimulationDataset) => void;
}

export function TimetableImport({ dataset, onImport }: TimetableImportProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [primary, setPrimary] = useState<File | null>(null);
  const [secondary, setSecondary] = useState<File | null>(null);
  const [allocation, setAllocation] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    dialogRef.current?.querySelector<HTMLInputElement>('input[type="file"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoading) {
        setIsOpen(false);
        setError("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLoading, isOpen]);

  const close = () => {
    if (isLoading) return;
    setIsOpen(false);
    setError("");
  };

  const regenerate = async () => {
    if (!allocation && (!primary || !secondary)) return;
    if ((primary && !secondary) || (!primary && secondary)) {
      setError("Choose both Primary and Secondary XML files, or clear both XML fields.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      let nextDataset = dataset;
      if (allocation) {
        const { allocationFile, applyAllocationCsv } = await import("../domain/allocationCsv");
        const parsed = await allocationFile(allocation);
        nextDataset = applyAllocationCsv(nextDataset, parsed.text, parsed.source);
      }
      if (primary && secondary) {
        const { fileUpload, regenerateFromTimetables } = await import("../domain/xmlIngest");
        const [primaryUpload, secondaryUpload] = await Promise.all([fileUpload(primary), fileUpload(secondary)]);
        nextDataset = regenerateFromTimetables(nextDataset, primaryUpload, secondaryUpload);
      }
      onImport(nextDataset);
      setIsOpen(false);
      setPrimary(null);
      setSecondary(null);
      setAllocation(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The timetable files could not be processed.");
    } finally {
      setIsLoading(false);
    }
  };

  const downloadTemplate = async () => {
    const { allocationTemplateCsv } = await import("../domain/allocationCsv");
    const url = URL.createObjectURL(new Blob([allocationTemplateCsv(dataset)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "allocations.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <button type="button" className="update-timetable-button" onClick={() => setIsOpen(true)}>
        <FileUp size={16} /> Update model inputs
      </button>
      {isOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <div className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" ref={dialogRef}>
            <div className="import-heading">
              <div>
                <h2 id="import-title">Update model inputs</h2>
                <p>Replace the allocation CSV, both timetable XML files, or all three. Processing happens in this browser; source files are not uploaded or saved.</p>
              </div>
              <button type="button" className="icon-button" onClick={close} aria-label="Close timetable update">
                <X size={20} />
              </button>
            </div>
            <div className="file-fields">
              <label>
                <span>Primary timetable XML</span>
                <input
                  type="file"
                  aria-label="Primary timetable XML"
                  accept=".xml,text/xml,application/xml"
                  onChange={(event) => setPrimary(event.target.files?.[0] ?? null)}
                />
                <small>{primary?.name ?? "Minis–Grade 5 export"}</small>
              </label>
              <label>
                <span>Secondary timetable XML</span>
                <input
                  type="file"
                  aria-label="Secondary timetable XML"
                  accept=".xml,text/xml,application/xml"
                  onChange={(event) => setSecondary(event.target.files?.[0] ?? null)}
                />
                <small>{secondary?.name ?? "Grade 6–10 export"}</small>
              </label>
            </div>
            <div className="allocation-field">
              <div className="allocation-field-heading">
                <div><strong>PHE space allocation CSV</strong><small>Complete replacement: cohort, term, activity, facility, teachers</small></div>
                <button type="button" className="template-button" onClick={downloadTemplate}><Download size={15} /> Download current template</button>
              </div>
              <input
                type="file"
                aria-label="PHE space allocation CSV"
                accept=".csv,text/csv"
                onChange={(event) => setAllocation(event.target.files?.[0] ?? null)}
              />
              <small>{allocation?.name ?? "Optional when only updating timetable XML"}</small>
            </div>
            {error ? <div className="import-error" role="alert">{error}</div> : null}
            <div className="import-actions">
              <button type="button" className="button secondary" onClick={close}>Cancel</button>
              <button type="button" className="button primary" disabled={(!allocation && (!primary || !secondary)) || isLoading} onClick={regenerate}>
                <RefreshCw size={18} className={isLoading ? "spin" : ""} />
                {isLoading ? "Regenerating…" : "Regenerate simulator"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
