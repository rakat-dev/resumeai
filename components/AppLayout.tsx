"use client";
import Sidebar from "@/components/Sidebar";
import { useState, useEffect } from "react";

const LS_KEY = "resumeai_sidebar_collapsed";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const sync = () => {
      try { setCollapsed(localStorage.getItem(LS_KEY) === "true"); } catch {}
    };
    sync();
    // Listen for storage changes (sidebar toggle updates this)
    window.addEventListener("storage", sync);
    // Also poll every 200ms to catch same-tab changes
    const interval = setInterval(sync, 200);
    return () => { window.removeEventListener("storage", sync); clearInterval(interval); };
  }, []);

  const sidebarW = collapsed ? 60 : 220;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main style={{
        marginLeft: sidebarW,
        flex: 1,
        padding: 32,
        maxWidth: `calc(100vw - ${sidebarW}px)`,
        overflowX: "hidden",
        transition: "margin-left 0.25s ease, max-width 0.25s ease",
      }}>
        {children}
      </main>
    </div>
  );
}
