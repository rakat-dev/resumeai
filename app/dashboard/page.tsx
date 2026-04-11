"use client";
import { useState, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  getHistoryStats, getMonthlyChartData, getDailyChartData,
} from "@/lib/history";

const TT = {
  contentStyle: {
    background: "#1a1a26",
    border: "1px solid #2a2a3d",
    borderRadius: 8,
    fontSize: 12,
  },
};

export default function Dashboard() {
  const [stats, setStats] = useState({ total: 0, tailored: 0, applied: 0, interviews: 0, offers: 0 });
  const [monthly, setMonthly] = useState<{ month: string; generated: number; applied: number }[]>([]);
  const [daily, setDaily] = useState<{ date: string; generated: number; applied: number }[]>([]);

  useEffect(() => {
    setStats(getHistoryStats());
    setMonthly(getMonthlyChartData());
    setDaily(getDailyChartData());
  }, []);

  const statCards = [
    { label: "Total Tailored",  val: stats.total,      color: "var(--accent)",  sub: "All time" },
    { label: "Applied",         val: stats.applied,    color: "#4f8ef7",         sub: "All time" },
    { label: "Interviews",      val: stats.interviews, color: "var(--accent2)", sub: "All time" },
    { label: "Offers",          val: stats.offers,     color: "#ffd700",         sub: "All time" },
  ];

  return (
    <AppLayout>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>📊 Profile Dashboard</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>
          Your job application performance and resume history
        </p>
      </div>

      {/* Profile card */}
      <div style={{
        background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16,
        padding: 28, display: "flex", alignItems: "center", gap: 24, marginBottom: 28,
        flexWrap: "wrap",
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: "50%",
          background: "linear-gradient(135deg,var(--accent),var(--accent2))",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28, fontWeight: 800, fontFamily: "'Syne',sans-serif", flexShrink: 0,
        }}>RK</div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Syne',sans-serif" }}>
            Rahul Katamneni
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
            rahul.kat.1107@gmail.com
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 12px", borderRadius: 100, fontSize: 12, fontWeight: 600,
              background: "rgba(108,99,255,.15)", color: "var(--accent)",
              border: "1px solid rgba(108,99,255,.3)",
            }}>👩‍💼 tier2</span>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 12px", borderRadius: 100, fontSize: 12, fontWeight: 600,
              background: "rgba(0,229,176,.12)", color: "var(--accent2)",
              border: "1px solid rgba(0,229,176,.3)",
            }}>● Applier Active</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            Subscription: Apr 2, 2026 → May 2, 2026
          </div>
        </div>
      </div>

      {/* Stat cards — responsive grid */}
      <div className="stat-grid" style={{ marginBottom: 28 }}>
        {statCards.map(({ label, val, color, sub }) => (
          <div key={label} style={{
            background: "var(--card)", border: "1px solid var(--border)",
            borderRadius: 16, padding: 20,
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{
              fontSize: 11, textTransform: "uppercase", letterSpacing: 1,
              color: "var(--muted)", fontWeight: 600,
            }}>{label}</div>
            <div style={{
              fontFamily: "'Syne',sans-serif", fontSize: 36, fontWeight: 800,
              lineHeight: 1, color,
            }}>{val}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Empty state hint */}
      {stats.total === 0 && (
        <div style={{
          background: "rgba(108,99,255,0.06)", border: "1px solid rgba(108,99,255,0.2)",
          borderRadius: 16, padding: "20px 24px", marginBottom: 28,
          display: "flex", alignItems: "center", gap: 16,
        }}>
          <span style={{ fontSize: 32 }}>🚀</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Start tailoring resumes to see your stats</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              Head to <strong>Job Search</strong> or <strong>Tailor Resume</strong> to get started.
              Your activity will show up here automatically.
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="chart-grid" style={{ marginBottom: 28 }}>
        <div style={{
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 16, padding: 24,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>📅 Monthly Trends</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthly} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3d" />
              <XAxis dataKey="month" stroke="#7070a0" fontSize={12} />
              <YAxis stroke="#7070a0" fontSize={12} />
              <Tooltip {...TT} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="generated" fill="#6c63ff" radius={[4, 4, 0, 0]} name="Tailored" />
              <Bar dataKey="applied"   fill="#4f8ef7" radius={[4, 4, 0, 0]} name="Applied" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 16, padding: 24,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>📈 30-Day Activity</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3d" />
              <XAxis dataKey="date" stroke="#7070a0" fontSize={10} interval={4} />
              <YAxis stroke="#7070a0" fontSize={12} />
              <Tooltip {...TT} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="generated" stroke="#6c63ff" dot={false} strokeWidth={2} name="Tailored" />
              <Line type="monotone" dataKey="applied"   stroke="#4f8ef7" dot={false} strokeWidth={2} name="Applied" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </AppLayout>
  );
}
