# ResumeAI — Tailor & Apply

AI-powered resume tailoring + real job search with one-click apply.

## Features
- ✂️ **Resume Tailor** — paste any JD, Claude rewrites your resume for ATS
- 🔍 **Real Job Search** — live jobs from the web via JSearch API
- ⏱ **Time Filters** — past 24h / past week / past month / any time
- 🎯 **Tailor & Apply** — tailor resume for a specific job, then open application
- 📊 **Dashboard** — track your application stats

---

## Deploy in 15 minutes

### Step 1 — Get your API keys (both free)

**Anthropic API key:**
1. Go to https://console.anthropic.com
2. Create account → API Keys → Create Key
3. Copy the key (starts with `sk-ant-`)

**RapidAPI key (for real jobs):**
1. Go to https://rapidapi.com/letscrape-6bRB4TkqmJD/api/jsearch
2. Click "Subscribe to Test" → select **Basic (free)** — 200 requests/month free
3. Copy your RapidAPI key from the header

---

### Step 2 — Push to GitHub

```bash
# Clone or download this project, then:
cd resumeai
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/resumeai.git
git push -u origin main
```

---

### Step 3 — Deploy on Vercel (free)

1. Go to https://vercel.com → Sign up with GitHub
2. Click **"Add New Project"**
3. Import your `resumeai` repository
4. Click **"Environment Variables"** and add:

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-your-key-here` |
| `RAPIDAPI_KEY` | `your-rapidapi-key-here` |

5. Click **Deploy** — done! ✅

Vercel gives you a free URL like `https://resumeai-xyz.vercel.app`

---

### Run locally (optional)

```bash
# Install dependencies
npm install

# Create your env file
cp .env.local.example .env.local
# Then edit .env.local and add your keys

# Start dev server
npm run dev
# Open http://localhost:3000
```

---

## Share with friends

Once deployed on Vercel, just share your URL. Anyone can:
- Search for real jobs
- Tailor their own resume (they edit the resume textarea)
- Click "Apply Now" to open the actual job listing

---

## Tech stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Claude claude-opus-4-5** (resume tailoring)
- **JSearch API** (real job listings from LinkedIn, Indeed, Glassdoor)
- **Recharts** (dashboard charts)
- **Vercel** (hosting)

---

## Upgrading job search

Free JSearch tier = 200 req/month. If you need more:
- **Basic paid** on RapidAPI = ~$10/month for 5,000 requests
- Or swap `app/api/jobs/route.ts` to use **SerpAPI** or **Adzuna** (both have free tiers)
