// ── Saved Jobs Storage ──────────────────────────────────────────────────────
// Cross-search persistence for bookmarked job postings.

export interface SavedJob {
  id: string;
  title: string;
  company: string;
  location: string;
  type: string;
  salary?: string;
  description: string;
  applyUrl: string;
  postedDate: string;
  postedTimestamp: number;
  source: string;
  sourceType: string;
  skills: string[];
  sponsorshipTag: "mentioned" | "not_mentioned";
  experience?: string;
  savedAt: number;
}

const SAVED_KEY = "resumeai_saved_jobs";

export function getSavedJobs(): SavedJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as SavedJob[]) : [];
  } catch {
    return [];
  }
}

export function saveJob(job: SavedJob): void {
  if (typeof window === "undefined") return;
  const list = getSavedJobs().filter(j => j.id !== job.id);
  list.unshift(job);
  localStorage.setItem(SAVED_KEY, JSON.stringify(list));
}

export function unsaveJob(id: string): void {
  if (typeof window === "undefined") return;
  const list = getSavedJobs().filter(j => j.id !== id);
  localStorage.setItem(SAVED_KEY, JSON.stringify(list));
}

export function getSavedJobIds(): Set<string> {
  return new Set(getSavedJobs().map(j => j.id));
}
