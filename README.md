# AdaL Launch Radar

An MVP for the Converge.AI × AdaL challenge (Stanford, Nov 20 2026): **turn AdaL's community into qualified free-to-paid pipeline.**

> Every morning: here are the 5 people you already know who just shipped, the launch video we made them from their CHANGELOG, and the message to send. Approve to send.

Open `index.html` in a browser. There's no build step and no API keys. Click **▶ Run today's cycle**.
`index.html#autosim-autorun` pre-runs 3 simulated weeks of learning and then the cycle, which is handy for a kiosk demo.

## Why this works

- **AdaL's leads come from community, not outbound.** These are the coffee pop-ups (50+ operators), the Vapi hackathon (330 sign-ups), London on Dec 3 and the ambassador program. Warm lists are scored first, and cold leads only fill the slots that are left.
- **The buying moment is a release.** AdaL makes launch videos from a codebase and its CHANGELOG. The strongest signal is *shipped in the last ~2 weeks and has a weak launch video or none*. Funding is only a tiebreaker.
- **A qualified lead is a likely paid upgrade**, not a download. Leads are ranked by **expected MRR = P(upgrade) × plan price**. Release cadence decides whether a lead is a Pro, Max or Contact Sales prospect.

## The loop

| Stage | MVP (deterministic) | Swap point (production) |
|---|---|---|
| **Find** | CSV import of warm lists + **live GitHub releases API** for a watched repo list | Product Hunt / X / LinkedIn adapters, plus LLM extraction of launch posts |
| **Qualify** | `P = learned source rate × (freshness × video gap) × feasibility`, plus a tier from release cadence and team size. Every score shows its reasons | LLM-written reasoning; the score stays rule-based and auditable |
| **Show** | Launch video rendered on a canvas from the latest CHANGELOG entry, downloadable as `.webm` | AdaL's own video agent, with the repo and CHANGELOG as input |
| **Sell** | Three playbooks (warm follow-up / free→paid nudge / Contact Sales). **A human approves every message**; nothing is actually sent | LLM personalisation inside the same playbook and guardrails |
| **Learn** | Beta-Bernoulli conversion rates per source, Thompson sampling for which leads to contact, breakdown by release age, recommendations | Real CRM/email webhooks in place of simulated or manually logged outcomes |

Each swap point is marked `SWAP POINT` in `app.js`.

## What the user controls (Setup tab)

- **Warm lists**: CSV upload (template downloadable). Only `company` and `source` are required. A `github` column (`owner/repo`) triggers a live release lookup.
- **Watched repos**: the cold release feed.
- **ICP and weights**: freshness window, video-gap weights, prior conversion per source, tier thresholds, **plan prices**. All of this is JSON, so a new segment or company is a config change.

## Data and honesty notes

- Everyone in `data/sample_leads.js` is **fictional** (`.example` domains). Real attendee lists are never committed.
- The cold feed uses **real public GitHub release data**.
- The "Learn" tab simulates outcomes from a hidden ground truth, and **simulated numbers are labelled**. Real outcomes logged in Sell are counted separately.
- Assumptions to confirm with AdaL: the Max price (default $100), the value of a Contact Sales deal (default $300/mo), and research time per prospect (45 → 2 min).
- Still open: map each Converge.AI product (Covey, Enter, Framia, …) to a stage. The challenge requires it.

## Files

```
index.html             UI and styles (light/dark)
app.js                 Find → Qualify → Show → Sell → Learn
data/sample_leads.js   fictional warm lists (same columns as the CSV template)
```
