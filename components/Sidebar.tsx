"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const NAV = [
  { icon: "📊", label: "Dashboard",     href: "/dashboard" },
  { icon: "✂️", label: "Tailor Resume", href: "/tailor"    },
  { icon: "🔍", label: "Job Search",    href: "/jobs"      },
  { icon: "💾", label: "Saved Jobs",    href: "/saved"     },
];

const LS_KEY = "resumeai_sidebar_collapsed";

export default function Sidebar() {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Load preference on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved === "true") setCollapsed(true);
    } catch {}
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(LS_KEY, String(next)); } catch {}
  };

  const W = collapsed ? 60 : 220;

  return (
    <aside style={{
      width: W, minHeight: "100vh",
      background: "var(--surface)",
      borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      padding: "24px 0",
      position: "fixed", top: 0, left: 0, zIndex: 100,
      transition: "width 0.25s ease",
      overflow: "hidden",
    }}>
      {/* Logo */}
      <div style={{ padding: collapsed ? "0 0 32px" : "0 20px 32px", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 10 }}>
        <div style={{ width: 36, height: 36, background: "var(--accent)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>📄</div>
        {!collapsed && (
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, background: "linear-gradient(135deg, var(--accent), var(--accent2))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", whiteSpace: "nowrap" }}>
            ResumeAI
          </span>
        )}
      </div>

      {/* Nav items */}
      {NAV.map(({ icon, label, href }) => {
        const active = path.startsWith(href);
        return (
          <Link key={href} href={href} style={{ textDecoration: "none" }} title={collapsed ? label : undefined}>
            <div style={{
              display: "flex", alignItems: "center",
              justifyContent: collapsed ? "center" : "flex-start",
              gap: 12,
              padding: collapsed ? "12px 0" : "12px 20px",
              color: active ? "var(--accent)" : "var(--muted)",
              borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
              background: active ? "rgba(108,99,255,0.08)" : "transparent",
              fontSize: 14, fontWeight: 500, cursor: "pointer",
              transition: "all 0.2s",
            }}>
              <span style={{ fontSize: 18, width: 22, textAlign: "center", flexShrink: 0 }}>{icon}</span>
              {!collapsed && <span style={{ whiteSpace: "nowrap" }}>{label}</span>}
            </div>
          </Link>
        );
      })}

      {/* Bottom: collapse button + label */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 0 }}>
        {/* Collapse toggle button */}
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start",
            gap: 10, padding: collapsed ? "10px 0" : "10px 20px",
            background: "none", border: "none", cursor: "pointer",
            color: "var(--muted)", fontSize: 13, fontWeight: 600,
            width: "100%", transition: "color 0.2s",
          }}
        >
          <span style={{ fontSize: 16, width: 22, textAlign: "center", flexShrink: 0 }}>
            {collapsed ? "›" : "‹"}
          </span>
          {!collapsed && <span style={{ whiteSpace: "nowrap" }}>Collapse</span>}
        </button>

        {/* Built with label */}
        {!collapsed && (
          <div style={{ padding: "4px 20px 16px", fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
            Built with Claude AI
          </div>
        )}
      </div>
    </aside>
  );
}
