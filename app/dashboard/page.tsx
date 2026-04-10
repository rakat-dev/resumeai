"use client";
import AppLayout from "@/components/AppLayout";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

const MONTHLY = [
  { month: "Jan", applied: 0, generated: 0, manual: 0 },
  { month: "Feb", applied: 0, generated: 0, manual: 0 },
  { month: "Mar", applied: 12, generated: 14, manual: 3 },
  { month: "Apr", applied: 183, generated: 195, manual: 16 },
];

const DAILY = (() => {
  const data: { date: string; applied: number; generated: number; manual: number }[] = [];
  const start = new Date("2026-03-12");
  const spikes: Record<number, [number,number,number]> = {
    21:[42,49,2], 22:[18,22,4], 23:[40,46,6],
    24:[25,28,3], 25:[34,41,5], 26:[8,10,1], 27:[12,15,0],
  };
  for (let i = 0; i < 29; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const label = `${d.toLocaleString("default",{month:"short"})} ${d.getDate()}`;
    const s = spikes[i];
    data.push({ date: label, applied: s?.[0]??0, generated: s?.[1]??0, manual: s?.[2]??0 });
  }
  return data;
})();

const TT = { contentStyle: { background:"#1a1a26", border:"1px solid #2a2a3d", borderRadius:8, fontSize:12 } };

export default function Dashboard() {
  return (
    <AppLayout>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>📊 Profile Dashboard</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>
          Your job application performance and resume history
        </p>
      </div>

      {/* Profile card */}
      <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:16, padding:28, display:"flex", alignItems:"center", gap:24, marginBottom:28 }}>
        <div style={{ width:72, height:72, borderRadius:"50%", background:"linear-gradient(135deg,var(--accent),var(--accent2))", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, fontWeight:800, fontFamily:"'Syne',sans-serif", flexShrink:0 }}>RK</div>
        <div>
          <div style={{ fontSize:22, fontWeight:800, fontFamily:"'Syne',sans-serif" }}>Rahul katamneni</div>
          <div style={{ fontSize:13, color:"var(--muted)", marginTop:2 }}>rahul.kat.1107@gmail.com</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:8 }}>
            <span style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 12px", borderRadius:100, fontSize:12, fontWeight:600, background:"rgba(108,99,255,.15)", color:"var(--accent)", border:"1px solid rgba(108,99,255,.3)" }}>👩‍💼 tier2</span>
            <span style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 12px", borderRadius:100, fontSize:12, fontWeight:600, background:"rgba(0,229,176,.12)", color:"var(--accent2)", border:"1px solid rgba(0,229,176,.3)" }}>● Applier Active</span>
          </div>
          <div style={{ fontSize:12, color:"var(--muted)", marginTop:4 }}>Subscription: Apr 2, 2026 → May 2, 2026</div>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:28 }}>
        {[
          ["Total Applied","183","#4f8ef7","All time"],
          ["Generated","195","var(--accent)","This month"],
          ["Manual Applied","16","var(--accent2)","This month"],
          ["Available Jobs","5","var(--accent3)","Might be available"],
        ].map(([label,val,color,sub]) => (
          <div key={label} style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:16, padding:20, display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:1, color:"var(--muted)", fontWeight:600 }}>{label}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:36, fontWeight:800, lineHeight:1, color: color as string }}>{val}</div>
            <div style={{ fontSize:12, color:"var(--muted)" }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:28 }}>
        <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:16, padding:24 }}>
          <div style={{ fontSize:16, fontWeight:700, marginBottom:20 }}>📅 Monthly Trends</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={MONTHLY} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3d" />
              <XAxis dataKey="month" stroke="#7070a0" fontSize={12} />
              <YAxis stroke="#7070a0" fontSize={12} />
              <Tooltip {...TT} />
              <Legend wrapperStyle={{ fontSize:12 }} />
              <Bar dataKey="applied"   fill="#4f8ef7" radius={[4,4,0,0]} name="Applied"  />
              <Bar dataKey="generated" fill="#6c63ff" radius={[4,4,0,0]} name="Generated"/>
              <Bar dataKey="manual"    fill="#00e5b0" radius={[4,4,0,0]} name="Manual"   />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:16, padding:24 }}>
          <div style={{ fontSize:16, fontWeight:700, marginBottom:20 }}>📈 30-Day Activity</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={DAILY}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3d" />
              <XAxis dataKey="date" stroke="#7070a0" fontSize={10} interval={4} />
              <YAxis stroke="#7070a0" fontSize={12} />
              <Tooltip {...TT} />
              <Legend wrapperStyle={{ fontSize:12 }} />
              <Line type="monotone" dataKey="applied"   stroke="#4f8ef7" dot={false} strokeWidth={2} name="Applied"  />
              <Line type="monotone" dataKey="generated" stroke="#6c63ff" dot={false} strokeWidth={2} name="Generated"/>
              <Line type="monotone" dataKey="manual"    stroke="#00e5b0" dot={false} strokeWidth={2} name="Manual"   />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </AppLayout>
  );
}
