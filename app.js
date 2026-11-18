/* AdaL Launch Radar — MVP.
 * Every place an LLM or AdaL's video agent would go is a plain function marked "SWAP POINT".
 * Find → Qualify → Show → Sell → Learn, all deterministic.
 */
'use strict';

// ---------- defaults (editable in Setup) ----------
const DEFAULT_CONFIG = {
  icp: { stages: ['Pre-seed', 'Seed', 'Series A', 'Series B'], regions: ['US', 'UK', 'EU'] },
  plans: { pro: 20, max: 100, max_plus: 200, sales_est: 300 },
  plan_note: 'Paid plans are $20 / $100 / $200 a month. "max" is the Max tier price (still to confirm with AdaL). sales_est is the assumed monthly value of a Contact Sales deal.',
  freshness_window_days: 14,
  video_gap: { none: 1.0, screen_recording: 0.7, stale: 0.75, produced: 0.2 },
  // Starting assumptions for P(paid upgrade | contacted) by source. These are the Beta prior means.
  prior_rate: { ambassador: 0.18, london_rsvp: 0.12, popup: 0.10, hackathon: 0.08, cold: 0.03 },
  prior_strength: 12,
  tiers: { sales_min_releases_90d: 10, sales_min_team: 40, max_min_releases_90d: 4 },
  qualify_min_p: 0.06,
  funding_bonus: 0.15,
  research_minutes_manual: 45,
  research_minutes_tool: 2,
  watch_repos: [
    'supabase/supabase', 'calcom/cal.com', 'langfuse/langfuse', 'formbricks/formbricks',
    'twentyhq/twenty', 'triggerdotdev/trigger.dev', 'documenso/documenso', 'novuhq/novu',
    'hoppscotch/hoppscotch', 'refinedev/refine', 'mendableai/firecrawl', 'dubinc/dub'
  ]
};
const SOURCES = {
  ambassador: { label: 'Ambassador', warm: true },
  london_rsvp: { label: 'London Dec 3', warm: true },
  popup: { label: 'Coffee pop-ups', warm: true },
  hackathon: { label: 'Vapi hackathon', warm: true },
  cold: { label: 'Cold / release feed', warm: false }
};
const TIER_LABEL = { pro: 'Pro $20', max: 'Max', sales: 'Contact Sales' };

// ---------- storage (best effort) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('adal_' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('adal_' + k, JSON.stringify(v)); } catch { /* private mode */ } }
};

let CFG = store.get('cfg', null) || structuredClone(DEFAULT_CONFIG);
let LEADS = [];
let LIVE = store.get('live', []);           // leads fetched from GitHub
let STATS = store.get('stats', null) || freshStats();
let PITCH = store.get('pitch', {});          // id -> {status, outcome, text}
let TODAY = [];                              // top-5 ids of last run

function freshStats() {
  const bySource = {}; Object.keys(SOURCES).forEach(s => bySource[s] = { contacted: 0, paid: 0 });
  return {
    bySource,
    byAge: { '0–7 days': { contacted: 0, paid: 0 }, '8–14 days': { contacted: 0, paid: 0 }, '15+ days': { contacted: 0, paid: 0 } },
    byGap: {},
    funnel: { contacted: 0, replied: 0, tried_free: 0, paid: 0, max_or_sales: 0 },
    mrr: 0, weeks: 0, simulated: 0, real: 0
  };
}
const save = () => { store.set('cfg', CFG); store.set('stats', STATS); store.set('pitch', PITCH); store.set('live', LIVE); };

