# AdaL Launch Radar

An MVP for the Converge.AI × AdaL challenge (Stanford, Nov 20 2026): **turn AdaL's community into qualified free-to-paid pipeline.**

> Every morning: here are the 5 people you already know who just shipped, the launch video we made them from their CHANGELOG, and the message to send. Approve to send.

Open `index.html` in a browser. There's no build step and no API keys. Click **▶ Run today's cycle**.
`index.html#autosim-autorun` pre-runs 3 simulated weeks of learning and then the cycle, which is handy for a kiosk demo.

## Guided mode

A first visit shows a welcome screen. With **Guided mode** on, each run walks through the stages with an overlay covering what's happening, why, how it helps AdaL, the brief text it answers, and a live **expected vs actual quality** table computed from the run. Each tab has a **? Explain** button. **📋 Challenge fit** maps every section of the brief to the app (covered / partial / gap).

## Why this works

- **AdaL's leads come from community, not outbound.** These are the coffee pop-ups (50+ operators), the Vapi hackathon (330 sign-ups), London on Dec 3 and the ambassador program. Warm lists are scored first, and cold leads only fill the slots that are left.
- **The buying moment is a release.** AdaL makes launch videos from a codebase and its CHANGELOG. The strongest signal is *shipped in the last ~2 weeks and has a weak launch video or none*. Funding is only a tiebreaker.
- **A qualified lead is a likely paid upgrade**, not a download. Leads are ranked by **expected MRR = P(upgrade) × plan price**. Release cadence decides whether a lead is a Pro, Max or Contact Sales prospect.

## The loop

| Stage | What's built (deterministic) | Swap point (production) |
|---|---|---|
| **Find** | Warm lists (CSV) **+ a daily feed**: GitHub releases (with CHANGELOG.md fallback and owner contact info), Product Hunt launches (public Atom feed, or the API with `PH_TOKEN`), X launch posts (API with `X_BEARER_TOKEN`), plus a paste importer for X/LinkedIn posts. Warm contacts are **joined** to feed signals by repo or company | LLM extraction of launch posts in place of `lib/parse_post.js` |
| **Qualify** | `P = learned source rate × (freshness × video gap) × buildability × ICP fit`, plus a tier from release cadence and team size. Every score shows its reasons | LLM-written reasoning; the score stays rule-based and auditable |
| **Show** | Launch video rendered on a canvas from the latest release notes (downloadable `.webm`), plus an **AdaL video brief** (storyboard, voiceover, deliverables) to hand to the real agent | AdaL's video agent called with the brief |
| **Sell** | Three playbooks × two **A/B message angles** (chosen by Thompson sampling). Each goes through the right channel (mail app, X profile or contact page). **A human approves every message.** Day-3 and day-7 **follow-ups** stop when the prospect replies | LLM personalisation within the same playbook, angle and guardrails; sending through a real mail API |
| **Learn** | Beta-Bernoulli rates by source, release age and angle; an A/B readout as P(A beats B); Thompson sampling; **CRM CSV import and export**; recommendations | CRM or email webhooks in place of CSV |

Each swap point is marked `SWAP POINT` in the code.

## Daily Find

```bash
node scripts/find.mjs                         # writes data/feeds.json + data/feeds.js
GITHUB_TOKEN=$(gh auth token) node scripts/find.mjs
```

`.github/workflows/daily-find.yml` runs this at 13:00 UTC every day and publishes to the **`feeds` branch** (never `main`). The app loads `feeds.json` from there and falls back to the bundled `data/feeds.js`. Optional repo secrets: `PH_TOKEN` (Product Hunt developer token) and `X_BEARER_TOKEN` (X API, paid tier). Without them, Product Hunt uses its public feed, and X comes from `data/x_posts.json` (see `data/x_posts.example.json`) or the paste box. Sources to watch are listed in `config/sources.json`.

## What the user controls (Setup tab)

- **Warm lists**: CSV upload (template downloadable). Only `company` and `source` are required. A `github` column (`owner/repo`) triggers a live release lookup.
- **Watched repos**: the cold release feed.
- **ICP and weights**: freshness window, video-gap weights, prior conversion per source, tier thresholds, **plan prices**. All of this is JSON, so a new segment or company is a config change.

## Data and honesty notes

- Everyone in `data/sample_leads.js` is **fictional** (`.example` domains). Real attendee lists are never committed.
- The cold feed uses **real public GitHub release data**.
- The "Learn" tab simulates outcomes from a hidden ground truth, and **simulated numbers are labelled**. Real outcomes logged in Sell are counted separately.
- Assumptions to confirm with AdaL: the Max price (default $100), the value of a Contact Sales deal (default $300/mo), and research time per prospect (45 → 2 min).
- Without an X token, X is not read automatically. Paste posts or add `data/x_posts.json`. LinkedIn has no usable public API, so it's paste only.
- Still open: map each Converge.AI product (Covey, Enter, Framia, …) to a stage. The challenge requires it.

## Files

```
index.html             UI and styles (light/dark)
app.js                 Find → Qualify → Show → Sell → Learn
guide.js               guided overlays, quality checks, challenge-fit map
lib/parse_post.js      launch-post / changelog parser (browser + Node)
scripts/find.mjs       daily Find: GitHub, Product Hunt, X → data/feeds.json
config/sources.json    repos to watch, PH SaaS topics, X search query
data/sample_leads.js   fictional warm lists (same columns as the CSV template)
data/feeds.js          latest feed snapshot (generated)
```
