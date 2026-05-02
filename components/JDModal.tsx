"use client";

interface JDModalProps {
  jobId:       string;
  title:       string;
  company:     string;
  description: string;
  onClose:     () => void;
}

export default function JDModal({ jobId: _jobId, title, company, description, onClose }: JDModalProps) {
  const handleDownload = () => {
    const content = `${title}\n${company}\n${'='.repeat(60)}\n\n${description}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${company}_${title.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)' }} />
      <div style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, width: 'min(680px,95vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 1 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15 }}>{title}</div>
            <div style={{ fontSize: 12, color: 'var(--accent2)', fontWeight: 500 }}>{company}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={handleDownload}
              style={{ padding: '6px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
              Download .txt
            </button>
            <button onClick={onClose}
              style={{ padding: '6px 10px', borderRadius: 9, border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16 }}>
              ✕
            </button>
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
          <pre style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{description}</pre>
        </div>
      </div>
    </div>
  );
}
