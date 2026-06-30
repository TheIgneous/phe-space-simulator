import bundled from "./data/snapshot.json";
import type { SimulationDataset } from "./types";

/** Offline / first-paint fallback compiled into the bundle. */
export const BUNDLED_SNAPSHOT = bundled as SimulationDataset;

/**
 * Where the live snapshot is fetched from. Set `VITE_SNAPSHOT_URL` to a shared, CI-published URL
 * (e.g. the data-hub's GitHub Pages `snapshot.json`) to drive several apps from one source;
 * otherwise the app fetches its own same-origin copy.
 */
export const SNAPSHOT_URL = import.meta.env.VITE_SNAPSHOT_URL ?? `${import.meta.env.BASE_URL}snapshot.json`;

function looksLikeDataset(value: unknown): value is SimulationDataset {
  const data = value as Partial<SimulationDataset> | null;
  return Boolean(data) && Array.isArray(data?.events) && Array.isArray(data?.facilities) && Array.isArray(data?.assignments);
}

/**
 * Fetch the latest published snapshot. Returns null when it is unavailable or malformed so the
 * caller can keep the bundled copy — the app always renders, online or off.
 */
export async function fetchSnapshot(signal?: AbortSignal): Promise<SimulationDataset | null> {
  try {
    const response = await fetch(SNAPSHOT_URL, { signal, cache: "no-cache" });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return looksLikeDataset(data) ? data : null;
  } catch {
    return null;
  }
}
