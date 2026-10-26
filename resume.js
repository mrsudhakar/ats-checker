/* ============================================================
   Resume rebuilder — structured profile + optimizer + DOCX export
   Pure-JS .docx generation (no external libraries, works offline).
   Depends on globals from app.js: scoreResume, buildRecommendations,
   titleCase, esc, toast, store, LS, wordCount.
   ============================================================ */
"use strict";

/* ---------------- profile storage ---------------- */
const PKEY = "ats_profile_v1";
let PROFILE = loadProfile();

function emptyExp(){ return {role:"",company:"",location:"",start:"",end:"",bullets:[]}; }
function emptyEdu(){ return {degree:"",school:"",location:"",start:"",end:""}; }
function defaultProfile(){
  return { name:"",title:"",email:"",phone:"",location:"",linkedin:"",website:"",
           summary:"", skills:[], experience:[emptyExp()], education:[emptyEdu()], certifications:[] };
}
function loadProfile(){
  try{ const j = JSON.parse(localStorage.getItem(PKEY)||"null"); return j && j.name!==undefined ? normalizeProfile(j) : defaultProfile(); }
  catch(e){ return defaultProfile(); }
}
function normalizeProfile(p){
  p = Object.assign(defaultProfile(), p);
  p.skills = Array.isArray(p.skills)?p.skills:[];
  p.certifications = Array.isArray(p.certifications)?p.certifications:[];
  p.experience = (Array.isArray(p.experience)&&p.experience.length?p.experience:[emptyExp()]).map(e=>Object.assign(emptyExp(),e,{bullets:Array.isArray(e.bullets)?e.bullets:[]}));
  p.education = (Array.isArray(p.education)&&p.education.length?p.education:[emptyEdu()]).map(e=>Object.assign(emptyEdu(),e));
  return p;
}
function saveProfile(){ try{ localStorage.setItem(PKEY, JSON.stringify(PROFILE)); }catch(e){} }
let _saveT; function scheduleSave(){ clearTimeout(_saveT); _saveT=setTimeout(saveProfile,400); }
function profileHasContent(p){ return !!(p.name||p.summary||(p.skills&&p.skills.length)||(p.experience&&p.experience.some(e=>e.role||e.company))); }

