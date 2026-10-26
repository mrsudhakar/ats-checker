/* ============================================================
   ATS Score Checker — core logic (100% client-side)
   ============================================================ */
"use strict";

/* ---------- storage keys ---------- */
const LS = {
  resume:"ats_resume_v1", resumeName:"ats_resume_name_v1",
  jd:"ats_jd_v1", jobTitle:"ats_jobtitle_v1", theme:"ats_theme_v1",
  aiProvider:"ats_ai_provider", aiModel:"ats_ai_model", aiKey:"ats_ai_key"
};
const $ = (id)=>document.getElementById(id);
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};

/* ---------- text normalization ---------- */
function normalize(text){
  let t = (text||"").toLowerCase();
  // unify British/American spelling and common variants
  t = t.replace(/optimis/g,"optimiz").replace(/analys/g,"analyz").replace(/organis/g,"organiz")
       .replace(/maximis/g,"maximiz").replace(/minimis/g,"minimiz").replace(/prioritis/g,"prioritiz")
       .replace(/specialis/g,"specializ").replace(/personalis/g,"personaliz").replace(/categoris/g,"categoriz")
       .replace(/behaviour/g,"behavior").replace(/colour/g,"color").replace(/centre/g,"center")
       .replace(/[‘’]/g,"'").replace(/[“”]/g,'"');
  // keep letters, numbers, and a few symbols meaningful to skills (+ . # /)
  t = t.replace(/[^a-z0-9+.#/ \n]/g," ");
  // drop . # / that sit at a token boundary (sentence periods, stray slashes) but
  // keep them INSIDE tokens like node.js, robots.txt, a/b, c#  ("link building." -> "link building")
  t = t.replace(/([./]+)(?=\s|\n|$)/g," ").replace(/(^|[\s\n])[./]+/g,"$1");
  t = t.replace(/[ \t]+/g," ");
  return t;
}
function padded(text){ return " "+normalize(text).replace(/\n/g," ")+" "; }
function wordCount(text){ return (normalize(text).match(/[a-z0-9]+/g)||[]).length; }

/* phrase present as a whole word/phrase? */
function contains(hay, phrase){
  const p = " "+normalize(phrase)+" ";
  return hay.indexOf(p) !== -1;
}
function skillPresent(hay, canonical){
  if (contains(hay, canonical)) return true;
  const info = SKILL_INDEX[canonical];
  if (info && info.aliases) for (const a of info.aliases){ if (contains(hay,a)) return true; }
  return false;
}

/* ============================================================
   JD keyword extraction
   ============================================================ */
function extractJdKeywords(jd, jobTitle){
  const hay = padded(jd);
  const titleHay = " "+normalize(jobTitle||"")+" ";
  const found = [];

  // 1) dictionary skills present in JD
  for (const s of ALL_SKILLS){
    if (skillPresent(hay, s.name)){
      // frequency
      const re = new RegExp("(?:^| )"+escapeRe(normalize(s.name))+"(?= |$)","g");
      const freq = (hay.match(re)||[]).length || 1;
      const inTitle = titleHay.indexOf(" "+normalize(s.name)+" ")!==-1;
      found.push({ term:s.name, category:s.category, isHard:!s.isSoft, isSoft:s.isSoft, freq, inTitle, source:"dict" });
    }
  }
  const have = new Set(found.map(f=>f.term));
  // alias set so generic extraction doesn't re-add a synonym of a dict skill already found
  const foundAliases = new Set();
  for (const f of found){
    foundAliases.add(f.term);
    (SKILL_INDEX[f.term]?.aliases||[]).forEach(a=>foundAliases.add(normalize(a).trim()));
  }

  // 2) generic extractor — frequent capitalized / repeated terms the dictionary missed
  const generic = genericKeywords(jd);
  for (const g of generic){
    if (have.has(g.term) || foundAliases.has(g.term)) continue;
    // skip if it's a sub-phrase already covered
    if ([...have].some(h=>h.includes(g.term) || g.term.includes(h))) continue;
    found.push({ term:g.term, category:"Other keyword", isHard:true, isSoft:false, freq:g.freq, inTitle:false, source:"generic" });
    have.add(g.term);
  }

  // weight each keyword
  for (const f of found){
    let w = 1;
    w += Math.min(f.freq-1, 3) * 0.6;        // repetition in JD
    if (f.isHard) w += 1.4;                    // hard skills matter more
    if (f.inTitle) w += 2;                     // appears in the role title
    if (f.source==="generic") w *= 0.7;        // dictionary terms trusted more
    f.weight = Math.round(w*100)/100;
  }
  // sort by weight desc
  found.sort((a,b)=>b.weight-a.weight);
  return found;
}

function escapeRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }

function genericKeywords(jd){
  // unigrams + bigrams, keep repeated meaningful tokens / capitalized proper nouns
  const rawLines = jd.split(/\n/);
  const capitals = new Set();
  // capture Capitalized proper nouns (likely tools/brands) from original text
  (jd.match(/\b([A-Z][a-zA-Z0-9.+#]{2,}(?:\s[A-Z][a-zA-Z0-9.+#]{2,})?)\b/g)||[]).forEach(m=>{
    const low = normalize(m).trim();
    if (low && !STOPWORDS.has(low)) capitals.add(low);
  });
  const norm = normalize(jd);
  const tokens = (norm.match(/[a-z0-9][a-z0-9+.#/]*/g)||[]).filter(t=>t.length>2 && !STOPWORDS.has(t));
  const freq = {};
  tokens.forEach(t=>freq[t]=(freq[t]||0)+1);
  // bigrams
  const bi = {};
  for (let i=0;i<tokens.length-1;i++){
    const b = tokens[i]+" "+tokens[i+1];
    bi[b]=(bi[b]||0)+1;
  }
  const out = [];
  const pushed = new Set();
  // capitalized proper nouns appearing in text (likely tool/brand names the dictionary missed)
  capitals.forEach(c=>{
    const words = c.split(" ");
    // drop anything containing a stopword / role / verb word
    if (words.some(w=>STOPWORDS.has(w))) return;
    const f = freq[c] || (bi[c]||0) || 1;
    const multiword = words.length>1;
    // single words only if they repeat or look like an acronym/tech token (digit/#/.)
    if (!multiword && f<2 && !/[0-9#.]/.test(c)) return;
    if (!pushed.has(c)){ out.push({term:c, freq:f}); pushed.add(c); }
  });
  // repeated bigrams
  Object.entries(bi).filter(([,c])=>c>=2).forEach(([b,c])=>{
    if (pushed.has(b)) return;
    const [w1,w2]=b.split(" ");
    if (STOPWORDS.has(w1)||STOPWORDS.has(w2)) return;
    out.push({term:b, freq:c}); pushed.add(b);
  });
  // repeated unigrams (>=3 to be safe)
  Object.entries(freq).filter(([,c])=>c>=3).forEach(([t,c])=>{
    if (pushed.has(t)) return;
    if ([...pushed].some(p=>p.includes(t))) return;
    out.push({term:t, freq:c}); pushed.add(t);
  });
  return out.slice(0,18);
}

/* ============================================================
   Scoring
   ============================================================ */
function scoreResume(resume, jd, jobTitle){
  const resumeHay = padded(resume);
  const keywords = extractJdKeywords(jd, jobTitle);

  // keyword match
  let totalW=0, matchedW=0;
  for (const k of keywords){
    totalW += k.weight;
    k.matched = k.source==="generic" ? contains(resumeHay,k.term) : skillPresent(resumeHay,k.term);
    if (k.matched) matchedW += k.weight;
  }
  const keywordScore = totalW ? Math.round(100*matchedW/totalW) : 0;

  // title match
  const titleScore = computeTitleScore(resume, jd, jobTitle);

  // formatting
  const fmt = formattingChecks(resume);
  const formatScore = fmt.score;

  const overall = Math.round(keywordScore*0.75 + formatScore*0.15 + titleScore*0.10);

  return {
    overall:Math.min(overall,100), keywordScore, titleScore, formatScore,
    keywords, fmt,
    missing: keywords.filter(k=>!k.matched),
    matched: keywords.filter(k=>k.matched)
  };
}

function computeTitleScore(resume, jd, jobTitle){
  let title = (jobTitle||"").trim();
  if (!title){
    // try to detect from JD
    const m = jd.match(/\b(?:job title|position|role)\s*[:\-]\s*(.+)/i);
    if (m) title = m[1].trim();
    else { const first = jd.split(/\n/).map(s=>s.trim()).filter(Boolean)[0]||""; if (first.length<=60) title = first; }
  }
  if (!title) return 70; // neutral if unknown
  const resumeHay = padded(resume);
  if (contains(resumeHay, title)) return 100;
  const words = normalize(title).split(" ").filter(w=>w.length>2 && !STOPWORDS.has(w));
  if (!words.length) return 70;
  const hit = words.filter(w=>contains(resumeHay,w)).length;
  return Math.round(100*hit/words.length);
}

function formattingChecks(resume){
  const raw = resume||"";
  const hay = padded(resume);
  const wc = wordCount(resume);
  const checks = [];
  const add=(ok,label,fix,critical=true,state)=>checks.push({state: state||(ok?"pass":"fail"), label, fix, critical});

  const hasEmail = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i.test(raw);
  add(hasEmail,"Email address present", "Add a professional email in the header (e.g. name@email.com).");

  const hasPhone = /(\+?\d[\d\s().\-]{7,}\d)/.test(raw);
  add(hasPhone,"Phone number present","Add a phone number in your header.");

  const hasLinkedin = /linkedin\.com\//i.test(raw) || contains(hay,"linkedin");
  add(hasLinkedin,"LinkedIn / portfolio link","Add your LinkedIn URL — recruiters and ATS look for it.",false);

  const secExp = contains(hay,"experience")||contains(hay,"employment")||contains(hay,"work history");
  add(secExp,"Work Experience section","Add a clearly titled \"Work Experience\" section.");
  const secEdu = contains(hay,"education")||contains(hay,"degree")||contains(hay,"bachelor")||contains(hay,"master");
  add(secEdu,"Education section","Add an \"Education\" section.",false);
  const secSkills = contains(hay,"skills")||contains(hay,"core competencies");
  add(secSkills,"Skills section","Add a \"Skills\" / \"Core Competencies\" section — this is where most keyword matching happens.");

  // quantified achievements
  const metricHits = (raw.match(/\b\d+(?:[.,]\d+)?\s?%|\b(?:[$€£₹])\s?\d|\b\d{2,}\b/g)||[]).length;
  add(metricHits>=3,"Quantified achievements","Add numbers/metrics to bullets (e.g. \"grew organic traffic 180%\"). Aim for 3+.",true,
      metricHits>=3?"pass":(metricHits>=1?"warn":"fail"));

  // action verbs at start of lines
  const lines = raw.split(/\n/).map(l=>l.trim()).filter(l=>l.length>8);
  const verbRe = new RegExp("^(?:[•\\-*]\\s*)?("+ACTION_VERBS.join("|")+")\\b","i");
  const verbLines = lines.filter(l=>verbRe.test(l)).length;
  add(verbLines>=3,"Strong action verbs","Start bullets with action verbs (Led, Drove, Optimized, Increased…).",false,
      verbLines>=3?"pass":"warn");

  // length
  let lenState="pass", lenFix="Length looks good (roughly 1–2 pages).";
  if (wc<250){ lenState="fail"; lenFix="Resume looks short ("+wc+" words). Add detail/achievements — aim for ~400–900 words."; }
  else if (wc>1100){ lenState="warn"; lenFix="Resume is long ("+wc+" words). Trim to the most relevant 1–2 pages."; }
  add(lenState==="pass","Appropriate length ("+wc+" words)", lenFix, false, lenState);

  // first-person pronouns
  const fp = (normalize(resume).match(/\b(i|me|my|myself)\b/g)||[]).length;
  add(fp<=2,"No first-person pronouns","Remove \"I / my\" — resumes should be written in implied first person.",false, fp<=2?"pass":"warn");

  // tables/graphics note (cannot detect in text — advisory)
  checks.push({state:"warn", label:"Simple, single-column, text layout", critical:false,
    fix:"ATS parsers choke on tables, columns, text boxes, headers/footers, and images. Use a simple single-column layout and a standard font. Save/submit as .docx or a text-based PDF (not a scanned image)."});

  // score: critical pass = full, warn = half, fail = 0 ; non-critical weighted less
  let s=0, tot=0;
  for (const c of checks){
    const w = c.critical?2:1;
    tot += w;
    s += (c.state==="pass"?w : c.state==="warn"?w*0.5 : 0);
  }
  return { score: Math.round(100*s/tot), checks };
}

/* ============================================================
   Recommendations (ready-to-paste content)
   ============================================================ */
const BULLET_TEMPLATES = {
  "Tools & Platforms": [
    "Leveraged {S} to {ACT} [process], [result — e.g. cutting reporting time 40% / surfacing X issues].",
    "Used {S} to analyze [data] and {ACT} data-driven decisions that [outcome, e.g. lifted CTR 25%]."
  ],
  "Core SEO": [
    "{VERB} {S} across [N pages/sites], improving [organic traffic/rankings] by [X]% in [timeframe].",
    "Owned {S} strategy that drove [X]% growth in [organic sessions/qualified leads] over [period]."
  ],
  "AEO / GEO / AI Search": [
    "{VERB} {S} to increase brand visibility in AI Overviews/ChatGPT/Perplexity, earning [N] AI citations.",
    "Implemented {S} (llms.txt, structured data, citable content) that grew AI-driven traffic by [X]%."
  ],
  "Content": [
    "{VERB} a {S} program producing [N] assets/month that generated [X] organic sessions and [Y] leads.",
    "Built {S} aligned to search intent, increasing [engagement/conversions] by [X]%."
  ],
  "Analytics & CRO": [
    "{VERB} {S} using [GA4/Looker Studio], uncovering insights that improved [conversion rate] by [X]%.",
    "Ran {S} that lifted [key metric] from [A] to [B] across [N] experiments."
  ],
  "Paid & Other Channels": [
    "Managed {S} with a [$X] budget, achieving [Y] ROAS / [Z]% lower CPA.",
    "{VERB} {S} campaigns that generated [N] leads at [$X] cost-per-lead."
  ],
  "Web & CMS": [
    "{VERB} and optimized [pages/templates] in {S}, improving Core Web Vitals and page speed by [X]%.",
    "Used {S} to build/optimize [landing pages] that increased [conversions] by [X]%."
  ],
  "Process & Leadership": [
    "{VERB} {S} across [N] stakeholders/teams to deliver [project] on time and within budget.",
    "Applied {S} to coordinate [initiative], accelerating delivery by [X]%."
  ],
  "Other keyword": [
    "{VERB} initiatives involving {S}, delivering [measurable result].",
    "Applied {S} to [task], resulting in [quantified outcome]."
  ]
};

function pickVerb(i){ return ACTION_VERBS[i % ACTION_VERBS.length]; }

function buildRecommendations(result, resume, jd, jobTitle){
  const blocks = [];
  const missingHard = result.missing.filter(m=>m.isHard);
  const missingSoft = result.missing.filter(m=>m.isSoft);

  // 1) Skills section block
  const matchedHard = result.matched.filter(m=>m.isHard).map(m=>titleCase(m.term));
  const addHard = missingHard.map(m=>titleCase(m.term));
  const skillLine = [...new Set([...matchedHard, ...addHard])];
  if (skillLine.length){
    blocks.push({
      title:"Updated Skills / Core Competencies section",
      sub:"Paste this into your Skills section. Keep only skills that are genuinely true for you; it uses exact JD phrasing so the ATS matches it.",
      copy: "Core Competencies: " + skillLine.join(" · "),
      pre:true
    });
  }

  // 2) Professional summary
  const title = (jobTitle||detectTitle(jd)||"Marketing Professional").trim();
  const topKw = [...matchedHard.slice(0,3), ...addHard.slice(0,3)].slice(0,5);
  const summary =
`${title} with [X]+ years driving measurable growth through ${topKw.slice(0,3).map(s=>s.toLowerCase()).join(", ")||"SEO and content"}. `+
`Proven track record of ${addHard[0]?("delivering "+addHard[0].toLowerCase()+" and "):""}improving organic performance — [e.g. grew traffic X% / ranked N keywords on page 1]. `+
`Skilled in ${topKw.join(", ")}.`;
  blocks.push({
    title:"Tailored Professional Summary",
    sub:"Replace your summary with this (fill the [brackets] with your real numbers).",
    copy:summary, pre:true
  });

  // 3) Bullet rewrites for missing hard skills
  if (missingHard.length){
    const bullets = missingHard.slice(0,8).map((m,i)=>{
      const tmpls = BULLET_TEMPLATES[m.category] || BULLET_TEMPLATES["Other keyword"];
      let t = tmpls[i % tmpls.length];
      const line = t.replace(/\{S\}/g, titleCase(m.term)).replace(/\{VERB\}/g, pickVerb(i)).replace(/\{ACT\}/g, pickVerb(i+3).toLowerCase());
      return { kw:titleCase(m.term), line:"• "+line };
    });
    blocks.push({ title:"Bullet points to add (one per missing skill)",
      sub:"Drop these into the most relevant job in your Experience section and fill the [brackets] with real results.",
      bullets });
  }

  // 4) Soft skills note
  if (missingSoft.length){
    blocks.push({
      title:"Soft skills to weave in",
      sub:"The JD mentions these. Demonstrate them inside achievement bullets rather than just listing them.",
      copy: missingSoft.map(m=>titleCase(m.term)).join(" · "), pre:true
    });
  }

  return blocks;
}

function detectTitle(jd){
  const m = jd.match(/\b(?:job title|position|role)\s*[:\-]\s*(.+)/i);
  if (m) return m[1].split(/[\n|]/)[0].trim();
  const first = jd.split(/\n/).map(s=>s.trim()).filter(Boolean)[0]||"";
  return first.length<=60 ? first : "";
}
function titleCase(s){
  // keep known acronyms uppercase
  const acr = new Set(["seo","sem","ppc","cro","aeo","geo","ga4","gsc","gtm","cms","ai","kpi","roi","roas","html","css","sql","cwv","ux","b2b","b2c"]);
  return s.split(" ").map(w=> acr.has(w)? w.toUpperCase() : w.charAt(0).toUpperCase()+w.slice(1)).join(" ");
}

/* ============================================================
   Rendering
   ============================================================ */
function renderResults(result, resume, jd, jobTitle){
  $("results").classList.remove("hidden");

  // gauge
  const score = result.overall;
  $("scoreNum").textContent = score;
  const circ = 2*Math.PI*52;
  const fg = $("gaugeFg");
  fg.style.strokeDasharray = circ;
  requestAnimationFrame(()=>{ fg.style.strokeDashoffset = circ*(1-score/100); });
  let col = "var(--bad)", verdict="Needs work";
  if (score>=98){ col="var(--ok)"; verdict="Excellent — apply!"; }
  else if (score>=90){ col="var(--ok)"; verdict="Strong match"; }
  else if (score>=75){ col="var(--warn)"; verdict="Good — tune it"; }
  else if (score>=50){ col="var(--warn)"; verdict="Partial match"; }
  fg.style.stroke = col;
  const v=$("scoreVerdict"); v.textContent=verdict; v.style.color=col;

  // breakdown
  $("scoreBreakdown").innerHTML = [
    bdRow("Keyword match", result.keywordScore),
    bdRow("Title alignment", result.titleScore),
    bdRow("ATS formatting", result.formatScore)
  ].join("");

  // missing chips
  $("missingCount").textContent = result.missing.length + " missing";
  $("missingList").innerHTML = result.missing.length
    ? result.missing.map(m=>{
        const cls = m.isSoft?"soft":"hard";
        return `<span class="chip ${cls}" data-term="${esc(titleCase(m.term))}" title="Click to copy">${esc(titleCase(m.term))} <span class="w">w${m.weight}</span></span>`;
      }).join("")
    : `<span class="pill ok">No missing keywords — great alignment!</span>`;

  // recommendations
  const blocks = buildRecommendations(result, resume, jd, jobTitle);
  $("recoBlocks").innerHTML = blocks.map((b,i)=>renderReco(b,i)).join("");

  // formatting checklist
  $("formatChecklist").innerHTML = result.fmt.checks.map(c=>{
    const ic = c.state==="pass"?"✓":c.state==="warn"?"!":"✗";
    const cls = c.state==="pass"?"pass":c.state==="warn"?"warn":"fail";
    const fix = c.state==="pass" ? "" : `<div class="fix">${esc(c.fix)}</div>`;
    return `<li><span class="check-ic ${cls}">${ic}</span><div><div>${esc(c.label)}</div>${fix}</div></li>`;
  }).join("");

  // keyword table
  $("keywordTableWrap").innerHTML = renderKeywordTable(result.keywords);

  // wire copy chips & buttons
  wireCopyChips();
  $("results").scrollIntoView({behavior:"smooth", block:"start"});
}

function bdRow(label,val){
  return `<div class="bd-row"><span class="bd-label">${label}</span>
    <span class="bd-bar"><span class="bd-fill" style="width:${val}%"></span></span>
    <span class="bd-val">${val}%</span></div>`;
}
function renderReco(b,i){
  let body;
  if (b.bullets){
    body = `<div>`+b.bullets.map(x=>`<div class="bullet-item"><span class="kw">${esc(x.kw)}:</span> ${esc(x.line)}</div>`).join("")+`</div>`;
  } else {
    body = `<pre>${esc(b.copy)}</pre>`;
  }
  const copyData = b.bullets ? b.bullets.map(x=>x.line).join("\n") : b.copy;
  return `<div class="reco">
    <h3>${esc(b.title)} <button class="btn ghost copy" data-copy="${esc(copyData)}">Copy</button></h3>
    ${b.sub?`<p class="sub">${esc(b.sub)}</p>`:""}
    ${body}
  </div>`;
}
function renderKeywordTable(keywords){
  const rows = keywords.map(k=>`<tr>
     <td>${esc(titleCase(k.term))}</td>
     <td>${k.isSoft?"Soft":"Hard"}</td>
     <td>${k.weight}</td>
     <td>${k.matched?'<span class="yes">✓ in resume</span>':'<span class="no">✗ missing</span>'}</td>
   </tr>`).join("");
  return `<table><thead><tr><th>Keyword</th><th>Type</th><th>Weight</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ============================================================
   AI rewrite (optional, user's own key)
   ============================================================ */
async function runAi(resume, jd, jobTitle){
  const provider = store.get(LS.aiProvider)||"anthropic";
  const key = store.get(LS.aiKey)||"";
  let model = store.get(LS.aiModel) || (provider==="anthropic"?"claude-opus-5-5":"gpt-4o-mini");
  const card=$("aiResultCard"), out=$("aiOutput"), status=$("aiStatus");
  card.classList.remove("hidden");
  if (!key){ status.textContent="No API key"; status.className="pill muted";
    out.innerHTML="Add your API key in <strong>AI settings</strong> to enable AI rewrites."; return; }
  status.textContent="Generating…"; status.className="pill"; out.innerHTML='<p class="muted">Contacting '+provider+'…</p>';

  const prompt =
`You are an expert ATS resume optimizer for SEO/digital-marketing roles. Given the RESUME and JOB DESCRIPTION, produce a concise, directly usable optimization in markdown with these sections:
1. **Honest ATS score** (0-100) and the 3 biggest gaps.
2. **Prioritized missing keywords** to add (only realistic ones).
3. **Rewritten bullet points** — rewrite the candidate's REAL experience to naturally include missing keywords; keep them truthful, quantified, and starting with action verbs. Mark any metric the candidate must fill as [X].
4. **Tailored professional summary** (2-3 lines).
5. **Final Skills line** using exact JD phrasing.
Be specific and copy-paste ready. Do not invent employers or fake metrics.

JOB TITLE: ${jobTitle||"(not provided)"}

=== JOB DESCRIPTION ===
${jd}

=== RESUME ===
${resume}`;

  try{
    let text;
    if (provider==="anthropic"){
      const r = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{ "content-type":"application/json", "x-api-key":key,
          "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" },
        body:JSON.stringify({ model, max_tokens:4000, messages:[{role:"user",content:prompt}] })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message||("HTTP "+r.status));
      text = (j.content||[]).map(b=>b.text||"").join("\n");
    } else {
      const r = await fetch("https://api.openai.com/v1/chat/completions",{
        method:"POST",
        headers:{ "content-type":"application/json", "authorization":"Bearer "+key },
        body:JSON.stringify({ model, max_tokens:2500, messages:[{role:"user",content:prompt}] })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message||("HTTP "+r.status));
      text = j.choices?.[0]?.message?.content||"";
    }
    out.innerHTML = mdToHtml(text||"(empty response)");
    status.textContent="Done"; status.className="pill ok";
  }catch(e){
    status.textContent="Error"; status.className="pill muted";
    out.innerHTML = `<p style="color:var(--bad)">AI request failed: ${esc(e.message)}</p>
      <p class="small muted">Common causes: wrong/expired key, wrong model id for your account, or the provider's browser CORS policy. The built-in results above don't need AI.</p>`;
  }
}

/* tiny markdown renderer (headings, bold, lists, code) */
function mdToHtml(md){
  const lines = md.replace(/\r/g,"").split("\n");
  let html="", inList=false, inCode=false;
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
    .replace(/`([^`]+)`/g,"<code>$1</code>")
    .replace(/\*(.+?)\*/g,"<em>$1</em>");
  for (let ln of lines){
    if (/^```/.test(ln)){ if(inCode){html+="</pre>";inCode=false;} else {html+="<pre>";inCode=true;} continue; }
    if (inCode){ html+=esc(ln)+"\n"; continue; }
    if (/^###\s/.test(ln)){ closeList(); html+="<h3>"+inline(ln.replace(/^###\s/,""))+"</h3>"; continue; }
    if (/^##\s/.test(ln)){ closeList(); html+="<h2>"+inline(ln.replace(/^##\s/,""))+"</h2>"; continue; }
    if (/^#\s/.test(ln)){ closeList(); html+="<h1>"+inline(ln.replace(/^#\s/,""))+"</h1>"; continue; }
    if (/^\s*[-*•]\s+/.test(ln) || /^\s*\d+\.\s+/.test(ln)){
      if(!inList){html+="<ul>";inList=true;}
      html+="<li>"+inline(ln.replace(/^\s*(?:[-*•]|\d+\.)\s+/,""))+"</li>"; continue;
    }
    closeList();
    if (ln.trim()==="") html+=""; else html+="<p>"+inline(ln)+"</p>";
  }
  closeList(); if(inCode)html+="</pre>";
  function closeList(){ if(inList){html+="</ul>";inList=false;} }
  return html;
}

/* ============================================================
   Resume file parsing
   ============================================================ */
async function parseFile(file){
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt")) return await file.text();
  if (name.endsWith(".docx")){
    if (!window.mammoth) throw new Error("DOCX parser not loaded (offline?). Please paste the text instead.");
    const buf = await file.arrayBuffer();
    const res = await window.mammoth.extractRawText({arrayBuffer:buf});
    return res.value;
  }
  if (name.endsWith(".pdf")){
    if (!window.pdfjsLib) throw new Error("PDF parser not loaded (offline?). Please paste the text instead.");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({data:buf}).promise;
    let text="";
    for (let p=1;p<=pdf.numPages;p++){
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map(i=>i.str).join(" ")+"\n";
    }
    return text;
  }
  throw new Error("Unsupported file type. Use PDF, DOCX, or TXT.");
}

/* ============================================================
   UI wiring
   ============================================================ */
function esc(s){ return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
let toastTimer;
function toast(msg){ const t=$("toast"); t.textContent=msg; t.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.add("hidden"),1800); }

function refreshResumeUI(){
  const r = store.get(LS.resume);
  if (r && r.trim()){
    $("resumeEmpty").classList.add("hidden");
    $("resumeSaved").classList.remove("hidden");
    $("resumeStatus").textContent="Resume saved ✓"; $("resumeStatus").className="pill ok";
    const nm = store.get(LS.resumeName);
    $("resumeMeta").textContent = nm ? ("Saved: "+nm) : "Resume saved";
    $("resumeWords").textContent = " · "+wordCount(r)+" words";
  } else {
    $("resumeEmpty").classList.remove("hidden");
    $("resumeSaved").classList.add("hidden");
    $("resumeStatus").textContent="No resume saved"; $("resumeStatus").className="pill muted";
  }
}

function saveResume(text, name){
  if (!text || !text.trim()){ setParse("Nothing to save — upload or paste your resume.","err"); return false; }
  store.set(LS.resume, text.trim());
  if (name) store.set(LS.resumeName, name);
  refreshResumeUI(); setParse("Resume saved to this browser ✓","ok"); toast("Resume saved");
  // auto-build the structured profile from this resume (no manual filling needed)
  if (window.Resume && window.Resume.onResumeSaved) window.Resume.onResumeSaved(text.trim());
  return true;
}
function setParse(msg,cls){ const p=$("parseMsg"); p.textContent=msg||""; p.className="parse-msg "+(cls||""); }

function wireCopyChips(){
  document.querySelectorAll(".chip[data-term]").forEach(c=>{
    c.onclick=()=>{ navigator.clipboard?.writeText(c.dataset.term); toast("Copied: "+c.dataset.term); };
  });
  document.querySelectorAll("[data-copy]").forEach(b=>{
    b.onclick=()=>{ navigator.clipboard?.writeText(b.dataset.copy); toast("Copied to clipboard"); };
  });
}

function init(){
  // theme
  const savedTheme = store.get(LS.theme);
  if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
  $("themeToggle").onclick=()=>{
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur==="dark"?"light":cur==="light"?"dark":
      (matchMedia("(prefers-color-scheme:dark)").matches?"light":"dark");
    document.documentElement.setAttribute("data-theme",next); store.set(LS.theme,next);
  };

  // restore JD
  $("jdPaste").value = store.get(LS.jd)||"";
  $("jobTitleInput").value = store.get(LS.jobTitle)||"";
  $("jdPaste").addEventListener("input",e=>store.set(LS.jd,e.target.value));
  $("jobTitleInput").addEventListener("input",e=>store.set(LS.jobTitle,e.target.value));
  $("clearJdBtn").onclick=()=>{ $("jdPaste").value=""; $("jobTitleInput").value=""; store.del(LS.jd); store.del(LS.jobTitle); };

  refreshResumeUI();

  // upload
  const dz=$("dropzone"), fi=$("fileInput");
  dz.onclick=()=>fi.click();
  dz.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();fi.click();} };
  ["dragover","dragenter"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("drag");}));
  ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("drag");}));
  dz.addEventListener("drop",e=>{ const f=e.dataTransfer.files[0]; if(f) handleFile(f); });
  fi.onchange=e=>{ const f=e.target.files[0]; if(f) handleFile(f); };

  async function handleFile(f){
    setParse("Reading "+f.name+"…","");
    try{
      const text = await parseFile(f);
      if (!text || text.trim().length<30){ setParse("Couldn't extract enough text — try pasting instead (scanned PDFs don't work).","err"); return; }
      $("resumePaste").value = text.trim();
      saveResume(text, f.name);
    }catch(e){ setParse(e.message,"err"); }
  }

  $("saveResumeBtn").onclick=()=> saveResume($("resumePaste").value, "pasted text");

  // saved resume actions
  $("replaceResumeBtn").onclick=()=>{ store.del(LS.resume); store.del(LS.resumeName); $("resumePaste").value=""; refreshResumeUI(); setParse("",""); };
  $("viewResumeBtn").onclick=()=>{
    const v=$("resumeView"); v.value=store.get(LS.resume)||"";
    v.classList.toggle("hidden"); $("resumeViewActions").classList.toggle("hidden");
  };
  $("cancelEditBtn").onclick=()=>{ $("resumeView").classList.add("hidden"); $("resumeViewActions").classList.add("hidden"); };
  $("updateResumeBtn").onclick=()=>{
    if (saveResume($("resumeView").value,"edited text")){ $("resumeView").classList.add("hidden"); $("resumeViewActions").classList.add("hidden"); }
  };

  // AI settings
  $("aiProvider").value = store.get(LS.aiProvider)||"anthropic";
  $("aiModel").value = store.get(LS.aiModel)||"";
  $("aiKey").value = store.get(LS.aiKey)||"";
  updateModelHint();
  $("aiProvider").onchange=updateModelHint;
  $("aiSettingsBtn").onclick=()=>$("aiSettings").classList.toggle("hidden");
  $("saveAiBtn").onclick=()=>{
    store.set(LS.aiProvider,$("aiProvider").value);
    store.set(LS.aiModel,$("aiModel").value.trim());
    store.set(LS.aiKey,$("aiKey").value.trim());
    toast("AI settings saved"); $("aiSettings").classList.add("hidden");
  };
  function updateModelHint(){
    const p=$("aiProvider").value;
    $("aiModel").placeholder = p==="anthropic"?"claude-opus-5-5":"gpt-4o-mini";
    $("aiModelHint").innerHTML = p==="anthropic"
      ? "Tip: <code>claude-opus-5-5</code> (best), or <code>claude-haiku-5-5</code> (cheaper). Get a key at console.anthropic.com."
      : "Tip: <code>gpt-4o-mini</code> (cheaper) or <code>gpt-4o</code>. Get a key at platform.openai.com.";
  }

  // toggle table
  $("toggleTableBtn").onclick=()=>{
    const w=$("keywordTableWrap"); const show=w.classList.contains("hidden");
    w.classList.toggle("hidden"); $("toggleTableBtn").textContent = show?"Hide":"Show";
  };
  // copy all recommendations
  $("copyAllBtn").onclick=()=>{
    const text = [...document.querySelectorAll("#recoBlocks [data-copy]")].map(b=>b.dataset.copy).join("\n\n");
    navigator.clipboard?.writeText(text); toast("All fixes copied");
  };

  // main run
  $("checkBtn").onclick=run;

  function run(){
    const resume = store.get(LS.resume)||"";
    const jd = $("jdPaste").value||"";
    const jobTitle = $("jobTitleInput").value||"";
    if (!resume.trim()){ toast("Add your resume first"); $("resumeCard").scrollIntoView({behavior:"smooth"}); return; }
    if (jd.trim().length<40){ toast("Paste a fuller job description"); $("jdPaste").focus(); return; }
    const result = scoreResume(resume, jd, jobTitle);
    renderResults(result, resume, jd, jobTitle);
    if (window.Resume) window.Resume.onScore(result, resume, jd, jobTitle);
    if ($("useAiToggle").checked) runAi(resume, jd, jobTitle);
  }
}

document.addEventListener("DOMContentLoaded", init);