// ---------- CSV ----------
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift().map(h => h.trim());
  return rows.filter(r => r.some(x => x.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
function normalize(r, i, origin) {
  const src = SOURCES[r.source] ? r.source : 'cold';
  return {
    id: origin + '-' + i + '-' + (r.company || '').toLowerCase().replace(/\W+/g, ''),
    origin,
    name: r.name || '', email: r.email || '', company: r.company || '(unknown)', role: r.role || '',
    website: r.website || '', github: r.github || '', source: src, list_name: r.list_name || SOURCES[src].label,
    launch_video: r.launch_video || 'none', release_version: r.release_version || '',
    release_days_ago: num(r.release_days_ago), releases_90d: num(r.releases_90d) ?? 0,
    team_size: num(r.team_size), stage: r.stage || '', funding_days_ago: num(r.funding_days_ago), region: r.region || '',
    changelog: (r.changelog || '').split('|').map(s => s.trim()).filter(Boolean)
  };
}
function loadCSV(text, origin) { return parseCSV(text).map((r, i) => normalize(r, i, origin)); }

// ---------- FIND: live GitHub release feed ----------
// SWAP POINT: production adds Product Hunt, X and LinkedIn adapters, plus LLM extraction of launch posts.
async function fetchRepo(full) {
  const cacheKey = 'gh_' + full; const c = store.get(cacheKey, null);
  if (c && Date.now() - c.t < 3600e3) return c.d;
  const res = await fetch(`https://api.github.com/repos/${full}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(full + ': HTTP ' + res.status);
  const d = (await res.json()).filter(r => !r.draft).map(r => ({ tag: r.tag_name, name: r.name, at: r.published_at, body: r.body || '', url: r.html_url }));
  store.set(cacheKey, { t: Date.now(), d });
  return d;
}
function releaseToLead(full, rels, i) {
  const now = Date.now(), day = 864e5;
  const latest = rels[0];
  const ago = latest ? Math.max(0, Math.round((now - Date.parse(latest.at)) / day)) : null;
  const r90 = rels.filter(r => now - Date.parse(r.at) <= 90 * day).length;
  const body = latest ? latest.body : '';
  const hasVideo = /youtube\.com|youtu\.be|loom\.com|vimeo\.com|\.mp4|\.mov|<video|\.gif/i.test(body);
  const bullets = body.split('\n').map(l => l.trim()).filter(l => /^[-*•]\s+/.test(l))
    .map(l => l.replace(/^[-*•]\s+/, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '')
      .replace(/\bby @\S+.*$/i, '').replace(/[`*_#>]/g, '').replace(/\s+in\s*$/, '').trim())
    .filter(l => l.length > 6).slice(0, 4).map(l => l.length > 72 ? l.slice(0, 70) + '…' : l);
  const [owner, repo] = full.split('/');
  return {
    id: 'live-' + i + '-' + full.replace(/\W+/g, ''), origin: 'live', name: '', email: '', company: repo, role: '',
    website: 'github.com/' + full, github: full, source: 'cold', list_name: 'GitHub releases (live)',
    launch_video: hasVideo ? 'produced' : 'none', release_version: latest ? latest.tag : '', release_days_ago: ago,
    releases_90d: r90, releases_capped: r90 >= rels.length && rels.length === 30, team_size: null, stage: '', funding_days_ago: null, region: '',
    changelog: bullets.length ? bullets : (latest ? [latest.name || latest.tag] : []), release_url: latest?.url, owner
  };
}
async function fetchLive(list) {
  const out = [], errs = [];
  for (const [i, full] of list.entries()) {
    try { out.push(releaseToLead(full, await fetchRepo(full), i)); } catch (e) { errs.push(e.message); }
  }
  return { out, errs };
}

// ---------- QUALIFY ----------
function learnedRate(src) {
  const p = CFG.prior_rate[src] ?? 0.03, k = CFG.prior_strength, s = STATS.bySource[src] || { contacted: 0, paid: 0 };
  return (p * k + s.paid) / (k + s.contacted);
}
function betaSample(a, b) { // Thompson sampling via two gamma draws
  const g = k => { if (k < 1) return g(1 + k) * Math.pow(Math.random(), 1 / k);
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) { let x, v; do { x = randn(); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = Math.random();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } };
  const x = g(a), y = g(b); return x / (x + y);
}
function randn() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); }

function freshness(d) {
  const w = CFG.freshness_window_days;
  if (d == null) return 0;
  if (d <= w) return Math.exp(-d / (w * 0.9));
  return 0.25 * Math.exp(-(d - w) / 21);
}
function tierOf(l) {
  const t = CFG.tiers;
  if (l.releases_90d >= t.sales_min_releases_90d || (l.team_size ?? 0) >= t.sales_min_team) return 'sales';
  if (l.releases_90d >= t.max_min_releases_90d) return 'max';
  return 'pro';
}
function priceOf(tier) { return tier === 'sales' ? CFG.plans.sales_est : tier === 'max' ? CFG.plans.max : CFG.plans.pro; }

function score(l, rateFn = learnedRate) {
  const fresh = freshness(l.release_days_ago);
  const gap = CFG.video_gap[l.launch_video] ?? 0.6;
  const feasible = !!(l.github || l.changelog.length);
  const funded = l.funding_days_ago != null && l.funding_days_ago <= 180;
  const base = rateFn(l.source);
  let p = base * (0.15 + 2.2 * fresh * gap) * (feasible ? 1 : 0.3) * (funded ? 1 + CFG.funding_bonus : 1);
  p = Math.min(0.75, p);
  const tier = tierOf(l), price = priceOf(tier);
  const qualified = feasible && fresh > 0.15 && p >= CFG.qualify_min_p;
  const why = [];
  if (SOURCES[l.source].warm) why.push(l.list_name);
  if (l.release_days_ago != null) why.push(`shipped ${l.release_version || 'a release'} ${ago(l.release_days_ago)}`);
  else why.push('no recent release');
  why.push({ none: 'no launch video', screen_recording: 'only a screen recording', stale: 'demo video is stale', produced: 'already has a produced video' }[l.launch_video] || l.launch_video);
  const bigTeam = (l.team_size ?? 0) >= CFG.tiers.sales_min_team;
  if (l.releases_90d || bigTeam) why.push(`${l.releases_90d} releases in 90d${bigTeam ? `, team of ${l.team_size}` : ''} → ${TIER_LABEL[tier]}`);
  if (funded) why.push('raised recently (tiebreaker)');
  if (!feasible) why.push('no repo/CHANGELOG, so AdaL can’t build the video yet');
  return { ...l, fresh, gap, feasible, p, tier, price, emrr: p * price, qualified, why };
}
const ago = d => d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
const money = v => '$' + (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(v < 10 ? 2 : 1));
const pct = v => (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function allLeads() { return [...LEADS, ...LIVE]; }
function ranked() {
  // warm lists are scored first (sorting is by expected MRR, but warm wins ties), cold only fills the remaining slots
  return allLeads().map(l => score(l)).sort((a, b) => b.emrr - a.emrr || (SOURCES[b.source].warm - SOURCES[a.source].warm));
}

// ---------- SHOW: launch video renderer ----------
// SWAP POINT: production sends repo + CHANGELOG to AdaL's video agent. This canvas version shows the shape of the output.
const cv = () => document.getElementById('vid');
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function scenesFor(l) {
  const items = l.changelog.length ? l.changelog : ['A fresh release'];
  return [{ kind: 'title', dur: 2.6 }, ...items.slice(0, 4).map((t, i) => ({ kind: 'feat', t, i, dur: 2.4 })), { kind: 'cta', dur: 2.6 }];
}
function videoLength(l) { return scenesFor(l).reduce((a, s) => a + s.dur, 0); }
function drawFrame(ctx, l, t) {
  const W = 1280, H = 720, h = hue(l.company);
  const sc = scenesFor(l); let acc = 0, s = sc[sc.length - 1], st = s.dur;
  for (const x of sc) { if (t < acc + x.dur) { s = x; st = t - acc; break; } acc += x.dur; }
  const k = Math.min(1, st / 0.6), ease = 1 - Math.pow(1 - k, 3), out = Math.max(0, (st - (s.dur - 0.35)) / 0.35);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${h},55%,12%)`); g.addColorStop(1, `hsl(${(h + 40) % 360},60%,22%)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // drifting orbs
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.fillStyle = `hsla(${(h + i * 25) % 360},80%,60%,0.08)`;
    ctx.arc((200 + i * 260 + t * 30 * (i % 2 ? 1 : -1)) % (W + 200), 140 + (i * 137) % 480, 120 + i * 30, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1 - out;
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
  const font = (w, px) => `${w} ${px}px Inter, system-ui, sans-serif`;
  if (s.kind === 'title') {
    ctx.font = font(600, 28); ctx.fillStyle = `hsl(${h},90%,75%)`;
    ctx.fillText('INTRODUCING', 120, 260 - 20 * (1 - ease));
    ctx.font = font(800, 104); ctx.fillStyle = '#fff'; ctx.fillText(l.company, 120, 350 + 30 * (1 - ease));
    ctx.font = font(700, 54); ctx.fillStyle = `hsla(0,0%,100%,${ease * 0.85})`; ctx.fillText(l.release_version || 'New release', 120, 450);
  } else if (s.kind === 'feat') {
    ctx.font = font(800, 220); ctx.fillStyle = `hsla(${h},90%,70%,0.18)`; ctx.fillText(String(s.i + 1).padStart(2, '0'), 90, 360);
    ctx.font = font(600, 26); ctx.fillStyle = `hsl(${h},90%,75%)`; ctx.fillText(`WHAT'S NEW · ${s.i + 1}`, 140, 250);
    ctx.fillStyle = '#fff'; ctx.font = font(800, 60);
    wrap(ctx, s.t, 140 + 40 * (1 - ease), 340, 1000, 72);
    ctx.fillStyle = `hsl(${h},90%,65%)`; ctx.fillRect(140, 540, 600 * Math.min(1, st / s.dur), 6);
  } else {
    ctx.font = font(800, 84); ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText(`${l.company} ${l.release_version || ''}`.trim(), W / 2, 300 - 20 * (1 - ease));
    ctx.font = font(600, 40); ctx.fillStyle = `hsl(${h},90%,75%)`; ctx.fillText('Available now', W / 2, 400);
    ctx.font = font(500, 30); ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(l.website || l.github || '', W / 2, 470);
    ctx.textAlign = 'left';
  }
  ctx.globalAlpha = 1;
  ctx.font = font(600, 18); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillText('Draft by AdaL · made from your CHANGELOG', 40, H - 36);
}
function wrap(ctx, text, x, y, maxW, lh) {
  const words = text.split(' '); let line = '', lines = [];
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  lines.push(line); lines = lines.slice(0, 3);
  lines.forEach((ln, i) => ctx.fillText(ln, x, y + (i - (lines.length - 1) / 2) * lh));
}
let anim = null;
function play(l, onEnd) {
  cancelAnimationFrame(anim); const ctx = cv().getContext('2d'), len = videoLength(l), t0 = performance.now();
  const loop = now => { const t = (now - t0) / 1000; drawFrame(ctx, l, Math.min(t, len - 0.001)); if (t < len) anim = requestAnimationFrame(loop); else onEnd && onEnd(); };
  anim = requestAnimationFrame(loop);
}
function record(l) {
  const note = document.getElementById('recNote');
  if (!window.MediaRecorder || !cv().captureStream) { note.textContent = 'This browser can’t record a canvas. Try Chrome.'; return; }
  const stream = cv().captureStream(30), chunks = [];
  const mime = ['video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    a.download = `${l.company.replace(/\W+/g, '_')}_${l.release_version || 'launch'}_launch.webm`; a.click();
    note.textContent = 'Downloaded.'; document.getElementById('recBtn').disabled = false;
  };
  document.getElementById('recBtn').disabled = true; note.textContent = `Rendering ${videoLength(l).toFixed(0)}s…`;
  rec.start(); play(l, () => setTimeout(() => rec.stop(), 150));
}

// ---------- SELL: pitch drafting ----------
// SWAP POINT: production uses an LLM to personalise copy inside the same playbook and guardrails.
function playbook(l) {
  if (l.tier === 'sales') return 'sales';
  if (SOURCES[l.source].warm) return 'warm';
  return 'upgrade';
}
function draftPitch(l) {
  const first = (l.name || '').split(' ')[0] || 'there';
  const rel = l.release_version ? `${l.release_version}` : 'your latest release';
  const when = l.release_days_ago != null ? ago(l.release_days_ago) : 'recently';
  const feat = l.changelog[0] ? ` — "${l.changelog[0]}" is a great headline` : '';
  const plan = l.tier === 'max' ? `AdaL Max ($${CFG.plans.max}/mo)` : `AdaL Pro ($${CFG.plans.pro}/mo)`;
  const pb = playbook(l);
  const video = `[▶ ${l.company} ${rel} launch video, ${Math.round(videoLength(l))}s]`;
  const hello = SOURCES[l.source].warm ? `Great to have you at ${l.list_name}. ` : '';
  if (pb === 'warm') return `Subject: Made your ${rel} launch video\n\nHi ${first},\n\nGreat to have you at ${l.list_name}. Saw ${l.company} shipped ${rel} ${when}${feat}.\n\nWe turned the changelog into a launch video. It's yours to post, free:\n${video}\n\nYou're shipping ${l.releases_90d || 'regularly'}${l.releases_90d ? ' releases a quarter' : ''}, so ${plan} would make one of these for every release straight from your repo. Want me to set it up on your next one?\n\n— AdaL team`;
  if (pb === 'sales') return `Subject: ${l.company}: a launch video for every release\n\nHi ${first},\n\n${hello}${l.company} has shipped ${l.releases_90d} releases in the last 90 days, most recently ${rel} ${when}. We made a launch video for it from your CHANGELOG:\n${video}\n\nTeams shipping at your pace usually want this to run automatically on every release, with brand templates and seats for the team. Worth a 20-minute call to scope it?\n\n— AdaL team`;
  return `Subject: Your ${rel} launch, as a video\n\nHi ${first},\n\nCongrats on ${rel}, shipped ${when}. Your launch post didn't have a video, so we made one from the release notes:\n${video}\n\nYou can make the next one yourself, free on your ChatGPT plan. Going to ${plan} gets you one for every release.\n\n— AdaL team`;
}

// ---------- LEARN ----------
function ageBucket(d) { return d <= 7 ? '0–7 days' : d <= 14 ? '8–14 days' : '15+ days'; }
function recordOutcome(l, o, simulated) {
  // o: {replied, tried_free, paid, tier}
  const s = STATS; s.funnel.contacted++; s.bySource[l.source].contacted++;
  const b = ageBucket(l.release_days_ago ?? 99); s.byAge[b].contacted++;
  s.byGap[l.launch_video] = s.byGap[l.launch_video] || { contacted: 0, paid: 0 }; s.byGap[l.launch_video].contacted++;
  if (o.replied) s.funnel.replied++;
  if (o.tried_free) s.funnel.tried_free++;
  if (o.paid) {
    s.funnel.paid++; s.bySource[l.source].paid++; s.byAge[b].paid++; s.byGap[l.launch_video].paid++;
    if (o.tier !== 'pro') s.funnel.max_or_sales++;
    s.mrr += priceOf(o.tier);
  }
  simulated ? s.simulated++ : s.real++;
}
// Hidden "true" world for the simulator. The model doesn't see these numbers and has to learn them.
// Story baked in: coffee pop-up operators rarely ship software (they convert worse than assumed), hackathon builders who just shipped convert better.
const TRUTH = { ambassador: 0.20, london_rsvp: 0.13, popup: 0.035, hackathon: 0.17, cold: 0.025 };
const TRUTH_AGE = d => d <= 7 ? 1.7 : d <= 14 ? 0.8 : 0.3;
const TRUTH_GAP = { none: 1.3, screen_recording: 1.0, stale: 1.0, produced: 0.35 };
function simulateWeek(n = 25) {
  const pool = allLeads();
  if (!pool.length) return;
  // Thompson sampling: draw a plausible rate per source from its posterior, then contact the best 25 under that draw (explores sources it's unsure about).
  const draw = {}; for (const s in SOURCES) { const k = CFG.prior_strength, p = CFG.prior_rate[s] ?? 0.03, st = STATS.bySource[s];
    draw[s] = betaSample(p * k + st.paid, (1 - p) * k + st.contacted - st.paid); }
  const candidates = [];
  for (let i = 0; i < 4; i++) for (const l of pool) {
    const v = { ...l, release_days_ago: Math.floor(Math.random() * 30), launch_video: l.launch_video };
    candidates.push(score(v, s => draw[s]));
  }
  candidates.filter(c => c.feasible).sort((a, b) => b.emrr - a.emrr).slice(0, n).forEach(c => {
    const tp = Math.min(0.8, TRUTH[c.source] * TRUTH_AGE(c.release_days_ago) * (TRUTH_GAP[c.launch_video] ?? 1));
    const paid = Math.random() < tp;
    const replied = paid || Math.random() < Math.min(0.85, tp * 2.2);
    const tried = paid || (replied && Math.random() < 0.55);
    recordOutcome(c, { replied, tried_free: tried, paid, tier: c.tier }, true);
  });
  STATS.weeks++; save();
}
function recommendations() {
  const out = [], s = STATS;
  // feasibility read works without any outcomes: which warm lists actually contain software teams?
  for (const k of Object.keys(SOURCES).filter(k => SOURCES[k].warm)) {
    const ls = allLeads().filter(l => l.source === k); if (ls.length < 3) continue;
    const ok = ls.filter(l => l.github || l.changelog.length).length;
    if (ok / ls.length < 0.4) out.push(`<b>${SOURCES[k].label}</b>: only ${ok} of ${ls.length} contacts have a repo or release AdaL can work from. Treat this list as community and brand, not pipeline.`);
  }
  if (s.funnel.contacted < 20) return [...out, 'Not enough outcomes yet. Simulate a week or log outcomes in Sell.'];
  const rows = Object.keys(SOURCES).map(k => ({ k, prior: CFG.prior_rate[k], now: learnedRate(k), n: s.bySource[k].contacted }));
  rows.filter(r => r.n >= 5).forEach(r => {
    const ratio = r.now / r.prior;
    if (ratio > 1.3) out.push(`<b>${SOURCES[r.k].label}</b> converts at ${pct(r.now)} vs the ${pct(r.prior)} assumed. Give it more time: follow up faster and invite these people to the next event.`);
    if (ratio < 0.7) out.push(`<b>${SOURCES[r.k].label}</b> converts at ${pct(r.now)} vs the ${pct(r.prior)} assumed. Keep it for community, but stop treating it as pipeline. Most of these contacts don't ship software.`);
  });
  const a = s.byAge['0–7 days'], b = s.byAge['8–14 days'];
  if (a.contacted >= 8 && b.contacted >= 8) {
    const ra = a.paid / a.contacted, rb = b.paid / b.contacted;
    if (ra > rb * 1.5 && CFG.freshness_window_days > 7) out.push(`Leads contacted within 7 days of a release convert ${(ra / Math.max(rb, 0.001)).toFixed(1)}× better than at 8–14 days. <button class="btn sm" data-act="win7">Tighten freshness window to 7 days</button>`);
  }
  const pr = s.byGap.produced, no = s.byGap.none;
  if (pr && no && pr.contacted >= 5 && no.contacted >= 5 && pr.paid / pr.contacted < 0.5 * no.paid / no.contacted)
    out.push('Teams that already have a produced launch video rarely upgrade. The video-gap signal is doing real work, so keep its weight.');
  if (!out.length) out.push('Learned rates are close to the starting assumptions. Keep collecting outcomes.');
  return out;
}

// ---------- RENDER ----------
const $ = id => document.getElementById(id);
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); setTimeout(() => e.classList.remove('on'), 1800); }
function chipSrc(l) { return `<span class="chip ${SOURCES[l.source].warm ? 'warm' : ''} ${l.origin === 'live' ? 'live' : ''}">${l.origin === 'live' ? 'LIVE · ' : ''}${esc(SOURCES[l.source].label)}</span>`; }
function chipTier(l) { return `<span class="chip tier-${l.tier}">${TIER_LABEL[l.tier]}${l.tier === 'max' ? ' $' + CFG.plans.max : ''}</span>`; }