/* ---------------- import from plain resume text ---------------- */
function importFromText(text){
  const raw = (text||"").replace(/\r/g,"");
  const lines = raw.split("\n").map(l=>l.trim());
  const p = defaultProfile();
  const emailM = raw.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i); if(emailM) p.email=emailM[0];
  const phoneM = raw.match(/(\+?\d[\d\s().\-]{7,}\d)/); if(phoneM) p.phone=phoneM[0].trim();
  const liM = raw.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s|]+/i); if(liM) p.linkedin=liM[0];
  // website only when explicitly prefixed, so it doesn't grab the email's domain
  const siteM = raw.match(/(?:https?:\/\/|www\.)[a-z0-9\-.]+\.(?:com|io|dev|me|co|net|org)\b(?:\/[^\s|]*)?/i);
  if(siteM && !/linkedin/i.test(siteM[0])) p.website=siteM[0];
  // name = first non-empty line w/o @ or digits-heavy
  const firstReal = lines.find(l=>l && !/@/.test(l) && !/\d{3}/.test(l));
  if(firstReal) p.name=firstReal;
  // title = next short line after name that isn't contact
  const nameIdx = lines.indexOf(firstReal);
  for(let i=nameIdx+1;i<Math.min(nameIdx+4,lines.length);i++){
    const l=lines[i]; if(l && l.length<=60 && !/@|\d{3}|linkedin/i.test(l) && !isHeading(l)){ p.title=l; break; }
  }
  // sections
  const idx = {};
  lines.forEach((l,i)=>{ const h=headingKey(l); if(h && idx[h]===undefined) idx[h]=i; });
  const order = Object.entries(idx).sort((a,b)=>a[1]-b[1]);
  function sectionLines(key){
    const start = idx[key]; if(start===undefined) return [];
    let end = lines.length;
    for(const [k,i] of order){ if(i>start && i<end) end=i; }
    return lines.slice(start+1,end).filter(Boolean);
  }
  if(idx.summary!==undefined) p.summary = sectionLines("summary").join(" ");
  if(idx.skills!==undefined){
    p.skills = sectionLines("skills").join(", ").split(/[,;•·|\/\n]|\s{3,}/).map(s=>s.trim()).filter(s=>s.length>1 && s.length<60);
  }
  if(idx.certifications!==undefined){
    p.certifications = sectionLines("certifications").map(s=>s.replace(/^[•\-*]\s*/,"")).filter(Boolean);
  }
  if(idx.experience!==undefined){
    p.experience = parseJobs(sectionLines("experience"));
    if(!p.experience.length) p.experience=[emptyExp()];
  }
  if(idx.education!==undefined){
    p.education = sectionLines("education").filter(l=>!/^[•\-*]/.test(l)).map(l=>{
      const e=emptyEdu(); const dm=l.match(/(19|20)\d{2}/g); if(dm){e.end=dm[dm.length-1]; if(dm.length>1)e.start=dm[0];}
      const noDate=l.replace(/,?\s*\(?(19|20)\d{2}\)?.*$/,"").trim();
      const parts=noDate.split(/,\s*/).map(s=>s.trim()).filter(Boolean);
      e.degree=parts[0]||noDate; e.school=parts[1]||""; if(parts[2])e.location=parts[2];
      return e;
    });
    if(!p.education.length) p.education=[emptyEdu()];
  }
  return normalizeProfile(p);
}
const ROLE_KW=/\b(manager|specialist|lead|analyst|engineer|director|consultant|officer|executive|coordinator|associate|developer|designer|writer|strategist|intern|architect|administrator|president|founder|head|supervisor|vp)\b/i;
const MONTH=/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/ig;
const DATEG=/((?:19|20)\d{2}|present|current)/ig;
const BULLET=/^[•\-*·‣◦▪➤»]\s*/;
function parseJobs(sl){
  const jobs=[]; let cur=null;
  const sep=/\s[|•·–—]\s|\s-\s|,\s|\sat\s/i;
  const hasDate=l=>/((?:19|20)\d{2}|present|current)/i.test(l);
  const stripDates=l=>l.replace(DATEG,"").replace(/\(\s*\)/g,"").replace(/\s{2,}/g," ").replace(/[|•·,–—-]\s*$/,"").trim();
  const isLoc=l=>{ const t=l.replace(DATEG,"").replace(MONTH,""); return /,/.test(l) && t.split(/[\s|]+/).filter(Boolean).length<=5 && !ROLE_KW.test(t); };
  const setDates=l=>{ const dm=l.match(DATEG); if(dm){ cur.end=dm[dm.length-1]; if(dm.length>1)cur.start=dm[0]; } };
  const cleanLoc=l=> l.replace(DATEG,"").replace(MONTH,"").replace(/[|–—]+/g," ").replace(/\s*-\s*/g," ").replace(/\s{2,}/g," ").replace(/^[,\s]+|[,\s]+$/g,"").trim();
  function assignHead(l){
    const parts=stripDates(l).split(sep).map(s=>s.trim()).filter(Boolean);
    let role=parts[0]||"", company=parts[1]||"";
    if(company && ROLE_KW.test(company) && !ROLE_KW.test(role)){ const t=role; role=company; company=t; }
    cur.role=role; cur.company=company; if(parts[2]) cur.location=parts[2];
  }
  for(const raw of sl){
    const l=(raw||"").trim(); if(!l) continue;
    if(BULLET.test(l)){ if(!cur) cur=emptyExp(); cur.bullets.push(l.replace(BULLET,"").trim()); continue; }
    const headTxt=stripDates(l);
    // "location + dates" meta line belonging to the current job
    if(cur && !cur.start && !cur.end && hasDate(l) && (headTxt==="" || isLoc(l))){
      setDates(l); const lp=cleanLoc(l); if(!cur.location && lp) cur.location=lp; continue;
    }
    // header (new job) vs plain continuation
    if(sep.test(l) || hasDate(l) || !cur){
      if(cur) jobs.push(cur);
      cur=emptyExp(); setDates(l); assignHead(l);
    } else {
      if(!cur.location && isLoc(l)) cur.location=l; else cur.bullets.push(l);
    }
  }
  if(cur) jobs.push(cur);
  return jobs.filter(j=>j.role||j.company||(j.bullets&&j.bullets.length));
}
const HEADINGS = {
  summary:["summary","professional summary","profile","about","objective"],
  skills:["skills","core competencies","technical skills","key skills","expertise","areas of expertise"],
  experience:["experience","work experience","professional experience","employment","employment history","work history","career"],
  education:["education","academic","qualifications"],
  certifications:["certifications","certificates","licenses","courses","awards"]
};
function headingKey(line){
  const l=line.toLowerCase().replace(/[:\-]+$/,"").trim();
  if(l.length>40) return null;
  for(const [k,arr] of Object.entries(HEADINGS)){ if(arr.includes(l)) return k; }
  return null;
}
function isHeading(line){ return !!headingKey(line); }

