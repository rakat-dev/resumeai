"use client";
import Sidebar from "@/components/Sidebar";
import { useState, useEffect } from "react";

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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const syncViewport = () => setIsMobile(media.matches);

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

  const sidebarW = collapsed ? 60 : 220;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main style={{
        marginLeft: isMobile ? 0 : sidebarW,
        flex: 1,
        padding: isMobile ? "80px 16px 24px" : 32,
        width: isMobile ? "100%" : undefined,
        maxWidth: isMobile ? "100vw" : `calc(100vw - ${sidebarW}px)`,
        overflowX: "hidden",
        transition: "margin-left 0.25s ease, max-width 0.25s ease, padding 0.25s ease",
      }}>
        {children}
      </main>
    </div>
  );
}
