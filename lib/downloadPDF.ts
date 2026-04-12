export function downloadPDF(resumeText: string, _filename?: string) {
  const DARK_BLUE = "#1F3864";
  const BLACK = "#000000";
  const lines = resumeText.split("\n");
  const SECTION_KEYWORDS = ["SUMMARY","SKILLS","PROFESSIONAL EXPERIENCE","EXPERIENCE","EDUCATION","PROJECTS"];
  const SKILL_CATS = ["Frontend","Backend","Cloud","Messaging","Databases","Testing","Observability","Tools","Languages","AI","DevOps"];
  const COMPANIES = ["Artificial Inventions","Amazon","Centene","Accenture","Infosys","Google","Microsoft","Meta","Apple","JPMorgan","Stripe","Airbnb","Netflix"];
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Calibri',Arial,sans-serif;font-size:10pt;color:${BLACK};padding:36pt 43pt;line-height:1.0}.name{font-size:18pt;font-weight:bold;color:${DARK_BLUE}}.title-line{font-size:16pt;color:${BLACK};margin-top:2pt}.contact{font-size:13pt;color:${BLACK};margin-top:4pt}.section-header{font-size:15pt;font-weight:bold;color:${DARK_BLUE};border-bottom:1.5px solid ${BLACK};margin-top:10pt;margin-bottom:3pt;padding-bottom:1pt}.body-text{font-size:10pt;color:${BLACK};margin-top:4pt}.company{font-size:13pt;font-weight:bold;color:${BLACK};margin-top:8pt}.role{font-size:11.5pt;font-style:italic;color:${BLACK}}.bullet{font-size:10pt;color:${BLACK};margin-left:18pt;text-indent:-9pt}.bullet::before{content:"• "}.tech{font-size:10pt;color:${BLACK};margin-top:3pt}.skill-row{font-size:10pt;color:${BLACK}}.skill-bold{font-weight:bold}.edu-degree{font-size:13pt;font-weight:bold;color:${BLACK};margin-top:6pt}.edu-school{font-size:11.5pt;font-style:italic;color:${BLACK}}</style></head><body>`;
  let nameWritten=false, titleWritten=false, contactWritten=false, inSkills=false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!nameWritten) { html+=`<div class="name">${line.split("—")[0].trim()}</div>`; nameWritten=true; continue; }
    if (!titleWritten && !line.includes("@") && !line.includes("|") && !line.match(/\d{3}/)) {
      const t = line.includes("—") ? line.split("—")[1]?.trim() : line;
      if (t) { html+=`<div class="title-line">${t}</div>`; titleWritten=true; continue; }
    }
    if (!contactWritten && (line.includes("|") || line.match(/\d{3}[-.\s]\d{3}/))) {
      html+=`<div class="contact">${line}</div>`; contactWritten=true; continue;
    }
    if (SECTION_KEYWORDS.some(k=>line.toUpperCase()===k||line.toUpperCase().startsWith(k))) {
      inSkills=line.toUpperCase().includes("SKILL"); html+=`<div class="section-header">${line}</div>`; continue;
    }
    if (line.startsWith("•")||line.startsWith("-")) { html+=`<div class="bullet">${line.replace(/^[•\-]\s*/,"")}</div>`; continue; }
    if (line.startsWith("Tech Stack:")) { html+=`<div class="tech"><span class="skill-bold">Tech Stack: </span>${line.replace("Tech Stack:","").trim()}</div>`; continue; }
    if (inSkills && SKILL_CATS.some(c=>line.startsWith(c+":"))) {
      const ci=line.indexOf(":"); html+=`<div class="skill-row"><span class="skill-bold">${line.slice(0,ci)}: </span>${line.slice(ci+1).trim()}</div>`; continue;
    }
    if (COMPANIES.some(c=>line.includes(c))) { html+=`<div class="company">${line}</div>`; continue; }
    if (line.startsWith("Master")||line.startsWith("Bachelor")||line.startsWith("Doctor")) { html+=`<div class="edu-degree">${line}</div>`; continue; }
    if (line.includes("University")||line.includes("Institute")||line.includes("College")) { html+=`<div class="edu-school">${line}</div>`; continue; }
    html+=`<div class="body-text">${line}</div>`;
  }
  html+=`</body></html>`;
  const w=window.open("","_blank");
  if (!w) { alert("Please allow popups to download PDF"); return; }
  w.document.write(html); w.document.close();
  w.onload=()=>{ w.focus(); w.print(); };
}