/* ============================================================
   Optimizer — inject missing keywords to reach ~100
   ============================================================ */
function buildOptimizedProfile(profile, result, jd, jobTitle){
  const p = JSON.parse(JSON.stringify(normalizeProfile(profile)));
  // 1) skills: add every missing keyword (user reviews/removes untrue ones)
  const existing = new Set(p.skills.map(s=>s.toLowerCase().trim()));
  const added = [];
  result.missing.forEach(m=>{
    const label = titleCase(m.term);
    if(!existing.has(label.toLowerCase())){ p.skills.push(label); existing.add(label.toLowerCase()); added.push(label); }
  });
  // 2) add suggested bullets (missing hard skills) to the most-recent job
  const blocks = buildRecommendations(result, profileToText(profile), jd, jobTitle);
  const bulletBlock = blocks.find(b=>b.bullets);
  if(bulletBlock && p.experience[0]){
    const newBullets = bulletBlock.bullets.map(b=>b.line.replace(/^•\s*/,"").trim());
    p.experience[0].bullets = p.experience[0].bullets.concat(newBullets);
    p._addedBullets = newBullets.length;
  }
  // 3) title alignment: if profile title missing, use JD title
  if(!p.title && jobTitle) p.title = jobTitle;
  p._addedSkills = added;
  return p;
}
function profileToText(p){
  p = normalizeProfile(p);
  const out = [p.name, p.title, [p.email,p.phone,p.location,p.linkedin,p.website].filter(Boolean).join(" | "),
    "SUMMARY", p.summary, "SKILLS", p.skills.join(", "), "EXPERIENCE"];
  p.experience.forEach(e=>{
    out.push([e.role,e.company].filter(Boolean).join(" - ")+" "+[e.location,e.start,e.end].filter(Boolean).join(" "));
    (e.bullets||[]).forEach(b=>out.push("• "+b));
  });
  out.push("EDUCATION");
  p.education.forEach(e=>out.push([e.degree,e.school,e.location,e.start,e.end].filter(Boolean).join(" ")));
  if(p.certifications.length){ out.push("CERTIFICATIONS"); out.push(p.certifications.join(", ")); }
  return out.filter(Boolean).join("\n");
}

/* ============================================================
   DOCX generation (OOXML + hand-rolled store ZIP, no deps)
   ============================================================ */
const STYLE = { font:"Calibri", nameSz:40, titleSz:22, contactSz:18, headingSz:22, bodySz:20,
  roleSz:21, subSz:18, headingColor:"222222", subColor:"595959", margin:1080, contentW:10080 };

