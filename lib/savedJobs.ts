// Saved Jobs — localStorage persistence across sessions

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

const KEY = "resumeai_saved_jobs";

export function getSavedJobs(): SavedJob[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

export function getSavedIds(): Set<string> {
  return new Set(getSavedJobs().map(j => j.id));
}

export function saveJob(job: SavedJob): void {
  if (typeof window === "undefined") return;
  const list = getSavedJobs().filter(j => j.id !== job.id);
  list.unshift(job);
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function unsaveJob(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(getSavedJobs().filter(j => j.id !== id)));
}

export function isJobSaved(id: string): boolean {
  return getSavedIds().has(id);
}
