# ATS Score Checker

A fast, **100% private** ATS (Applicant Tracking System) resume checker, tuned for **SEO / Digital Marketing** roles. Store your resume once, paste any job description, and get:

- An **overall ATS match score** (0–100%) with a breakdown
- The **exact missing keywords** from the JD (prioritized by impact)
- **Ready-to-paste fixes**: an updated Skills section, a tailored summary, and bullet points to add
- An **ATS formatting checklist** with specific fixes
- A full **keyword match table**
- Optional **AI rewrite** using your own API key (Claude or OpenAI)

Everything runs in your browser. Your resume and the job description **never leave your device** (the only exception is the optional AI rewrite, which you turn on yourself and which sends data directly to your chosen provider with your own key).

---

## How to use

1. **Add your resume once** — upload a PDF, DOCX, or TXT (auto-extracted in-browser), or paste the text. It's saved in your browser (`localStorage`) and reused every time. Use **Replace** to swap in a new version anytime.
2. **Paste the job description** (and optionally the job title).
3. Click **⚡ Check ATS Score**.
4. Apply the fixes it gives you — add the missing keywords where they're genuinely true for you, paste the updated Skills section and summary, and add the suggested bullets (fill the `[brackets]` with your real numbers).
5. Re-run until you hit **98–100%**.

> **Reaching 98–100%:** The score is driven mostly by keyword match. Add every relevant missing keyword into your **Skills section** and work the important ones naturally into your **experience bullets** using the exact phrasing from the JD. Fix any red/yellow items on the formatting checklist. Re-check — the score climbs as gaps close.

### Optional AI rewrite

Click **AI settings**, choose a provider, paste **your own API key** (stored only in your browser), and tick **"Also run AI rewrite"** before checking. This generates AI-written, tailored bullet rewrites from your real experience.

- **Anthropic (Claude):** default model `claude-opus-5-5` (best) or `claude-haiku-5-5` (cheaper) — key from [console.anthropic.com](https://console.anthropic.com).
- **OpenAI:** `gpt-4o-mini` (cheaper) or `gpt-4o` — key from [platform.openai.com](https://platform.openai.com).

The built-in checker works fully **without** any key.

---

## Deploy as a GitHub Page (so you can use it daily)

This is a static site — no build step.

1. Merge this branch into your default branch (e.g. `main`), or set Pages to serve from this branch.
2. In the repo on GitHub: **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick the branch (e.g. `main`) and folder **`/ (root)`**, then **Save**.
5. Wait ~1 minute. Your tool will be live at:
   `https://<your-username>.github.io/ats-checker/`

Bookmark it and use it before every application.

> Your saved resume lives in the browser you use the tool from. If you switch browsers or devices, just paste/upload it once there.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | UI structure |
| `styles.css` | Styling (light/dark) |
| `data.js` | SEO/marketing skills taxonomy, aliases, action verbs, stopwords |
| `app.js` | Parsing, scoring, recommendations, AI rewrite |

## Privacy

- Resume + JD are stored only in your browser's `localStorage`.
- No analytics, no tracking, no backend.
- The optional AI rewrite sends your resume + JD **directly** to Anthropic/OpenAI using your key — nowhere else.
