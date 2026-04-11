"use client";
import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Close sidebar when switching to desktop
  useEffect(() => {
    if (!isMobile) setSidebarOpen(false);
  }, [isMobile]);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>

      {/* Mobile overlay — tap to close sidebar */}
      {isMobile && sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        isMobile={isMobile}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main style={{
        marginLeft: isMobile ? 0 : 220,
        flex: 1,
        padding: isMobile ? "60px 16px 24px" : "32px",
        maxWidth: isMobile ? "100vw" : "calc(100vw - 220px)",
        overflowX: "hidden",
        minWidth: 0,
      }}>

        {/* Hamburger button — mobile only */}
        {isMobile && (
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            style={{
              position: "fixed",
              top: 12, left: 12,
              zIndex: 98,
              width: 40, height: 40,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              cursor: "pointer",
              color: "var(--text)",
              boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
            }}
          >
            ☰
          </button>
        )}

        {children}
      </main>
    </div>
  );
}