function renderKpis() {
  const r = ranked(), q = r.filter(x => x.qualified);
  const pipe = q.reduce((a, x) => a + x.emrr, 0);
  const warm = allLeads().filter(l => SOURCES[l.source].warm).length;
  const saved = (CFG.research_minutes_manual - CFG.research_minutes_tool) * r.length / 60;
  $('kpis').innerHTML = [
    [allLeads().length, 'contacts scanned', `${warm} warm · ${allLeads().length - warm} cold`],
    [`${q.length} (${pct(q.length / Math.max(1, r.length))})`, 'qualified', 'just shipped + AdaL can build the video'],
    [money(pipe) + '/mo', 'expected MRR in pipeline', 'Σ P(upgrade) × plan price'],
    [saved.toFixed(1) + ' h', 'research time saved', `${CFG.research_minutes_manual}→${CFG.research_minutes_tool} min per prospect (assumption)`]
  ].map(([v, l, d]) => `<div class="card kpi"><div class="v">${v}</div><div class="l">${l}</div><div class="note">${d}</div></div>`).join('');
}
function renderTop5() {
  const r = ranked(), byId = Object.fromEntries(r.map(x => [x.id, x]));
  const list = TODAY.map(id => byId[id]).filter(Boolean);
  if (!list.length) return;
  $('top5').innerHTML = `<h3>Top 5: who to contact today, and why now</h3>` + list.map((l, i) => `
    <div class="prospect ${i === 0 ? 'top' : ''}">
      <div class="rank">${i + 1}</div>
      <div><b>${esc(l.name || l.company)}</b>${l.name ? ` · ${esc(l.role)} @ ${esc(l.company)}` : ''} ${chipSrc(l)} ${chipTier(l)}
        <div class="why">${l.why.map(esc).join(' · ')}</div>
        <div class="flex" style="margin-top:6px"><button class="btn sm" data-go="show" data-id="${l.id}">▶ Video</button><button class="btn sm" data-go="sell" data-id="${l.id}">✉ Pitch</button>
        <span class="status ${PITCH[l.id]?.status || 'pending'}">${(PITCH[l.id]?.status || 'pending approval')}${PITCH[l.id]?.outcome ? ' · ' + PITCH[l.id].outcome : ''}</span></div>
      </div>
      <div class="money">${money(l.emrr)}<small>${pct(l.p)} × ${money(l.price)}</small></div>
    </div>`).join('');
}
function renderFind() {
  const all = allLeads();
  $('sourceCards').innerHTML = Object.entries(SOURCES).map(([k, s]) => {
    const n = all.filter(l => l.source === k).length;
    return `<div class="card kpi"><div class="v">${n}</div><div class="l">${s.label}</div><div class="note">${s.warm ? 'Warm · scored first' : 'Cold · fills remaining slots'}</div></div>`;
  }).join('');
  $('findTable').innerHTML = `<tr><th>Contact</th><th>Source</th><th>Latest release</th><th>Launch video</th><th class="num">Releases/90d</th></tr>` +
    all.slice().sort((a, b) => SOURCES[b.source].warm - SOURCES[a.source].warm).map(l => `<tr>
      <td><b>${esc(l.company)}</b><div class="note">${esc(l.name)} ${l.role ? '· ' + esc(l.role) : ''}</div></td>
      <td>${chipSrc(l)}<div class="note">${esc(l.list_name)}</div></td>
      <td>${l.release_version ? esc(l.release_version) + ' · ' + ago(l.release_days_ago) : '<span class="note">none found</span>'}${l.release_url ? ` <a href="${esc(l.release_url)}" target="_blank" rel="noopener">↗</a>` : ''}</td>
      <td>${esc(l.launch_video.replace('_', ' '))}</td><td class="num">${l.releases_90d}${l.releases_capped ? '+' : ''}</td></tr>`).join('');
}
function renderQualify() {
  const r = ranked();
  $('qualTable').innerHTML = `<tr><th>#</th><th>Lead</th><th>Why now</th><th class="num">Fresh</th><th class="num">Gap</th><th class="num">Source rate</th><th class="num">P(upgrade)</th><th>Tier</th><th class="num">Exp. MRR</th></tr>` +
    r.map((l, i) => `<tr style="${l.qualified ? '' : 'opacity:.5'}">
      <td>${i + 1}</td><td><b>${esc(l.company)}</b><div>${chipSrc(l)}</div></td><td class="note" style="max-width:340px">${l.why.map(esc).join(' · ')}</td>
      <td class="num">${l.fresh.toFixed(2)}</td><td class="num">${l.gap.toFixed(2)}</td><td class="num">${pct(learnedRate(l.source))}</td>
      <td class="num">${pct(l.p)}</td><td>${chipTier(l)}</td><td class="num"><b>${money(l.emrr)}</b>${l.qualified ? '' : '<div class="note">not qualified</div>'}</td></tr>`).join('');
}
function renderShowPicker(selectId) {
  const r = ranked().filter(l => l.feasible);
  const order = [...TODAY.map(id => r.find(x => x.id === id)).filter(Boolean), ...r.filter(x => !TODAY.includes(x.id))];
  $('vidPick').innerHTML = order.map(l => `<option value="${l.id}">${TODAY.includes(l.id) ? '★ ' : ''}${esc(l.company)} ${esc(l.release_version)}</option>`).join('');
  if (selectId) $('vidPick').value = selectId;
  showSelected();
}
function selectedLead() { return ranked().find(l => l.id === $('vidPick').value); }
function showSelected() {
  const l = selectedLead(); if (!l) return;
  drawFrame(cv().getContext('2d'), l, 0.9);
  $('clog').textContent = `## ${l.release_version || 'Latest'} — ${l.release_days_ago != null ? ago(l.release_days_ago) : ''}\n` + l.changelog.map(c => '- ' + c).join('\n') + (l.release_url ? `\n\n${l.release_url}` : '');
}
function renderSell() {
  const r = ranked(), ids = TODAY.length ? TODAY : r.filter(x => x.qualified).slice(0, 5).map(x => x.id);
  if (!ids.length) { $('pitches').innerHTML = '<div class="card empty">Run today’s cycle first.</div>'; return; }
  $('pitches').innerHTML = ids.map(id => r.find(x => x.id === id)).filter(Boolean).map(l => {
    const st = PITCH[l.id] || {}; const txt = st.text ?? draftPitch(l);
    const chan = l.email ? `email → ${esc(l.email)}` : `no contact yet → find via GitHub org / X (${esc(l.github || l.company)})`;
    return `<div class="card" style="margin-bottom:16px" id="p-${l.id}">
      <div class="flex" style="justify-content:space-between"><div><b>${esc(l.name || l.company)}</b> · ${esc(l.company)} ${chipSrc(l)} ${chipTier(l)} <span class="chip">playbook: ${playbook(l)}</span></div>
      <span class="status ${st.status || 'pending'}">${st.status || 'pending approval'}${st.outcome ? ' · outcome: ' + st.outcome : ''}</span></div>
      <div class="note" style="margin:6px 0">${chan}</div>
      <textarea class="msg" data-id="${l.id}">${esc(txt)}</textarea>
      <div class="flex" style="margin-top:8px">
        <button class="btn primary sm" data-act="approve" data-id="${l.id}">✓ Approve & queue</button>
        <button class="btn sm" data-act="skip" data-id="${l.id}">Skip</button>
        <button class="btn sm" data-go="show" data-id="${l.id}">▶ Preview video</button>
        <span class="note">Log outcome:</span>
        ${['no reply', 'replied', 'tried free', 'upgraded', 'sales call'].map(o => `<button class="btn sm" data-out="${o}" data-id="${l.id}" ${st.status !== 'approved' || st.outcome ? 'disabled' : ''}>${o}</button>`).join('')}
      </div></div>`;
  }).join('');
}
function bars(el, rows) {
  $(el).innerHTML = rows.map(r => `<div class="row"><span>${r.label}${r.sub ? `<div class="note">${r.sub}</div>` : ''}</span>
    <div class="bar"><i style="width:${Math.min(100, r.v * 100 / r.max)}%"></i>${r.prior != null ? `<i class="prior" style="width:${Math.min(100, r.prior * 100 / r.max)}%"></i>` : ''}</div><b style="text-align:right">${r.txt}</b></div>`).join('');
}
function renderLearn() {
  const s = STATS, f = s.funnel;
  $('learnKpis').innerHTML = [
    [f.contacted, 'contacted', `${s.simulated} simulated · ${s.real} real`],
    [f.contacted ? pct(f.paid / f.contacted) : '—', 'free → paid conversion', `${f.paid} upgrades`],
    [f.max_or_sales, 'Max or sales calls', 'the target outcome'],
    [money(s.mrr) + '/mo', 'new MRR (realised)', `${s.weeks} simulated week${s.weeks === 1 ? '' : 's'}`]
  ].map(([v, l, d]) => `<div class="card kpi"><div class="v">${v}</div><div class="l">${l}</div><div class="note">${d}</div></div>`).join('');
  const fm = Math.max(1, f.contacted);
  bars('funnel', [['Contacted', f.contacted], ['Replied', f.replied], ['Tried free', f.tried_free], ['Paid', f.paid], ['Max / sales', f.max_or_sales]]
    .map(([label, v]) => ({ label, v, max: fm, txt: v })));
  const mx = Math.max(0.3, ...Object.keys(SOURCES).map(k => Math.max(learnedRate(k), CFG.prior_rate[k])));
  bars('bySource', Object.keys(SOURCES).map(k => ({ label: SOURCES[k].label, sub: `${s.bySource[k].paid}/${s.bySource[k].contacted} contacted`, v: learnedRate(k), prior: CFG.prior_rate[k], max: mx, txt: pct(learnedRate(k)) })));
  const am = Math.max(0.2, ...Object.values(s.byAge).map(x => x.contacted ? x.paid / x.contacted : 0));
  bars('byAge', Object.entries(s.byAge).map(([k, x]) => ({ label: k, sub: `${x.paid}/${x.contacted}`, v: x.contacted ? x.paid / x.contacted : 0, max: am, txt: x.contacted ? pct(x.paid / x.contacted) : '—' })));
  $('recos').innerHTML = recommendations().map(r => `<div class="reco">${r}</div>`).join('');
}
function renderSetup() {
  $('cfg').value = JSON.stringify(Object.fromEntries(Object.entries(CFG).filter(([k]) => k !== 'watch_repos')), null, 2);
  $('repos').value = CFG.watch_repos.join('\n');
}
function renderAll() { renderKpis(); renderTop5(); renderFind(); renderQualify(); renderSell(); renderLearn(); }

