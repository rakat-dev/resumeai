"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { icon: "📊", label: "Dashboard",     href: "/dashboard" },
  { icon: "✂️", label: "Tailor Resume", href: "/tailor"    },
  { icon: "🔍", label: "Job Search",    href: "/jobs"      },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside style={{
      width: 220, minHeight: "100vh",
      background: "var(--surface)",
      borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      padding: "24px 0",
      position: "fixed", top: 0, left: 0, zIndex: 100,
    }}>
      {/* Logo */}
      <div style={{ padding: "0 20px 32px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 36, height: 36, background: "var(--accent)",
          borderRadius: 10, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 18,
        }}>📄</div>
        <span style={{
          fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18,
          background: "linear-gradient(135deg, var(--accent), var(--accent2))",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>ResumeAI</span>
      </div>

      {/* Nav items */}
      {NAV.map(({ icon, label, href }) => {
        const active = path.startsWith(href);
        return (
          <Link key={href} href={href} style={{ textDecoration: "none" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 20px",
              color: active ? "var(--accent)" : "var(--muted)",
              borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
              background: active ? "rgba(108,99,255,0.08)" : "transparent",
              fontSize: 14, fontWeight: 500, cursor: "pointer",
              transition: "all 0.2s",
            }}>
              <span style={{ fontSize: 18, width: 22, textAlign: "center" }}>{icon}</span>
              <span>{label}</span>
            </div>
          </Link>
        );
      })}

      {/* Bottom hint */}
      <div style={{ marginTop: "auto", padding: "20px", fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
        Built with Claude AI
      </div>
    </aside>
  );
}