function xmlEsc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function R(text,o){ o=o||{};
  const rpr = "<w:rPr>"+(o.b?"<w:b/>":"")+(o.i?"<w:i/>":"")+(o.caps?"<w:caps/>":"")+
    `<w:rFonts w:ascii="${STYLE.font}" w:hAnsi="${STYLE.font}" w:cs="${STYLE.font}"/>`+
    (o.sz?`<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>`:"")+
    (o.color?`<w:color w:val="${o.color}"/>`:"")+"</w:rPr>";
  return `<w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}
const TABR = "<w:r><w:tab/></w:r>";
function P(runs,o){ o=o||{};
  const tabs = o.rightTab?`<w:tabs><w:tab w:val="right" w:pos="${STYLE.contentW}"/></w:tabs>`:"";
  const bdr = o.border?`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="BFBFBF"/></w:pBdr>`:"";
  const ind = o.indent?`<w:ind w:left="${o.indent}" w:hanging="${o.hanging||200}"/>`:"";
  const jc = o.align?`<w:jc w:val="${o.align}"/>`:"";
  const sp = `<w:spacing w:before="${o.before||0}" w:after="${o.after!=null?o.after:120}" w:line="${o.line||240}" w:lineRule="auto"/>`;
  return `<w:p><w:pPr>${jc}${tabs}${bdr}${ind}${sp}</w:pPr>${runs}</w:p>`;
}
function heading(text){ return P(R(text,{b:true,caps:true,sz:STYLE.headingSz,color:STYLE.headingColor}),{border:true,before:160,after:60}); }

function profileToDocxXml(p){
  p = normalizeProfile(p);
  const body = [];
  // header
  if(p.name) body.push(P(R(p.name,{b:true,sz:STYLE.nameSz}),{align:"center",after:20}));
  if(p.title) body.push(P(R(p.title,{sz:STYLE.titleSz,color:STYLE.subColor,caps:true}),{align:"center",after:40}));
  const contact=[p.email,p.phone,p.location,p.linkedin,p.website].filter(Boolean).join("   |   ");
  if(contact) body.push(P(R(contact,{sz:STYLE.contactSz,color:STYLE.subColor}),{align:"center",after:120}));
  // summary
  if(p.summary){ body.push(heading("Summary")); body.push(P(R(p.summary,{sz:STYLE.bodySz}),{after:120})); }
  // skills
  if(p.skills.length){ body.push(heading("Core Competencies"));
    body.push(P(R(p.skills.join("   •   "),{sz:STYLE.bodySz}),{after:120})); }
  // experience
  if(p.experience.some(e=>e.role||e.company)){
    body.push(heading("Professional Experience"));
    p.experience.forEach(e=>{
      if(!(e.role||e.company)) return;
      const dates=[e.start,e.end].filter(Boolean).join(" – ");
      const left = R([e.role,e.company].filter(Boolean).join("  |  "),{b:true,sz:STYLE.roleSz});
      body.push(P(left + (dates?TABR+R(dates,{sz:STYLE.subSz,color:STYLE.subColor}):""),{rightTab:true,after:20}));
      if(e.location) body.push(P(R(e.location,{i:true,sz:STYLE.subSz,color:STYLE.subColor}),{after:40}));
      (e.bullets||[]).forEach(b=>{ if(b&&b.trim()) body.push(P(R("•  ",{sz:STYLE.bodySz})+R(b,{sz:STYLE.bodySz}),{indent:360,hanging:220,after:40})); });
    });
  }
  // education
  if(p.education.some(e=>e.degree||e.school)){
    body.push(heading("Education"));
    p.education.forEach(e=>{
      if(!(e.degree||e.school)) return;
      const dates=[e.start,e.end].filter(Boolean).join(" – ");
      body.push(P(R(e.degree||e.school,{b:true,sz:STYLE.bodySz}) + (dates?TABR+R(dates,{sz:STYLE.subSz,color:STYLE.subColor}):""),{rightTab:true,after:20}));
      const sub=[e.degree?e.school:"",e.location].filter(Boolean).join("  |  ");
      if(sub) body.push(P(R(sub,{sz:STYLE.subSz,color:STYLE.subColor}),{after:60}));
    });
  }
  // certifications
  if(p.certifications.length){ body.push(heading("Certifications"));
    p.certifications.forEach(c=>{ if(c&&c.trim()) body.push(P(R("•  ",{sz:STYLE.bodySz})+R(c,{sz:STYLE.bodySz}),{indent:360,hanging:220,after:40})); }); }

  const sectPr = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="${STYLE.margin}" w:right="${STYLE.margin}" w:bottom="${STYLE.margin}" w:left="${STYLE.margin}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`+
    `<w:body>${body.join("")}${sectPr}</w:body></w:document>`;
}