// ---------- RUN ----------
const wait = ms => new Promise(r => setTimeout(r, ms));
async function runCycle() {
  const btn = $('runBtn'); btn.disabled = true; switchTab('run');
  const steps = [...document.querySelectorAll('.step')]; steps.forEach(s => s.className = 'step');
  const mark = async (i, ms = 450) => { steps[i].classList.add('on'); await wait(ms); steps[i].classList.replace('on', 'done'); };
  await mark(0);
  const r = ranked();
  // warm first: fill from warm qualified leads, then let cold compete only for the slots left
  const warmQ = r.filter(l => l.qualified && SOURCES[l.source].warm), coldQ = r.filter(l => l.qualified && !SOURCES[l.source].warm);
  const top = [...warmQ.slice(0, 4), ...coldQ].slice(0, 5);
  if (top.length < 5) top.push(...warmQ.slice(4, 4 + 5 - top.length));
  top.sort((a, b) => b.emrr - a.emrr);
  TODAY = top.map(l => l.id); store.set('today', TODAY);
  await mark(1);
  renderKpis(); renderTop5();
  steps[2].classList.add('on');
  renderShowPicker(TODAY[0]);
  play(selectedLead());
  await wait(500); steps[2].classList.replace('on', 'done');
  await mark(3); renderSell();
  steps[4].classList.add('on'); renderLearn();
  btn.disabled = false; toast(`Top prospect: ${top[0]?.company} · launch video ready · 5 pitches await approval`);
}

