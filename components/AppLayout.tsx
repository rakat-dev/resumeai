import Sidebar from "@/components/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main style={{
        marginLeft: 220, flex: 1,
        padding: 32,
        maxWidth: "calc(100vw - 220px)",
        overflowX: "hidden",
      }}>
        {children}
      </main>
    </div>
  );
}