/* ----- minimal store-only ZIP (no compression) + CRC32 ----- */
const _crcTable=(function(){ const t=[]; for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; } return t; })();
function crc32(buf){ let c=0^-1; for(let i=0;i<buf.length;i++) c=(c>>>8)^_crcTable[(c^buf[i])&0xFF]; return (c^-1)>>>0; }
function u8(str){ return new TextEncoder().encode(str); }
function zipStore(files){
  const enc=[]; const central=[]; let offset=0;
  const parts=[];
  function w16(a,v){ a.push(v&0xFF,(v>>>8)&0xFF); }
  function w32(a,v){ a.push(v&0xFF,(v>>>8)&0xFF,(v>>>16)&0xFF,(v>>>24)&0xFF); }
  for(const f of files){
    const nameBytes=u8(f.name); const data=f.data;
    const crc=crc32(data);
    const lh=[]; w32(lh,0x04034b50); w16(lh,20); w16(lh,0); w16(lh,0); w16(lh,0); w16(lh,0);
    w32(lh,crc); w32(lh,data.length); w32(lh,data.length); w16(lh,nameBytes.length); w16(lh,0);
    const lhu=new Uint8Array(lh);
    parts.push(lhu, nameBytes, data);
    const ch=[]; w32(ch,0x02014b50); w16(ch,20); w16(ch,20); w16(ch,0); w16(ch,0); w16(ch,0); w16(ch,0);
    w32(ch,crc); w32(ch,data.length); w32(ch,data.length); w16(ch,nameBytes.length); w16(ch,0); w16(ch,0); w16(ch,0); w16(ch,0); w32(ch,0); w32(ch,offset);
    central.push(new Uint8Array(ch), nameBytes);
    offset += lhu.length + nameBytes.length + data.length;
  }
  const cstart=offset; let csize=0; central.forEach(a=>csize+=a.length);
  const eocd=[]; w32(eocd,0x06054b50); w16(eocd,0); w16(eocd,0); w16(eocd,files.length); w16(eocd,files.length); w32(eocd,csize); w32(eocd,cstart); w16(eocd,0);
  const all=[...parts,...central,new Uint8Array(eocd)];
  let total=0; all.forEach(a=>total+=a.length);
  const out=new Uint8Array(total); let pos=0; all.forEach(a=>{ out.set(a,pos); pos+=a.length; });
  return out;
}
function buildDocxBlob(p){
  const files=[
    {name:"[Content_Types].xml", data:u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)},
    {name:"_rels/.rels", data:u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)},
    {name:"word/document.xml", data:u8(profileToDocxXml(p))}
  ];
  const bytes=zipStore(files);
  return new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}