// ---------- events ----------
function switchTab(t) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('section.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + t));
  if (t === 'show' && !$('vidPick').options.length) renderShowPicker();
  if (t === 'setup') renderSetup();
  try { localStorage.setItem('adal_tab', t); } catch { }
}
$('nav').onclick = e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); };
$('runBtn').onclick = runCycle;
$('vidPick').onchange = showSelected;
$('playBtn').onclick = () => { const l = selectedLead(); l && play(l); };
$('recBtn').onclick = () => { const l = selectedLead(); l && record(l); };
document.body.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) { switchTab(go.dataset.go); if (go.dataset.go === 'show') { renderShowPicker(go.dataset.id); play(selectedLead()); } else document.getElementById('p-' + go.dataset.id)?.scrollIntoView({ behavior: 'smooth' }); return; }
  const a = e.target.closest('[data-act]');
  if (a) {
    const id = a.dataset.id;
    if (a.dataset.act === 'approve' || a.dataset.act === 'skip') {
      const ta = document.querySelector(`textarea[data-id="${id}"]`);
      PITCH[id] = { ...(PITCH[id] || {}), status: a.dataset.act === 'approve' ? 'approved' : 'skipped', text: ta?.value };
      save(); renderSell(); renderTop5(); toast(a.dataset.act === 'approve' ? 'Queued. Demo mode, nothing is actually sent.' : 'Skipped');
    }
    if (a.dataset.act === 'win7') { CFG.freshness_window_days = 7; save(); renderAll(); toast('Freshness window → 7 days. Ranking updated.'); }
    return;
  }
  const o = e.target.closest('[data-out]');
  if (o) {
    const l = ranked().find(x => x.id === o.dataset.id), k = o.dataset.out;
    recordOutcome(l, { replied: k !== 'no reply', tried_free: ['tried free', 'upgraded', 'sales call'].includes(k), paid: ['upgraded', 'sales call'].includes(k), tier: k === 'sales call' ? 'sales' : l.tier }, false);
    PITCH[l.id] = { ...(PITCH[l.id] || {}), outcome: k }; save(); renderSell(); renderTop5(); renderLearn(); toast('Outcome logged. Learning updated.');
  }
});
document.body.addEventListener('input', e => { if (e.target.matches('textarea.msg')) { const id = e.target.dataset.id; PITCH[id] = { ...(PITCH[id] || {}), text: e.target.value }; save(); } });
$('simBtn').onclick = () => { simulateWeek(); renderAll(); toast('Simulated 1 week'); };
$('sim3Btn').onclick = () => { for (let i = 0; i < 3; i++) simulateWeek(); renderAll(); toast('Simulated 3 weeks'); };
$('csvFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const rows = loadCSV(await f.text(), 'upload');
    LEADS = rows; store.set('upload', await f.text().catch(() => null));
    $('csvNote').textContent = `Loaded ${rows.length} contacts from ${f.name}. Contacts with a github column are fetched live.`;
    const gh = rows.filter(r => r.github);
    if (gh.length) {
      const { out } = await fetchLive(gh.map(r => r.github));
      out.forEach(o => { const r = rows.find(x => x.github === o.github); if (r) Object.assign(r, { release_version: o.release_version, release_days_ago: o.release_days_ago, releases_90d: o.releases_90d, changelog: o.changelog, release_url: o.release_url, launch_video: r.launch_video || o.launch_video }); });
    }
    TODAY = []; renderAll(); toast('List loaded');
  } catch (err) { $('csvNote').textContent = 'Could not parse CSV: ' + err.message; }
};
$('tplBtn').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([window.SAMPLE_CSV], { type: 'text/csv' })); a.download = 'adal_leads_template.csv'; a.click(); };
$('sampleBtn').onclick = () => { LEADS = loadCSV(window.SAMPLE_CSV, 'sample'); store.set('upload', null); TODAY = []; renderAll(); toast('Sample data loaded'); };
$('fetchBtn').onclick = async () => {
  CFG.watch_repos = $('repos').value.split('\n').map(s => s.trim()).filter(s => /^[\w.-]+\/[\w.-]+$/.test(s)); save();
  $('fetchNote').textContent = 'Fetching…';
  const { out, errs } = await fetchLive(CFG.watch_repos);
  LIVE = out; save(); renderAll();
  $('fetchNote').textContent = `${out.length} repos loaded${errs.length ? ` · ${errs.length} failed (${errs[0]})` : ''}`;
};
$('cfgSave').onclick = () => {
  try { const c = JSON.parse($('cfg').value); CFG = { ...c, watch_repos: CFG.watch_repos }; save(); renderAll(); $('cfgNote').textContent = 'Applied.'; }
  catch (e) { $('cfgNote').textContent = 'Invalid JSON: ' + e.message; }
};
$('cfgReset').onclick = () => { CFG = structuredClone(DEFAULT_CONFIG); save(); renderSetup(); renderAll(); $('cfgNote').textContent = 'Defaults restored.'; };
$('learnReset').onclick = () => { STATS = freshStats(); PITCH = {}; save(); renderAll(); toast('Learning reset'); };

// ---------- boot ----------
(function boot() {
  const up = store.get('upload', null);
  LEADS = loadCSV(up || window.SAMPLE_CSV, up ? 'upload' : 'sample');
  TODAY = store.get('today', []);
  renderAll();
  let t = 'run'; try { t = localStorage.getItem('adal_tab') || 'run'; } catch { }
  switchTab(t);
  if (/autosim/.test(location.hash)) for (let i = 0; i < 3; i++) simulateWeek(); // pre-warm learning for a demo
  if (/autorun/.test(location.hash)) runCycle(); // e.g. index.html#autorun for kiosk demos
  // pull live releases in the background on first load, so the demo mixes real public data with the sample warm lists
  if (!LIVE.length) fetchLive(CFG.watch_repos).then(({ out }) => { if (out.length) { LIVE = out; save(); renderAll(); } }).catch(() => { });
})();
