"use client";

import { useState } from "react";
import type { InterviewQuestionsResult, InterviewQuestion } from "@/app/api/interview-questions/route";

interface InterviewPanelProps {
  tailoredResume: string;
  jobDescription: string;
  jobTitle?: string;
  company?: string;
}

const CATEGORY_STYLES: Record<InterviewQuestion["category"], { label: string; color: string }> = {
  behavioral:      { label: "Behavioral",    color: "#3b82f6" },
  technical:       { label: "Technical",     color: "#8b5cf6" },
  situational:     { label: "Situational",   color: "#f59e0b" },
  "role-specific": { label: "Role-Specific", color: "#10b981" },
};

export default function InterviewPanel({
  tailoredResume,
  jobDescription,
  jobTitle,
  company,
}: InterviewPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InterviewQuestionsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set([1]));

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/interview-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tailoredResume, jobDescription, jobTitle, company }),
      });
      if (!res.ok) throw new Error("Failed to generate questions");
      const data: InterviewQuestionsResult = await res.json();
      setResult(data);
      setExpandedIds(new Set([1]));
    } catch {
      setError("Failed to generate interview questions. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpen = () => {
    setIsOpen(true);
    if (!result && !loading) generate();
  };

  if (!isOpen) {
    return (
      <button
        onClick={handleOpen}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
          border: "1px solid #4f46e5",
          borderRadius: "10px",
          cursor: "pointer",
          transition: "opacity 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "20px" }}>🎯</span>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#e0e7ff" }}>
              Interview Question Predictor
            </div>
            <div style={{ fontSize: "12px", color: "#a5b4fc", marginTop: "2px" }}>
              AI predicts 8–10 likely questions with personalized answers
            </div>
          </div>
        </div>
        <span style={{ fontSize: "12px", color: "#818cf8", fontWeight: 500 }}>Generate ↗</span>
      </button>
    );
  }

  return (
    <div
      style={{
        border: "1px solid #4f46e5",
        borderRadius: "10px",
        overflow: "hidden",
        background: "#0f0e1a",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
          borderBottom: "1px solid #4f46e5",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "18px" }}>🎯</span>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#e0e7ff" }}>
              Interview Question Predictor
            </div>
            {result && (
              <div style={{ fontSize: "11px", color: "#a5b4fc", marginTop: "1px" }}>
                {result.questions.length} predicted questions
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {result && (
            <button
              onClick={generate}
              disabled={loading}
              style={{
                padding: "5px 12px",
                fontSize: "12px",
                background: "transparent",
                border: "1px solid #4f46e5",
                borderRadius: "6px",
                color: "#a5b4fc",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? "Regenerating…" : "↺ Regenerate"}
            </button>
          )}
          <button
            onClick={() => setIsOpen(false)}
            style={{
              padding: "5px 10px",
              fontSize: "12px",
              background: "transparent",
              border: "1px solid #4f46e5",
              borderRadius: "6px",
              color: "#a5b4fc",
              cursor: "pointer",
            }}
          >
            Collapse
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "16px" }}>
        {/* Loading */}
        {loading && !result && (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                border: "3px solid #312e81",
                borderTopColor: "#818cf8",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                margin: "0 auto 12px",
              }}
            />
            <div style={{ color: "#a5b4fc", fontSize: "13px" }}>
              Analyzing JD and predicting questions…
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              background: "#1a0f0f",
              border: "1px solid #7f1d1d",
              borderRadius: "8px",
              padding: "12px 16px",
              color: "#fca5a5",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Category legend */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
              {Object.entries(CATEGORY_STYLES).map(([key, { label, color }]) => {
                const count = result.questions.filter((q) => q.category === key).length;
                if (count === 0) return null;
                return (
                  <span
                    key={key}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "3px 10px",
                      borderRadius: "20px",
                      fontSize: "11px",
                      fontWeight: 500,
                      background: `${color}18`,
                      border: `1px solid ${color}40`,
                      color,
                    }}
                  >
                    {label} ({count})
                  </span>
                );
              })}
            </div>

            {/* Questions accordion */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {result.questions.map((q) => {
                const cat = CATEGORY_STYLES[q.category];
                const expanded = expandedIds.has(q.id);
                return (
                  <div
                    key={q.id}
                    style={{
                      border: `1px solid ${expanded ? cat.color + "50" : "#2d2b4e"}`,
                      borderRadius: "8px",
                      overflow: "hidden",
                      background: expanded ? `${cat.color}08` : "#13111f",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    <button
                      onClick={() => toggleExpand(q.id)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "12px",
                        padding: "12px 14px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span
                        style={{
                          minWidth: "22px",
                          height: "22px",
                          borderRadius: "50%",
                          background: `${cat.color}25`,
                          border: `1px solid ${cat.color}50`,
                          color: cat.color,
                          fontSize: "11px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          marginTop: "1px",
                          flexShrink: 0,
                        }}
                      >
                        {q.id}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "4px" }}>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 600,
                              color: cat.color,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                            }}
                          >
                            {cat.label}
                          </span>
                        </div>
                        <div style={{ fontSize: "13px", fontWeight: 500, color: "#e0e7ff", lineHeight: "1.45" }}>
                          {q.question}
                        </div>
                      </div>
                      <span style={{ color: "#4f46e5", fontSize: "16px", flexShrink: 0 }}>
                        {expanded ? "▲" : "▼"}
                      </span>
                    </button>

                    {expanded && (
                      <div style={{ padding: "0 14px 14px 48px", borderTop: `1px solid ${cat.color}25` }}>
                        {/* Why they ask */}
                        <div
                          style={{
                            marginTop: "10px",
                            padding: "8px 12px",
                            background: "#1a1830",
                            borderRadius: "6px",
                            borderLeft: `3px solid ${cat.color}`,
                          }}
                        >
                          <div style={{ fontSize: "10px", fontWeight: 600, color: "#6366f1", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
                            Why they ask this
                          </div>
                          <div style={{ fontSize: "12px", color: "#a5b4fc", lineHeight: "1.5" }}>{q.why}</div>
                        </div>

                        {/* Suggested answer */}
                        <div style={{ marginTop: "12px" }}>
                          <div style={{ fontSize: "10px", fontWeight: 600, color: "#10b981", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                            Suggested answer
                          </div>
                          <div
                            style={{
                              fontSize: "13px",
                              color: "#d1fae5",
                              lineHeight: "1.65",
                              background: "#0a1f14",
                              border: "1px solid #064e3b",
                              borderRadius: "6px",
                              padding: "10px 12px",
                            }}
                          >
                            {q.suggestedAnswer}
                          </div>
                        </div>

                        {/* Key points */}
                        <div style={{ marginTop: "10px" }}>
                          <div style={{ fontSize: "10px", fontWeight: 600, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                            Key points to hit
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {q.keyPoints.map((pt, i) => (
                              <span
                                key={i}
                                style={{
                                  padding: "3px 9px",
                                  background: "#1c1404",
                                  border: "1px solid #78350f",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  color: "#fcd34d",
                                }}
                              >
                                {pt}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Top Tips */}
            {result.topTips && result.topTips.length > 0 && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px 14px",
                  background: "#0f1629",
                  border: "1px solid #1e40af",
                  borderRadius: "8px",
                }}
              >
                <div style={{ fontSize: "10px", fontWeight: 600, color: "#60a5fa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                  🧠 Interview tips for this role
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  {result.topTips.map((tip, i) => (
                    <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                      <span style={{ color: "#3b82f6", fontSize: "11px", marginTop: "2px" }}>→</span>
                      <span style={{ fontSize: "12px", color: "#93c5fd", lineHeight: "1.5" }}>{tip}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