function downloadDocx(p, filename){
  const blob=buildDocxBlob(p);
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=filename||"Resume.docx"; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ============================================================
   UI
   ============================================================ */
let LAST = null; // {result, resumeText, jd, jobTitle}

function renderProfileEditor(){
  const m=document.getElementById("profileMount"); if(!m) return;
  const p=PROFILE;
  const inp=(k,ph,val)=>`<label class="field"><span>${ph}</span><input type="text" data-k="${k}" value="${xmlEsc(val||"")}" placeholder="${ph}"/></label>`;
  const expHtml=p.experience.map((e,i)=>`
    <div class="sub-block">
      <div class="sub-head"><strong>Job ${i+1}</strong><button class="btn ghost small" data-act="delExp" data-i="${i}" type="button">Remove</button></div>
      <div class="grid2">
        <label class="field"><span>Role / Title</span><input type="text" data-sec="experience" data-i="${i}" data-k="role" value="${xmlEsc(e.role)}"/></label>
        <label class="field"><span>Company</span><input type="text" data-sec="experience" data-i="${i}" data-k="company" value="${xmlEsc(e.company)}"/></label>
        <label class="field"><span>Location</span><input type="text" data-sec="experience" data-i="${i}" data-k="location" value="${xmlEsc(e.location)}"/></label>
        <div class="grid2">
          <label class="field"><span>Start</span><input type="text" data-sec="experience" data-i="${i}" data-k="start" value="${xmlEsc(e.start)}" placeholder="Jan 2021"/></label>
          <label class="field"><span>End</span><input type="text" data-sec="experience" data-i="${i}" data-k="end" value="${xmlEsc(e.end)}" placeholder="Present"/></label>
        </div>
      </div>
      <label class="field"><span>Bullet points (one per line)</span><textarea rows="4" data-sec="experience" data-i="${i}" data-k="bullets" placeholder="Led technical SEO audits across 200 pages...">${xmlEsc((e.bullets||[]).join("\n"))}</textarea></label>
    </div>`).join("");
  const eduHtml=p.education.map((e,i)=>`
    <div class="sub-block">
      <div class="sub-head"><strong>Education ${i+1}</strong><button class="btn ghost small" data-act="delEdu" data-i="${i}" type="button">Remove</button></div>
      <div class="grid2">
        <label class="field"><span>Degree</span><input type="text" data-sec="education" data-i="${i}" data-k="degree" value="${xmlEsc(e.degree)}"/></label>
        <label class="field"><span>School</span><input type="text" data-sec="education" data-i="${i}" data-k="school" value="${xmlEsc(e.school)}"/></label>
        <label class="field"><span>Location</span><input type="text" data-sec="education" data-i="${i}" data-k="location" value="${xmlEsc(e.location)}"/></label>
        <label class="field"><span>Year</span><input type="text" data-sec="education" data-i="${i}" data-k="end" value="${xmlEsc(e.end)}"/></label>
      </div>
    </div>`).join("");
  m.innerHTML=`
    <div class="grid2">
      ${inp("name","Full name",p.name)}
      ${inp("title","Professional title",p.title)}
      ${inp("email","Email",p.email)}
      ${inp("phone","Phone",p.phone)}
      ${inp("location","Location",p.location)}
      ${inp("linkedin","LinkedIn URL",p.linkedin)}
    </div>
    ${inp("website","Website / portfolio (optional)",p.website)}
    <label class="field"><span>Professional summary</span><textarea rows="3" data-k="summary" placeholder="Senior SEO Manager with 6+ years...">${xmlEsc(p.summary)}</textarea></label>
    <label class="field"><span>Skills (comma or newline separated)</span><textarea rows="3" data-k="skills" placeholder="SEO, technical SEO, keyword research, Google Analytics...">${xmlEsc(p.skills.join(", "))}</textarea></label>
    <h3 class="sub-title">Experience</h3>${expHtml}
    <button class="btn ghost small" data-act="addExp" type="button">+ Add job</button>
    <h3 class="sub-title">Education</h3>${eduHtml}
    <button class="btn ghost small" data-act="addEdu" type="button">+ Add education</button>
    <label class="field"><span>Certifications (one per line)</span><textarea rows="2" data-k="certifications" placeholder="Google Analytics Certified&#10;SEMrush SEO Toolkit">${xmlEsc(p.certifications.join("\n"))}</textarea></label>
    <div class="row end" style="gap:8px;margin-top:12px">
      <button class="btn ghost small" data-act="import" type="button">Import from my resume text</button>
      <button class="btn primary small" data-act="save" type="button">Save profile</button>
    </div>
    <p id="profileMsg" class="parse-msg"></p>`;
}

function wireProfile(){
  const m=document.getElementById("profileMount"); if(!m) return;
  m.addEventListener("input", e=>{
    const t=e.target, k=t.dataset.k, sec=t.dataset.sec;
    if(sec){ const o=PROFILE[sec][+t.dataset.i]; if(!o) return;
      if(k==="bullets") o.bullets=t.value.split("\n").map(s=>s.replace(/^[•\-*]\s*/,"").trim()).filter(Boolean);
      else o[k]=t.value;
    } else if(k==="skills"){ PROFILE.skills=t.value.split(/[,;\n]/).map(s=>s.trim()).filter(Boolean); }
    else if(k==="certifications"){ PROFILE.certifications=t.value.split("\n").map(s=>s.trim()).filter(Boolean); }
    else if(k){ PROFILE[k]=t.value; }
    scheduleSave();
  });
  m.addEventListener("click", e=>{
    const a=e.target.closest("[data-act]"); if(!a) return;
    const act=a.dataset.act;
    if(act==="addExp"){ PROFILE.experience.push(emptyExp()); saveProfile(); renderProfileEditor(); }
    else if(act==="delExp"){ PROFILE.experience.splice(+a.dataset.i,1); if(!PROFILE.experience.length)PROFILE.experience=[emptyExp()]; saveProfile(); renderProfileEditor(); }
    else if(act==="addEdu"){ PROFILE.education.push(emptyEdu()); saveProfile(); renderProfileEditor(); }
    else if(act==="delEdu"){ PROFILE.education.splice(+a.dataset.i,1); if(!PROFILE.education.length)PROFILE.education=[emptyEdu()]; saveProfile(); renderProfileEditor(); }
    else if(act==="save"){ saveProfile(); toast("Profile saved"); setProfileMsg("Profile saved ✓","ok"); }
    else if(act==="import"){
      const txt=store.get(LS.resume)||"";
      if(!txt.trim()){ setProfileMsg("No saved resume text to import — add your resume above first, or fill the fields.","err"); return; }
      PROFILE=importFromText(txt); saveProfile(); renderProfileEditor();
      setProfileMsg("Imported from your resume text — please review each field for accuracy.","ok");
    }
  });
}
function setProfileMsg(msg,cls){ const el=document.getElementById("profileMsg"); if(el){ el.textContent=msg; el.className="parse-msg "+(cls||""); } }

/* make sure the profile is populated from the saved resume (no manual step) */
function ensureProfile(resumeText){
  if(profileHasContent(PROFILE)) return true;
  const txt = (resumeText && resumeText.trim()) ? resumeText : (savedResumeText()||"");
  if(txt && txt.trim()){ PROFILE=importFromText(txt); saveProfile(); renderProfileEditor(); return profileHasContent(PROFILE); }
  return false;
}
function savedResumeText(){
  try{ return (typeof store!=="undefined"&&typeof LS!=="undefined") ? store.get(LS.resume) : localStorage.getItem("ats_resume_v1"); }
  catch(e){ return null; }
}

/* called by app.js when a resume is saved — auto-build the profile from it */
function onResumeSaved(text){
  if(!text || !text.trim()) return;
  PROFILE = importFromText(text);
  saveProfile(); renderProfileEditor();
  const b=document.getElementById("profileBody"); if(b) b.classList.remove("hidden");
  const t=document.getElementById("profileToggle"); if(t) t.textContent="Collapse";
  setProfileMsg("Auto-filled from your resume — it's ready. Review the fields anytime; you don't have to fill anything.","ok");
}

/* called by app.js after a score is produced */
function onScore(result, resumeText, jd, jobTitle){
  LAST={result,resumeText,jd,jobTitle};
  const card=document.getElementById("optimizedCard"); if(!card) return;
  card.classList.remove("hidden");
  const help=document.getElementById("optimizedHelp");
  const proj=document.getElementById("projectedScore");
  const btn=document.getElementById("downloadDocxBtn");

  ensureProfile(resumeText);
  if(!profileHasContent(PROFILE)){
    proj.textContent="Add resume"; proj.className="pill muted";
    help.innerHTML="Add your resume in step 1 above and run the check — your optimized Word resume is built automatically from it.";
    if(btn) btn.disabled=true;
    return;
  }
  if(btn) btn.disabled=false;
  const opt=buildOptimizedProfile(PROFILE, result, jd, jobTitle);
  const projected=scoreResume(profileToText(opt), jd, jobTitle);
  proj.textContent="Projected: "+projected.overall+"%";
  proj.className = projected.overall>=98?"pill ok":"pill";
  const nAdd=(opt._addedSkills||[]).length, nB=opt._addedBullets||0;
  help.innerHTML=`Built automatically from your saved resume, with <strong>${nAdd}</strong> missing keyword${nAdd===1?"":"s"} added to your Skills`+
    (nB?` and <strong>${nB}</strong> suggested bullet${nB===1?"":"s"} added to your most recent role`:"")+
    `. Click download, then open it, replace any <code>[brackets]</code> with real numbers, and delete anything not true for you.`;
}

function doDownload(){
  if(!ensureProfile(LAST?LAST.resumeText:null)){
    toast("Add your resume in step 1 first");
    const pc=document.getElementById("resumeCard"); if(pc) pc.scrollIntoView({behavior:"smooth"});
    const msg=document.getElementById("optimizedMsg"); if(msg){ msg.textContent="No resume found — add your resume in step 1, then run the check."; msg.className="parse-msg err"; }
    return;
  }
  const L = LAST || {result:scoreResume(profileToText(PROFILE),"",""), jd:"", jobTitle:""};
  const opt=buildOptimizedProfile(PROFILE, L.result, L.jd, L.jobTitle);
  const safe=(PROFILE.name||"Resume").replace(/[^a-z0-9]+/gi,"_").replace(/^_|_$/g,"");
  const role=(L.jobTitle||"").replace(/[^a-z0-9]+/gi,"_").replace(/^_|_$/g,"");
  const date=new Date().toISOString().slice(0,10);
  const fn=[safe, role, date].filter(Boolean).join("_")+".docx";
  try{ downloadDocx(opt, fn);
    const msg=document.getElementById("optimizedMsg"); if(msg){ msg.textContent="Downloaded "+fn+" — open & review it."; msg.className="parse-msg ok"; }
  }catch(e){ const msg=document.getElementById("optimizedMsg"); if(msg){ msg.textContent="Could not generate file: "+e.message; msg.className="parse-msg err"; } }
}

function initResume(){
  renderProfileEditor(); wireProfile();
  const tgl=document.getElementById("profileToggle");
  if(tgl) tgl.onclick=()=>{ const b=document.getElementById("profileBody"); const show=b.classList.contains("hidden");
    b.classList.toggle("hidden"); tgl.textContent=show?"Collapse":"Expand"; };
  const dl=document.getElementById("downloadDocxBtn"); if(dl) dl.onclick=doDownload;
  const ep=document.getElementById("editProfileBtn"); if(ep) ep.onclick=()=>{
    document.getElementById("profileBody").classList.remove("hidden");
    const t=document.getElementById("profileToggle"); if(t)t.textContent="Collapse";
    document.getElementById("profileCard").scrollIntoView({behavior:"smooth"}); };
  // auto-fill the profile from an already-saved resume (covers resumes saved before this update)
  if(!profileHasContent(PROFILE)){
    const rt=savedResumeText();
    if(rt && rt.trim()){ PROFILE=importFromText(rt); saveProfile(); renderProfileEditor(); }
  }
  // if still empty, nudge the user to add a resume
  if(!profileHasContent(PROFILE)){ const b=document.getElementById("profileBody"); if(b){ b.classList.remove("hidden"); if(tgl)tgl.textContent="Collapse"; } }
}

window.Resume = { onScore, initResume };
document.addEventListener("DOMContentLoaded", initResume);
