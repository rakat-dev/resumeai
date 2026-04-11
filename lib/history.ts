// ── History Storage Utility ────────────────────────────────────────────────
// Persists all tailored resumes and job applications in localStorage.

export type HistoryStatus = "tailored" | "applied" | "interview" | "rejected" | "offer";

export interface HistoryEntry {
  id: string;
  jobTitle: string;
  company: string;
  jobId?: string;            // from jobs tab — used for dedup
  applyUrl?: string;
  tailoredResume: string;
  jobDescription: string;
  atsScore?: number;
  sponsorshipTag?: "mentioned" | "not_mentioned";
  location?: string;
  jobType?: string;
  sourceType: "tailor_tab" | "jobs_tab";
  isUntitled: boolean;       // true → goes in "Untitled" section until renamed
  status: HistoryStatus;
  timestamp: number;         // Date.now()
  createdAt: string;         // human-readable
}

const STORAGE_KEY = "resumeai_history";

export function getHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveHistoryEntry(entry: HistoryEntry): { isUpdate: boolean; existingDate?: string } {
  if (typeof window === "undefined") return { isUpdate: false };
  const history = getHistory();

  // Dedup by jobId for jobs_tab entries
  if (entry.jobId) {
    const idx = history.findIndex(e => e.jobId === entry.jobId);
    if (idx !== -1) {
      const existingDate = history[idx].createdAt;
      history[idx] = { ...history[idx], ...entry, timestamp: Date.now(), createdAt: formatDate(Date.now()) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      return { isUpdate: true, existingDate };
    }
  }

  history.unshift(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  return { isUpdate: false };
}

export function updateHistoryEntry(id: string, updates: Partial<HistoryEntry>): void {
  if (typeof window === "undefined") return;
  const history = getHistory();
  const idx = history.findIndex(e => e.id === id);
  if (idx !== -1) {
    history[idx] = { ...history[idx], ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }
}

export function deleteHistoryEntry(id: string): void {
  if (typeof window === "undefined") return;
  const filtered = getHistory().filter(e => e.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export function clearHistory(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function getHistoryStats() {
  const history = getHistory();
  const applied = history.filter(e =>
    ["applied", "interview", "rejected", "offer"].includes(e.status)
  ).length;
  return {
    total: history.length,
    tailored: history.filter(e => e.status === "tailored").length,
    applied,
    interviews: history.filter(e => e.status === "interview").length,
    offers: history.filter(e => e.status === "offer").length,
  };
}

/** Build per-month data (last 4 months) for charts */
export function getMonthlyChartData() {
  const history = getHistory();
  const months: { month: string; generated: number; applied: number }[] = [];
  const now = new Date();

  for (let i = 3; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString("default", { month: "short" });
    const year = d.getFullYear();
    const month = d.getMonth();

    const generated = history.filter(e => {
      const ed = new Date(e.timestamp);
      return ed.getFullYear() === year && ed.getMonth() === month;
    }).length;

    const applied = history.filter(e => {
      const ed = new Date(e.timestamp);
      return ed.getFullYear() === year && ed.getMonth() === month &&
        ["applied", "interview", "rejected", "offer"].includes(e.status);
    }).length;

    months.push({ month: label, generated, applied });
  }
  return months;
}

/** Build last-30-days daily data for activity line chart */
export function getDailyChartData() {
  const history = getHistory();
  const data: { date: string; generated: number; applied: number }[] = [];
  const now = new Date();

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const label = `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;

    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = dayStart + 86400000;

    const generated = history.filter(e => e.timestamp >= dayStart && e.timestamp < dayEnd).length;
    const applied = history.filter(e =>
      e.timestamp >= dayStart && e.timestamp < dayEnd &&
      ["applied", "interview", "rejected", "offer"].includes(e.status)
    ).length;

    data.push({ date: label, generated, applied });
  }
  return data;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " at " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

/** Try to extract job title + company from raw JD text */
export function extractJobInfoFromJD(jd: string): { title: string; company: string } {
  let title = "";
  let company = "";

  // Title patterns — most JDs open with the job title or state it explicitly
  const titlePatterns = [
    /^([A-Z][A-Za-z\s\/]+(?:Engineer|Developer|Designer|Manager|Analyst|Architect|Lead|Director|Specialist|Consultant|Associate)[A-Za-z\s]*)/m,
    /(?:position|role|job title|title)[:\s–-]+([A-Za-z][^\n,]{5,60})/i,
    /(?:we(?:'re|\sare) (?:looking for|hiring|seeking)|seeking an?|hiring an?)\s+([A-Za-z][^\n,]{5,60})/i,
    /(?:job title|role)[:\s]*([A-Z][A-Za-z\s]+?)[\n,]/i,
  ];
  for (const p of titlePatterns) {
    const m = jd.match(p);
    const g = m?.[1]?.trim();
    if (g && g.length > 4) { title = g.slice(0, 60); break; }
  }

  // Company patterns
  const companyPatterns = [
    /(?:about|join)\s+([A-Z][A-Za-z0-9\s&.,]+?)(?:\s+is|\s+are|\s+was|\s*[,\n])/i,
    /(?:at|@)\s+([A-Z][A-Za-z0-9\s&.]+?)(?:\s+we|\s+you|\s+is|\s*[,\n])/i,
    /([A-Z][A-Za-z0-9\s&.]+?)\s+is (?:a|an|the) (?:leading|growing|global|top)/i,
  ];
  for (const p of companyPatterns) {
    const m = jd.match(p);
    const g = m?.[1]?.trim();
    if (g && g.length > 1 && g.length < 50) {
      company = g.replace(/[.,]$/, "");
      break;
    }
  }

  return { title, company };
}
