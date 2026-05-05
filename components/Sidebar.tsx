"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const NAV = [
  { icon: "📊", label: "Dashboard",     href: "/dashboard"   },
  { icon: "✂️", label: "Tailor Resume", href: "/tailor"      },
  { icon: "🔍", label: "Job Search",    href: "/jobs"        },
  { icon: "💾", label: "Saved Jobs",    href: "/saved"       },
  { icon: "📁", label: "History",       href: "/history"     },
  { icon: "🩺", label: "Diagnostics",   href: "/diagnostics" },
];

const LS_KEY = "resumeai_sidebar_collapsed";
const SIDEBAR_SYNC_EVENT = "resumeai:sidebar-collapsed";
const MOBILE_QUERY = "(max-width: 767px)";

function readCollapsedPreference() {
  try {
    return localStorage.getItem(LS_KEY) === "true";
  } catch {
    return false;
  }
}

function publishCollapsedPreference(next: boolean) {
  try {
    localStorage.setItem(LS_KEY, String(next));
  } catch {}

  window.dispatchEvent(new CustomEvent(SIDEBAR_SYNC_EVENT));
}

export default function Sidebar() {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const syncViewport = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileOpen(false);
    };

    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    const syncCollapsed = () => setCollapsed(readCollapsedPreference());

    syncCollapsed();
    window.addEventListener("storage", syncCollapsed);
    window.addEventListener(SIDEBAR_SYNC_EVENT, syncCollapsed);

    return () => {
      window.removeEventListener("storage", syncCollapsed);
      window.removeEventListener(SIDEBAR_SYNC_EVENT, syncCollapsed);
    };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [path]);

  useEffect(() => {
    if (!isMobile || !mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isMobile, mobileOpen]);

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      publishCollapsedPreference(next);
      return next;
    });
  };

  const W = isMobile ? 260 : collapsed ? 60 : 220;
  const sidebarVisible = !isMobile || mobileOpen;

  return (
    <>
      {isMobile && (
        <header style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 130,
          height: 60, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 16px", background: "var(--surface)", borderBottom: "1px solid var(--border)",
        }}>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
            style={{
              width: 40, height: 40, borderRadius: 10, border: "1px solid var(--border)",
              background: "var(--surface2)", color: "var(--text)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
            }}
          >
            ☰
          </button>
          <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <div style={{ width: 34, height: 34, background: "var(--accent)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>📄</div>
            <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 17, background: "linear-gradient(135deg, var(--accent), var(--accent2))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", whiteSpace: "nowrap" }}>
              ResumeAI
            </span>
          </Link>
          <div aria-hidden="true" style={{ width: 40 }} />
        </header>
      )}

      {isMobile && mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 140, background: "rgba(0,0,0,0.55)",
            border: "none", padding: 0, cursor: "pointer",
          }}
        />
      )}

      <aside aria-hidden={isMobile && !mobileOpen} style={{
        width: W, minHeight: "100vh",
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column",
        padding: "24px 0",
        position: "fixed", top: 0, left: 0, zIndex: 150,
        transform: sidebarVisible ? "translateX(0)" : "translateX(-100%)",
        visibility: sidebarVisible ? "visible" : "hidden",
        pointerEvents: sidebarVisible ? "auto" : "none",
        transition: "width 0.25s ease, transform 0.25s ease",
        overflow: "hidden",
        boxShadow: isMobile && mobileOpen ? "12px 0 40px rgba(0,0,0,0.35)" : undefined,
      }}>
        <div style={{ padding: collapsed && !isMobile ? "0 0 32px" : "0 20px 32px", display: "flex", alignItems: "center", justifyContent: collapsed && !isMobile ? "center" : "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{ width: 36, height: 36, background: "var(--accent)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>📄</div>
            {(!collapsed || isMobile) && (
              <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, background: "linear-gradient(135deg, var(--accent), var(--accent2))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", whiteSpace: "nowrap" }}>
                ResumeAI
              </span>
            )}
          </div>
          {isMobile && (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 24, lineHeight: 1 }}
            >
              ×
            </button>
          )}
        </div>

        {NAV.map(({ icon, label, href }) => {
          const active = path.startsWith(href);
          return (
            <Link key={href} href={href} style={{ textDecoration: "none" }} title={collapsed && !isMobile ? label : undefined}>
              <div style={{
                display: "flex", alignItems: "center",
                justifyContent: collapsed && !isMobile ? "center" : "flex-start",
                gap: 12,
                padding: collapsed && !isMobile ? "12px 0" : "12px 20px",
                color: active ? "var(--accent)" : "var(--muted)",
                borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
                background: active ? "rgba(108,99,255,0.08)" : "transparent",
                fontSize: 14, fontWeight: 500, cursor: "pointer",
                transition: "all 0.2s",
              }}>
                <span style={{ fontSize: 18, width: 22, textAlign: "center", flexShrink: 0 }}>{icon}</span>
                {(!collapsed || isMobile) && <span style={{ whiteSpace: "nowrap" }}>{label}</span>}
              </div>
            </Link>
          );
        })}

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 0 }}>
          {!isMobile && (
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
          )}

          {(!collapsed || isMobile) && (
            <div style={{ padding: "4px 20px 16px", fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
              Built with Claude AI
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
