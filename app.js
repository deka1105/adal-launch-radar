/* AdaL Launch Radar — MVP.
 * Every place an LLM or AdaL's video agent would go is a plain function marked "SWAP POINT".
 * Find → Qualify → Show → Sell → Learn, all deterministic.
 */
'use strict';

// ---------- defaults (editable in Setup) ----------
const DEFAULT_CONFIG = {
  icp: { stages: ['Pre-seed', 'Seed', 'Series A', 'Series B'], regions: ['US', 'UK', 'EU'] },
  icp_fit: { match: 1.0, unknown: 0.85, outside_stage: 0.5, outside_region: 0.7, not_saas: 0.6 },
  plans: { pro: 20, max: 100, max_plus: 200, sales_est: 300 },
  plan_note: 'Paid plans are $20 / $100 / $200 a month. "max" is the Max tier price (still to confirm with AdaL). sales_est is the assumed monthly value of a Contact Sales deal.',
  freshness_window_days: 14,
  video_gap: { none: 1.0, screen_recording: 0.7, stale: 0.75, unknown: 0.8, produced: 0.2 },
  feasibility: { repo_or_changelog: 1.0, launch_notes_only: 0.7, nothing: 0.3 },
  // Starting assumptions for P(paid upgrade | contacted) by source. These are the Beta prior means.
  prior_rate: { ambassador: 0.18, london_rsvp: 0.12, popup: 0.10, hackathon: 0.08, github: 0.03, producthunt: 0.02, x_post: 0.03, linkedin_post: 0.025, cold: 0.02 },
  prior_strength: 12,
  tiers: { sales_min_releases_90d: 10, sales_min_team: 40, max_min_releases_90d: 4 },
  qualify_min_p: 0.06,
  funding_bonus: 0.15,
  followup_days: [3, 7],
  research_minutes_manual: 45,
  research_minutes_tool: 2,
  feeds_url: 'https://raw.githubusercontent.com/deka1105/adal-launch-radar/refs/heads/feeds/feeds.json',
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
  github: { label: 'GitHub releases', warm: false },
  producthunt: { label: 'Product Hunt', warm: false },
  x_post: { label: 'X launch posts', warm: false },
  linkedin_post: { label: 'LinkedIn launch posts', warm: false },
  cold: { label: 'Other cold', warm: false }
};
const ANGLES = { video_first: 'A · video first', question_first: 'B · question first' };
const TIER_LABEL = { pro: 'Pro $20', max: 'Max', sales: 'Contact Sales' };
const DAY = 864e5;

// ---------- storage (best effort) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('adal_' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('adal_' + k, JSON.stringify(v)); } catch { /* private mode */ } }
};
function mergeDeep(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const k in over) out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? mergeDeep(base[k], over[k]) : over[k];
  return out;
}

let CFG = mergeDeep(structuredClone(DEFAULT_CONFIG), store.get('cfg', null));
if (/adal-launch-radar\/feeds\/feeds\.json$/.test(CFG.feeds_url)) CFG.feeds_url = DEFAULT_CONFIG.feeds_url; // migrate old URL
let LEADS = [];                              // warm lists (CSV)
let LIVE = [];                               // daily feeds: GitHub, Product Hunt, X
let IMPORTED = store.get('imported', []);    // pasted X / LinkedIn posts
let FEEDMETA = null;
let STATS = mergeDeep(freshStats(), store.get('stats', null));
let PITCH = store.get('pitch', {});          // id -> {status, angle, text, sentAt, fu:[{due,done}], outcome}
let TODAY = [];
let CLOCK = store.get('clock', 0);           // demo clock offset in days (to show follow-ups coming due)
const NOW = () => Date.now() + CLOCK * DAY;

function freshStats() {
  const z = () => ({ contacted: 0, paid: 0 });
  return {
    bySource: Object.fromEntries(Object.keys(SOURCES).map(s => [s, z()])),
    byAge: { '0–7 days': z(), '8–14 days': z(), '15+ days': z() },
    byGap: {},
    byAngle: Object.fromEntries(Object.keys(ANGLES).map(a => [a, { contacted: 0, replied: 0, paid: 0 }])),
    funnel: { contacted: 0, replied: 0, tried_free: 0, paid: 0, max_or_sales: 0 },
    mrr: 0, weeks: 0, simulated: 0, real: 0, log: []
  };
}
const save = () => { store.set('cfg', CFG); store.set('stats', STATS); store.set('pitch', PITCH); store.set('imported', IMPORTED); store.set('clock', CLOCK); };

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
const toCSV = rows => { const h = Object.keys(rows[0] || {}); return [h.join(','), ...rows.map(r => h.map(k => /[",\n]/.test(String(r[k] ?? '')) ? `"${String(r[k]).replace(/"/g, '""')}"` : (r[k] ?? '')).join(','))].join('\n'); };
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const slug = s => String(s || '').toLowerCase().replace(/\W+/g, '');
function normalize(r, i, origin) {
  const src = SOURCES[r.source] ? r.source : 'cold';
  const cl = Array.isArray(r.changelog) ? r.changelog : String(r.changelog || '').split('|').map(s => s.trim()).filter(Boolean);
  return {
    id: origin + '-' + src + '-' + i + '-' + slug(r.company),
    origin, source: src, list_name: r.list_name || SOURCES[src].label,
    name: r.name || '', email: r.email || '', company: r.company || '(unknown)', role: r.role || '',
    website: r.website || '', github: r.github || '', twitter: r.twitter || r.handle || '', contact_url: r.contact_url || '',
    launch_video: r.launch_video || 'none', video_verified: r.video_verified ?? true,
    release_version: r.release_version || '', release_date: r.release_date || '', rel0: num(r.release_days_ago),
    release_url: r.release_url || r.post_url || '', releases_90d: num(r.releases_90d) ?? 0, releases_capped: !!r.releases_capped,
    team_size: num(r.team_size), stage: r.stage || '', funding_days_ago: num(r.funding_days_ago), region: r.region || '',
    saas: r.saas ?? null, signal: r.signal || '', changelog: cl, loaded_at: r.loaded_at || Date.now()
  };
}
function loadCSV(text, origin) { return parseCSV(text).map((r, i) => normalize(r, i, origin)); }
function relDays(l) {
  if (l.release_date) { const t = Date.parse(l.release_date); return isNaN(t) ? null : Math.max(0, Math.floor((NOW() - t) / DAY)); }
  return l.rel0 == null ? null : l.rel0 + CLOCK;
}

// ---------- FIND ----------
// Daily feeds come from scripts/find.mjs (GitHub Action → `feeds` branch). Bundled data/feeds.js is the offline fallback.
function applyFeeds(f) {
  if (!f?.leads) return;
  FEEDMETA = { generated_at: f.generated_at, counts: f.counts, modes: f.modes, errors: f.errors || [] };
  LIVE = f.leads.map((r, i) => normalize(r, i, 'live'));
}
async function loadRemoteFeeds() {
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(CFG.feeds_url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return false;
    const f = await r.json();
    if (!FEEDMETA || Date.parse(f.generated_at) > Date.parse(FEEDMETA.generated_at)) { applyFeeds(f); FEEDMETA.remote = true; return true; }
  } catch { }
  return false;
}
// In-browser GitHub refresh (anonymous API, 60 req/hr): replaces the GitHub part of the feed.
async function refreshGitHub(list) {
  const out = [], errs = [];
  for (const [i, full] of list.entries()) {
    try {
      const res = await fetch(`https://api.github.com/repos/${full}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(full + ': HTTP ' + res.status);
      const rels = (await res.json()).filter(r => !r.draft), l = rels[0];
      out.push(normalize({ company: full.split('/')[1], github: full, website: 'github.com/' + full, source: 'github', list_name: 'GitHub releases (live)',
        release_version: l?.tag_name || '', release_date: l?.published_at || '', release_url: l?.html_url || '',
        releases_90d: rels.filter(r => Date.now() - Date.parse(r.published_at) <= 90 * DAY).length, releases_capped: rels.length === 30,
        launch_video: /youtube\.com|youtu\.be|loom\.com|vimeo\.com|\.mp4|\.mov|<video|\.gif/i.test(l?.body || '') ? 'produced' : 'none',
        changelog: l ? (ParsePost.bullets(l.body, 4).length ? ParsePost.bullets(l.body, 4) : [l.name || l.tag_name]) : [] }, i, 'live'));
    } catch (e) { errs.push(e.message); }
  }
  return { out, errs };
}
// Pasted X / LinkedIn launch posts → leads. SWAP POINT: LLM extraction instead of ParsePost.
function importPosts(raw) {
  const posts = ParsePost.splitPasted(raw);
  const leads = posts.map((p, i) => {
    const x = ParsePost.parsePost(p.text, { url: p.url, handle: p.handle });
    return normalize({ ...x, name: x.author, twitter: p.channel === 'x' ? (p.handle || x.handle) : '', contact_url: p.url,
      source: p.channel === 'linkedin' ? 'linkedin_post' : 'x_post', list_name: (p.channel === 'linkedin' ? 'LinkedIn' : 'X') + ' launch post (pasted)',
      release_date: new Date(NOW()).toISOString(), video_verified: x.launch_video !== 'unknown', signal: x.is_launch ? 'launch' : 'not-a-launch' }, IMPORTED.length + i, 'import');
  });
  IMPORTED = [...IMPORTED, ...leads]; save();
  return leads;
}

// ---------- QUALIFY ----------
function learnedRate(src) {
  const p = CFG.prior_rate[src] ?? 0.02, k = CFG.prior_strength, s = STATS.bySource[src] || { contacted: 0, paid: 0 };
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
function icpFit(l) {
  const f = CFG.icp_fit, why = [];
  let fit = 1;
  if (!l.stage) fit *= f.unknown; else if (!CFG.icp.stages.includes(l.stage)) { fit *= f.outside_stage; why.push(`outside ICP stage (${l.stage})`); }
  if (l.region && !CFG.icp.regions.includes(l.region)) { fit *= f.outside_region; why.push(`outside ICP region (${l.region})`); }
  if (l.saas === false) { fit *= f.not_saas; why.push('not tagged SaaS'); }
  return { fit, why };
}
function feasibilityOf(l) {
  const F = CFG.feasibility;
  if (l.github || (l.changelog.length >= 2 && ['github', 'ambassador', 'london_rsvp', 'popup', 'hackathon'].includes(l.source))) return { v: F.repo_or_changelog, label: 'repo/CHANGELOG' };
  if (l.changelog.length) return { v: F.launch_notes_only, label: 'launch notes only' };
  return { v: F.nothing, label: 'nothing to build from' };
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
  const feas = feasibilityOf(l), icp = icpFit(l);
  const funded = l.funding_days_ago != null && l.funding_days_ago <= 180;
  const base = rateFn(l.source);
  let p = base * (0.15 + 2.2 * fresh * gap) * feas.v * icp.fit * (funded ? 1 + CFG.funding_bonus : 1);
  p = Math.min(0.75, p);
  const tier = tierOf(l), price = priceOf(tier);
  const feasible = feas.v >= 0.7;
  const qualified = feasible && fresh > 0.15 && p >= CFG.qualify_min_p && l.signal !== 'not-a-launch';
  const why = [];
  if (SOURCES[l.source].warm) why.push(l.list_name);
  if (l.release_days_ago != null) why.push(`shipped ${l.release_version && l.release_version !== 'launch' ? l.release_version : (l.source === 'producthunt' ? 'on Product Hunt' : 'a release')} ${ago(l.release_days_ago)}`);
  else why.push('no recent release');
  why.push({ none: 'no launch video', screen_recording: 'only a screen recording', stale: 'demo video is stale', produced: 'already has a produced video', unknown: 'launch video not verified' }[l.launch_video] || l.launch_video);
  const bigTeam = (l.team_size ?? 0) >= CFG.tiers.sales_min_team;
  if (l.releases_90d || bigTeam) why.push(`${l.releases_90d}${l.releases_capped ? '+' : ''} releases in 90d${bigTeam ? `, team of ${l.team_size}` : ''} → ${TIER_LABEL[tier]}`);
  if (funded) why.push('raised recently (tiebreaker)');
  why.push(...icp.why);
  if (feas.v < 1) why.push(feas.v >= 0.7 ? 'launch notes only (a lighter video without the repo)' : 'no repo/CHANGELOG, so AdaL can’t build the video yet');
  if (l.signal === 'not-a-launch') why.push('post doesn’t look like a launch');
  return { ...l, fresh, gap, feas: feas.v, feas_label: feas.label, icp: icp.fit, feasible, p, tier, price, emrr: p * price, qualified, why };
}
const ago = d => d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
const money = v => '$' + (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(v < 10 ? 2 : 1));
const pct = v => (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Warm contacts and feed signals are joined by repo or company: a warm contact whose company shipped today inherits that release.
function allLeads() {
  const keyOf = l => (l.github && l.github.toLowerCase()) || slug(l.company);
  const map = new Map();
  for (const l of [...LEADS, ...IMPORTED, ...LIVE]) {
    const k = keyOf(l), prev = map.get(k);
    if (!prev) { map.set(k, { ...l }); continue; }
    const lr = l.release_date || l.rel0 != null, pr = prev.release_date || prev.rel0 != null;
    if (lr && (!pr || relDays(l) < relDays(prev))) Object.assign(prev, {
      release_version: l.release_version, release_date: l.release_date, rel0: l.rel0, release_url: l.release_url, changelog: l.changelog,
      releases_90d: Math.max(prev.releases_90d, l.releases_90d), github: prev.github || l.github, joined: SOURCES[l.source].label,
      launch_video: prev.launch_video === 'none' || prev.launch_video === 'unknown' ? l.launch_video : prev.launch_video });
    for (const f of ['email', 'twitter', 'contact_url', 'website']) prev[f] = prev[f] || l[f];
  }
  return [...map.values()].map(l => ({ ...l, release_days_ago: relDays(l) }));
}
function ranked() {
  return allLeads().map(l => score(l)).sort((a, b) => b.emrr - a.emrr || (SOURCES[b.source].warm - SOURCES[a.source].warm));
}

// ---------- SHOW: launch video renderer ----------
// SWAP POINT: production sends repo + CHANGELOG to AdaL's video agent (see exportBrief). This canvas version shows the shape of the output.
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
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.fillStyle = `hsla(${(h + i * 25) % 360},80%,60%,0.08)`;
    ctx.arc((200 + i * 260 + t * 30 * (i % 2 ? 1 : -1)) % (W + 200), 140 + (i * 137) % 480, 120 + i * 30, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1 - out;
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
  const font = (w, px) => `${w} ${px}px Inter, system-ui, sans-serif`;
  const ver = l.release_version && l.release_version !== 'launch' ? l.release_version : 'Now live';
  if (s.kind === 'title') {
    ctx.font = font(600, 28); ctx.fillStyle = `hsl(${h},90%,75%)`;
    ctx.fillText('INTRODUCING', 120, 260 - 20 * (1 - ease));
    ctx.font = font(800, l.company.length > 16 ? 76 : 104); ctx.fillStyle = '#fff'; ctx.fillText(l.company, 120, 350 + 30 * (1 - ease));
    ctx.font = font(700, 54); ctx.fillStyle = `hsla(0,0%,100%,${ease * 0.85})`; ctx.fillText(ver, 120, 450);
  } else if (s.kind === 'feat') {
    ctx.font = font(800, 220); ctx.fillStyle = `hsla(${h},90%,70%,0.18)`; ctx.fillText(String(s.i + 1).padStart(2, '0'), 90, 360);
    ctx.font = font(600, 26); ctx.fillStyle = `hsl(${h},90%,75%)`; ctx.fillText(`WHAT'S NEW · ${s.i + 1}`, 140, 250);
    ctx.fillStyle = '#fff'; ctx.font = font(800, 60);
    wrap(ctx, s.t, 140 + 40 * (1 - ease), 340, 1000, 72);
    ctx.fillStyle = `hsl(${h},90%,65%)`; ctx.fillRect(140, 540, 600 * Math.min(1, st / s.dur), 6);
  } else {
    ctx.font = font(800, 84); ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText(`${l.company} ${ver === 'Now live' ? '' : ver}`.trim(), W / 2, 300 - 20 * (1 - ease));
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
  if (!l) return;
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
    download(new Blob(chunks, { type: 'video/webm' }), `${l.company.replace(/\W+/g, '_')}_${l.release_version || 'launch'}_launch.webm`);
    note.textContent = 'Downloaded.'; document.getElementById('recBtn').disabled = false;
  };
  document.getElementById('recBtn').disabled = true; note.textContent = `Rendering ${videoLength(l).toFixed(0)}s…`;
  rec.start(); play(l, () => setTimeout(() => rec.stop(), 150));
}
// The job spec handed to AdaL's real agent: everything it needs to make the production video.
function exportBrief(l) {
  let t = 0;
  const scenes = scenesFor(l).map(s => { const r = `| ${t.toFixed(1)}–${(t += s.dur).toFixed(1)}s | ${s.kind === 'title' ? `Title: ${l.company} ${l.release_version}` : s.kind === 'cta' ? `CTA: Available now · ${l.website || l.github}` : `Feature ${s.i + 1}: ${s.t}`} |`; return r; });
  return `# AdaL video brief: ${l.company} ${l.release_version}

**Prospect:** ${l.name || '—'} ${l.role ? `(${l.role})` : ''} · ${l.company} · ${SOURCES[l.source].label}${l.joined ? ` + ${l.joined}` : ''}
**Why now:** ${l.why.join(' · ')}
**Source material:** ${l.github ? `repo github.com/${l.github}` : 'no repo'}${l.release_url ? ` · release ${l.release_url}` : ''}${l.website ? ` · site ${l.website}` : ''}

## Release notes (input)
${l.changelog.map(c => '- ' + c).join('\n') || '- (none)'}

## Storyboard (${videoLength(l).toFixed(0)}s)
| Time | Scene |
|---|---|
${scenes.join('\n')}

## Voiceover
${l.company} ${l.release_version} is here. ${l.changelog.slice(0, 3).map(c => c.replace(/…$/, '')).join('. ')}. Available now${l.website ? ` at ${l.website}` : ''}.

## Deliverables
- 16:9 for X / LinkedIn, 9:16 for Shorts / Reels, captions burned in
- Brand: pull colours and logo from ${l.website || 'their site'}; use product screens from the repo if public
`;
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }

// ---------- SELL ----------
// SWAP POINT: production uses an LLM to personalise copy inside the same playbook, angle and guardrails.
function playbook(l) {
  if (l.tier === 'sales') return 'sales';
  if (SOURCES[l.source].warm) return 'warm';
  return 'upgrade';
}
function chooseAngle() { // Thompson sampling on reply rate
  let best = null, bv = -1;
  for (const a in ANGLES) { const s = STATS.byAngle[a]; const v = betaSample(1 + s.replied, 1 + s.contacted - s.replied); if (v > bv) { bv = v; best = a; } }
  return best;
}
function angleOf(l) { if (!PITCH[l.id]?.angle) { PITCH[l.id] = { ...(PITCH[l.id] || {}), angle: chooseAngle() }; save(); } return PITCH[l.id].angle; }
function channelOf(l) {
  if (l.email) return { kind: 'email', label: `email → ${l.email}`, href: null };
  if (l.twitter) return { kind: 'x', label: `X DM → @${l.twitter}`, href: `https://x.com/${l.twitter}` };
  if (l.contact_url) return { kind: 'web', label: `contact page → ${l.contact_url.replace(/^https?:\/\//, '').slice(0, 40)}`, href: l.contact_url.startsWith('http') ? l.contact_url : 'https://' + l.contact_url };
  return { kind: 'none', label: `no contact yet → find via GitHub org / X (${l.github || l.company})`, href: null };
}
function draftPitch(l, angle = angleOf(l)) {
  const first = (l.name || '').split(' ')[0] || 'there';
  const rel = l.release_version && l.release_version !== 'launch' ? l.release_version : (l.source === 'producthunt' ? 'your Product Hunt launch' : 'your latest release');
  const when = l.release_days_ago != null ? ago(l.release_days_ago) : 'recently';
  const plan = l.tier === 'max' ? `AdaL Max ($${CFG.plans.max}/mo)` : `AdaL Pro ($${CFG.plans.pro}/mo)`;
  const pb = playbook(l), warm = SOURCES[l.source].warm;
  const video = `[▶ ${l.company} ${rel} launch video, ${Math.round(videoLength(l))}s]`;
  const hello = warm ? `Great to have you at ${l.list_name}. ` : '';
  const subject = angle === 'video_first'
    ? (pb === 'sales' ? `${l.company}: a launch video for every release` : `Made your ${rel} launch video`)
    : `Quick question about ${rel}`;
  const open = angle === 'video_first'
    ? `${hello}Saw ${l.company} shipped ${rel} ${when}, so we turned the release notes into a launch video. It's yours to post, free:\n${video}`
    : `${hello}Did ${rel} (shipped ${when}) get a launch video? In case not, we made one from your release notes:\n${video}`;
  const close = pb === 'sales'
    ? `You've shipped ${l.releases_90d}${l.releases_capped ? '+' : ''} releases in 90 days. Teams at that pace usually want this running on every release, with brand templates and seats. Worth a 20-minute call to scope it?`
    : pb === 'warm'
      ? `You're shipping ${l.releases_90d ? l.releases_90d + ' releases a quarter' : 'regularly'}, so ${plan} would make one of these for every release straight from your repo. Want me to set it up on your next one?`
      : `You can make the next one yourself, free on your ChatGPT plan. ${plan} gets you one for every release.`;
  return `Subject: ${subject}\n\nHi ${first},\n\n${open}\n\n${close}\n\n— AdaL team`;
}
function shortPitch(l) { // for X DMs / contact forms
  const rel = l.release_version && l.release_version !== 'launch' ? l.release_version : 'your launch';
  return `Hi${l.name ? ' ' + l.name.split(' ')[0] : ''}! Saw ${l.company} shipped ${rel}. We made a launch video from the release notes, free to post: [video link]. Want the next one made automatically?`;
}
function followupText(l, n) {
  const rel = l.release_version && l.release_version !== 'launch' ? l.release_version : 'the launch';
  return n === 0
    ? `Subject: Re: ${l.company} ${rel}\n\nHi ${(l.name || '').split(' ')[0] || 'there'}, bumping this in case it got buried. The ${rel} video is still yours to use. Happy to cut a 9:16 version for Reels/Shorts too.`
    : `Subject: Last one from me\n\nHi ${(l.name || '').split(' ')[0] || 'there'}, last note. When you ship your next release, reply "next" and we'll have the video ready the same day, free.`;
}
function markSent(id) {
  const p = PITCH[id] = { ...(PITCH[id] || {}) };
  if (p.sentAt) return;
  p.status = 'sent'; p.sentAt = NOW(); p.fu = CFG.followup_days.map(d => ({ due: p.sentAt + d * DAY, done: false }));
  save();
}
function dueFollowups() {
  const r = ranked(), byId = Object.fromEntries(r.map(x => [x.id, x])), out = [];
  for (const [id, p] of Object.entries(PITCH)) {
    if (!p.fu || !byId[id]) continue;
    if (p.outcome && p.outcome !== 'no reply') continue; // they replied: stop the sequence
    p.fu.forEach((f, n) => { if (!f.done) out.push({ id, n, due: f.due, overdue: f.due <= NOW(), l: byId[id] }); });
  }
  return out.sort((a, b) => a.due - b.due);
}

// ---------- LEARN ----------
function ageBucket(d) { return d <= 7 ? '0–7 days' : d <= 14 ? '8–14 days' : '15+ days'; }
function recordOutcome(l, o, simulated, angle) {
  const s = STATS; s.funnel.contacted++;
  (s.bySource[l.source] = s.bySource[l.source] || { contacted: 0, paid: 0 }).contacted++;
  const b = ageBucket(l.release_days_ago ?? 99); s.byAge[b].contacted++;
  s.byGap[l.launch_video] = s.byGap[l.launch_video] || { contacted: 0, paid: 0 }; s.byGap[l.launch_video].contacted++;
  const A = angle && s.byAngle[angle]; if (A) { A.contacted++; if (o.replied) A.replied++; if (o.paid) A.paid++; }
  if (o.replied) s.funnel.replied++;
  if (o.tried_free) s.funnel.tried_free++;
  if (o.paid) {
    s.funnel.paid++; s.bySource[l.source].paid++; s.byAge[b].paid++; s.byGap[l.launch_video].paid++;
    if (o.tier !== 'pro') s.funnel.max_or_sales++;
    s.mrr += priceOf(o.tier);
  }
  simulated ? s.simulated++ : s.real++;
  s.log.push({ at: new Date(NOW()).toISOString(), company: l.company, source: l.source, angle: angle || '', days_since_release: l.release_days_ago ?? '',
    launch_video: l.launch_video, tier: o.tier, replied: +!!o.replied, tried_free: +!!o.tried_free, paid: +!!o.paid, simulated: +!!simulated });
  if (s.log.length > 3000) s.log.splice(0, s.log.length - 3000);
}
// Hidden "true" world for the simulator. The model doesn't see these numbers and has to learn them.
// Story: pop-up operators rarely ship software; hackathon builders who just shipped convert better than assumed; the video-first angle gets more replies.
const TRUTH = { ambassador: 0.20, london_rsvp: 0.13, popup: 0.035, hackathon: 0.17, github: 0.03, producthunt: 0.015, x_post: 0.04, linkedin_post: 0.02, cold: 0.02 };
const TRUTH_AGE = d => d <= 7 ? 1.7 : d <= 14 ? 0.8 : 0.3;
const TRUTH_GAP = { none: 1.3, screen_recording: 1.0, stale: 1.0, unknown: 1.0, produced: 0.35 };
const TRUTH_ANGLE = { video_first: 1.3, question_first: 0.8 };
function simulateWeek(n = 25) {
  const pool = allLeads();
  if (!pool.length) return;
  // Thompson sampling: draw a plausible rate per source from its posterior, then contact the best n under that draw (explores sources it's unsure about).
  const draw = {}; for (const s in SOURCES) { const k = CFG.prior_strength, p = CFG.prior_rate[s] ?? 0.02, st = STATS.bySource[s];
    draw[s] = betaSample(p * k + st.paid, (1 - p) * k + st.contacted - st.paid); }
  const candidates = [];
  for (let i = 0; i < 4; i++) for (const l of pool) candidates.push(score({ ...l, release_days_ago: Math.floor(Math.random() * 30) }, s => draw[s]));
  candidates.filter(c => c.feasible).sort((a, b) => b.emrr - a.emrr).slice(0, n).forEach(c => {
    const angle = chooseAngle();
    const tp = Math.min(0.8, TRUTH[c.source] * TRUTH_AGE(c.release_days_ago) * (TRUTH_GAP[c.launch_video] ?? 1) * TRUTH_ANGLE[angle]);
    const paid = Math.random() < tp;
    const replied = paid || Math.random() < Math.min(0.85, 0.12 * TRUTH_ANGLE[angle] + tp * 1.5);
    const tried = paid || (replied && Math.random() < 0.55);
    recordOutcome(c, { replied, tried_free: tried, paid, tier: c.tier }, true, angle);
  });
  STATS.weeks++; save();
}
function probABetter(a, b, draws = 4000) { // P(reply rate of A > B) from Beta posteriors
  let w = 0; for (let i = 0; i < draws; i++) if (betaSample(1 + a.replied, 1 + a.contacted - a.replied) > betaSample(1 + b.replied, 1 + b.contacted - b.replied)) w++;
  return w / draws;
}
function recommendations() {
  const out = [], s = STATS;
  for (const k of Object.keys(SOURCES).filter(k => SOURCES[k].warm)) {
    const ls = allLeads().filter(l => l.source === k); if (ls.length < 3) continue;
    const ok = ls.filter(l => l.github || l.changelog.length).length;
    if (ok / ls.length < 0.4) out.push(`<b>${SOURCES[k].label}</b>: only ${ok} of ${ls.length} contacts have a repo or release AdaL can work from. Treat this list as community and brand, not pipeline.`);
  }
  const due = dueFollowups().filter(f => f.overdue).length;
  if (due) out.push(`${due} follow-up${due > 1 ? 's are' : ' is'} due. See the Today tab.`);
  if (s.funnel.contacted < 20) return [...out, 'Not enough outcomes yet. Simulate a week, log outcomes in Sell, or import a CRM export.'];
  Object.keys(SOURCES).map(k => ({ k, prior: CFG.prior_rate[k], now: learnedRate(k), n: s.bySource[k].contacted })).filter(r => r.n >= 5).forEach(r => {
    const ratio = r.now / r.prior;
    if (ratio > 1.3) out.push(`<b>${SOURCES[r.k].label}</b> converts at ${pct(r.now)} vs the ${pct(r.prior)} assumed. Give it more time: follow up faster and invite these people to the next event.`);
    if (ratio < 0.7) out.push(`<b>${SOURCES[r.k].label}</b> converts at ${pct(r.now)} vs the ${pct(r.prior)} assumed. ${SOURCES[r.k].warm ? 'Keep it for community, but stop treating it as pipeline.' : 'Lower its share of the daily slots.'}`);
  });
  const a = s.byAge['0–7 days'], b = s.byAge['8–14 days'];
  if (a.contacted >= 8 && b.contacted >= 8) {
    const ra = a.paid / a.contacted, rb = b.paid / b.contacted;
    if (ra > rb * 1.5 && CFG.freshness_window_days > 7) out.push(`Leads contacted within 7 days of a release convert ${(ra / Math.max(rb, 0.001)).toFixed(1)}× better than at 8–14 days. <button class="btn sm" data-act="win7">Tighten freshness window to 7 days</button>`);
  }
  const A = s.byAngle.video_first, B = s.byAngle.question_first;
  if (A.contacted >= 10 && B.contacted >= 10) {
    const pA = probABetter(A, B);
    const lead = pA >= 0.5 ? ['A · video first', A, B, pA] : ['B · question first', B, A, 1 - pA];
    out.push(pA >= 0.9 || pA <= 0.1
      ? `Message test: <b>${lead[0]}</b> wins, with ${pct(lead[1].replied / lead[1].contacted)} vs ${pct(lead[2].replied / lead[2].contacted)} replies (P(better) = ${pct(lead[3])}). Thompson sampling is already sending it more often.`
      : `Message test: ${lead[0]} is ahead (P(better) = ${pct(lead[3])}) but the result isn’t conclusive yet. Keep testing.`);
  }
  const pr = s.byGap.produced, no = s.byGap.none;
  if (pr && no && pr.contacted >= 5 && no.contacted >= 5 && pr.paid / pr.contacted < 0.5 * no.paid / no.contacted)
    out.push('Teams that already have a produced launch video rarely upgrade. The video-gap signal is doing real work, so keep its weight.');
  if (!out.length) out.push('Learned rates are close to the starting assumptions. Keep collecting outcomes.');
  return out;
}
const OUTCOMES = { 'no reply': {}, replied: { replied: 1 }, 'tried free': { replied: 1, tried_free: 1 }, upgraded: { replied: 1, tried_free: 1, paid: 1 }, 'sales call': { replied: 1, tried_free: 1, paid: 1, sales: 1 } };
function logOutcome(l, k, simulated = false) {
  const o = OUTCOMES[k] || {};
  recordOutcome(l, { replied: !!o.replied, tried_free: !!o.tried_free, paid: !!o.paid, tier: o.sales ? 'sales' : l.tier }, simulated, PITCH[l.id]?.angle);
}
function importOutcomes(text) { // CRM export: company,outcome[,angle]
  const rows = parseCSV(text), r = ranked(); let n = 0, miss = 0;
  for (const row of rows) {
    const k = (row.outcome || '').toLowerCase().trim(); if (!OUTCOMES[k]) { miss++; continue; }
    const l = r.find(x => slug(x.company) === slug(row.company)) || { company: row.company, source: SOURCES[row.source] ? row.source : 'cold', launch_video: row.launch_video || 'unknown', release_days_ago: num(row.days_since_release), tier: 'pro' };
    const o = OUTCOMES[k];
    recordOutcome(l, { replied: !!o.replied, tried_free: !!o.tried_free, paid: !!o.paid, tier: o.sales ? 'sales' : (l.tier || 'pro') }, false, ANGLES[row.angle] ? row.angle : PITCH[l.id]?.angle);
    if (l.id) PITCH[l.id] = { ...(PITCH[l.id] || {}), outcome: k };
    n++;
  }
  save(); return { n, miss };
}

// ---------- RENDER ----------
const $ = id => document.getElementById(id);
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); setTimeout(() => e.classList.remove('on'), 2000); }
function chipSrc(l) { const live = l.origin === 'live' || l.origin === 'import'; return `<span class="chip ${SOURCES[l.source].warm ? 'warm' : ''} ${live ? 'live' : ''}">${l.origin === 'live' ? 'LIVE · ' : l.origin === 'import' ? 'IMPORTED · ' : ''}${esc(SOURCES[l.source].label)}</span>${l.joined ? `<span class="chip live">+ ${esc(l.joined)}</span>` : ''}`; }
function chipTier(l) { return `<span class="chip tier-${l.tier}">${TIER_LABEL[l.tier]}${l.tier === 'max' ? ' $' + CFG.plans.max : ''}</span>`; }
const sinceTxt = iso => { const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? 'under an hour ago' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };

function renderKpis() {
  const all = allLeads(), r = ranked(), q = r.filter(x => x.qualified);
  const pipe = q.reduce((a, x) => a + x.emrr, 0);
  const warm = all.filter(l => SOURCES[l.source].warm).length;
  const saved = (CFG.research_minutes_manual - CFG.research_minutes_tool) * r.length / 60;
  $('kpis').innerHTML = [
    [all.length, 'contacts scanned', `${warm} warm · ${all.length - warm} from GitHub / PH / X`],
    [`${q.length} (${pct(q.length / Math.max(1, r.length))})`, 'qualified', 'just shipped + AdaL can build the video'],
    [money(pipe) + '/mo', 'expected MRR in pipeline', 'Σ P(upgrade) × plan price'],
    [saved.toFixed(1) + ' h', 'research time saved', `${CFG.research_minutes_manual}→${CFG.research_minutes_tool} min per prospect (assumption)`]
  ].map(([v, l, d]) => `<div class="card kpi"><div class="v">${v}</div><div class="l">${l}</div><div class="note">${d}</div></div>`).join('');
}
function statusTxt(id) { const p = PITCH[id] || {}; return `${p.status || 'pending approval'}${p.outcome ? ' · ' + p.outcome : ''}`; }
function renderTop5() {
  const r = ranked(), byId = Object.fromEntries(r.map(x => [x.id, x]));
  const list = TODAY.map(id => byId[id]).filter(Boolean);
  if (list.length) $('top5').innerHTML = `<h3>Top 5: who to contact today, and why now</h3>` + list.map((l, i) => `
    <div class="prospect ${i === 0 ? 'top' : ''}">
      <div class="rank">${i + 1}</div>
      <div><b>${esc(l.name || l.company)}</b>${l.name ? ` · ${esc(l.role)}${l.role ? ' @ ' : ''}${esc(l.company)}` : ''} ${chipSrc(l)} ${chipTier(l)}
        <div class="why">${l.why.map(esc).join(' · ')}</div>
        <div class="flex" style="margin-top:6px"><button class="btn sm" data-go="show" data-id="${l.id}">▶ Video</button><button class="btn sm" data-go="sell" data-id="${l.id}">✉ Pitch</button>
        <span class="status ${PITCH[l.id]?.status || 'pending'}">${statusTxt(l.id)}</span></div>
      </div>
      <div class="money">${money(l.emrr)}<small>${pct(l.p)} × ${money(l.price)}</small></div>
    </div>`).join('');
  const fu = dueFollowups();
  $('followups').innerHTML = `<div class="flex" style="justify-content:space-between"><h3 style="margin:0">Follow-ups</h3>
      <span class="flex"><span class="note">Demo clock: ${CLOCK ? `+${CLOCK} days` : 'today'}</span><button class="btn sm" data-act="clock">⏩ +3 days</button>${CLOCK ? '<button class="btn sm" data-act="clock0">reset</button>' : ''}</span></div>` +
    (fu.length ? fu.map(f => `<div class="prospect" style="grid-template-columns:1fr auto"><div><b>${esc(f.l.name || f.l.company)}</b> · follow-up ${f.n + 1} of ${CFG.followup_days.length}
      <div class="why">${f.overdue ? '<b style="color:var(--warn)">due now</b>' : 'due ' + new Date(f.due).toLocaleDateString()} · stops automatically when they reply</div>
      <textarea class="msg" style="min-height:90px;margin-top:6px" readonly>${esc(followupText(f.l, f.n))}</textarea></div>
      <div class="flex" style="flex-direction:column"><button class="btn sm primary" data-act="fusend" data-id="${f.id}" data-n="${f.n}" ${f.overdue ? '' : 'disabled'}>Send</button><button class="btn sm" data-act="fuskip" data-id="${f.id}" data-n="${f.n}">Skip</button></div></div>`).join('')
      : '<div class="note" style="margin-top:8px">No follow-ups scheduled. Approve and send a pitch in Sell to start a sequence: day 3 and day 7, which stops on reply.</div>');
}
function renderFind() {
  const all = allLeads();
  $('sourceCards').innerHTML = Object.entries(SOURCES).filter(([k]) => k !== 'cold' || all.some(l => l.source === 'cold')).map(([k, s]) => {
    const n = all.filter(l => l.source === k).length;
    const mode = { github: FEEDMETA?.modes?.github, producthunt: FEEDMETA?.modes?.producthunt, x_post: FEEDMETA?.modes?.x ? FEEDMETA.modes.x + ' + paste' : 'paste', linkedin_post: 'paste' }[k];
    return `<div class="card kpi"><div class="v">${n}</div><div class="l">${s.label}</div><div class="note">${s.warm ? 'Warm · scored first' : 'Cold · ' + (mode || 'fills remaining slots')}</div></div>`;
  }).join('');
  $('feedStatus').innerHTML = FEEDMETA
    ? `<b>Daily feed</b> generated ${sinceTxt(FEEDMETA.generated_at)} ${FEEDMETA.remote ? '(from the daily GitHub Action)' : '(bundled snapshot; the daily Action publishes to the <code>feeds</code> branch)'} · GitHub ${FEEDMETA.counts.github} · Product Hunt ${FEEDMETA.counts.producthunt} · X ${FEEDMETA.counts.x}${FEEDMETA.errors.length ? ` · <span style="color:var(--bad)">${FEEDMETA.errors.length} source error(s)</span>` : ''}`
    : 'No daily feed loaded. Run <code>node scripts/find.mjs</code> or wait for the GitHub Action.';
  $('findTable').innerHTML = `<tr><th>Contact</th><th>Source</th><th>Latest release / launch</th><th>Launch video</th><th class="num">Releases/90d</th></tr>` +
    all.slice().sort((a, b) => (SOURCES[b.source].warm - SOURCES[a.source].warm) || ((a.release_days_ago ?? 999) - (b.release_days_ago ?? 999))).map(l => `<tr>
      <td><b>${esc(l.company)}</b><div class="note">${esc(l.name)} ${l.role ? '· ' + esc(l.role) : ''}</div></td>
      <td>${chipSrc(l)}<div class="note">${esc(l.list_name)}</div></td>
      <td>${l.release_days_ago != null ? esc(l.release_version && l.release_version !== 'launch' ? l.release_version : 'launch') + ' · ' + ago(l.release_days_ago) : '<span class="note">none found</span>'}${l.release_url ? ` <a href="${esc(l.release_url)}" target="_blank" rel="noopener">↗</a>` : ''}<div class="note">${esc(l.changelog[0] || '')}</div></td>
      <td>${esc(l.launch_video.replace('_', ' '))}</td><td class="num">${l.releases_90d}${l.releases_capped ? '+' : ''}</td></tr>`).join('');
}
function renderQualify() {
  const r = ranked();
  $('qualTable').innerHTML = `<tr><th>#</th><th>Lead</th><th>Why now</th><th class="num">Fresh</th><th class="num">Gap</th><th class="num">ICP fit</th><th class="num">Build</th><th class="num">Source rate</th><th class="num">P(upgrade)</th><th>Tier</th><th class="num">Exp. MRR</th></tr>` +
    r.map((l, i) => `<tr style="${l.qualified ? '' : 'opacity:.5'}">
      <td>${i + 1}</td><td><b>${esc(l.company)}</b><div>${chipSrc(l)}</div></td><td class="note" style="max-width:320px">${l.why.map(esc).join(' · ')}</td>
      <td class="num">${l.fresh.toFixed(2)}</td><td class="num">${l.gap.toFixed(2)}</td><td class="num">${l.icp.toFixed(2)}</td><td class="num" title="${esc(l.feas_label)}">${l.feas.toFixed(1)}</td><td class="num">${pct(learnedRate(l.source))}</td>
      <td class="num">${pct(l.p)}</td><td>${chipTier(l)}</td><td class="num"><b>${money(l.emrr)}</b>${l.qualified ? '' : '<div class="note">not qualified</div>'}</td></tr>`).join('');
}
function renderShowPicker(selectId) {
  const r = ranked().filter(l => l.feasible);
  const order = [...TODAY.map(id => r.find(x => x.id === id)).filter(Boolean), ...r.filter(x => !TODAY.includes(x.id))];
  $('vidPick').innerHTML = order.map(l => `<option value="${l.id}">${TODAY.includes(l.id) ? '★ ' : ''}${esc(l.company)} ${esc(l.release_version)}</option>`).join('');
  if (selectId && order.some(l => l.id === selectId)) $('vidPick').value = selectId;
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
    const st = PITCH[l.id] || {}, angle = angleOf(l), ch = channelOf(l);
    const txt = st.text ?? (ch.kind === 'email' || ch.kind === 'none' ? draftPitch(l, angle) : shortPitch(l));
    const approved = st.status === 'approved' || st.status === 'sent';
    const sendBtn = !approved ? '' : ch.kind === 'email' ? `<a class="btn primary sm" data-send="${l.id}" href="${mailto(l, txt)}">✉ Open in mail app</a>`
      : ch.href ? `<a class="btn primary sm" data-send="${l.id}" href="${esc(ch.href)}" target="_blank" rel="noopener">Open ${ch.kind === 'x' ? 'X profile' : 'contact page'} ↗</a>` : '';
    return `<div class="card" style="margin-bottom:16px" id="p-${l.id}">
      <div class="flex" style="justify-content:space-between"><div><b>${esc(l.name || l.company)}</b> · ${esc(l.company)} ${chipSrc(l)} ${chipTier(l)} <span class="chip">playbook: ${playbook(l)}</span> <span class="chip sim">angle ${ANGLES[angle]}</span></div>
      <span class="status ${st.status || 'pending'}">${statusTxt(l.id)}</span></div>
      <div class="note" style="margin:6px 0">${esc(ch.label)}</div>
      <textarea class="msg" data-id="${l.id}" ${st.sentAt ? 'readonly' : ''}>${esc(txt)}</textarea>
      <div class="flex" style="margin-top:8px">
        ${!approved ? `<button class="btn primary sm" data-act="approve" data-id="${l.id}">✓ Approve</button><button class="btn sm" data-act="skip" data-id="${l.id}">Skip</button>` : ''}
        ${sendBtn}${approved ? `<button class="btn sm" data-act="copy" data-id="${l.id}">⧉ Copy & mark sent</button>` : ''}
        <button class="btn sm" data-go="show" data-id="${l.id}">▶ Video</button>
        <span class="note">Outcome:</span>
        ${Object.keys(OUTCOMES).map(o => `<button class="btn sm" data-out="${o}" data-id="${l.id}" ${!st.sentAt || st.outcome ? 'disabled' : ''}>${o}</button>`).join('')}
      </div>
      ${st.sentAt ? `<div class="note" style="margin-top:6px">Sent ${new Date(st.sentAt).toLocaleDateString()} · follow-ups on day ${CFG.followup_days.join(' and ')} unless they reply</div>` : ''}</div>`;
  }).join('');
}
function mailto(l, txt) {
  const m = txt.match(/^Subject: (.*)\n\n([\s\S]*)$/);
  return `mailto:${encodeURIComponent(l.email)}?subject=${encodeURIComponent(m ? m[1] : 'AdaL')}&body=${encodeURIComponent(m ? m[2] : txt)}`;
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
  const keys = Object.keys(SOURCES).filter(k => k !== 'cold' || s.bySource.cold.contacted);
  const mx = Math.max(0.3, ...keys.map(k => Math.max(learnedRate(k), CFG.prior_rate[k] ?? 0)));
  bars('bySource', keys.map(k => ({ label: SOURCES[k].label, sub: `${s.bySource[k].paid}/${s.bySource[k].contacted} contacted`, v: learnedRate(k), prior: CFG.prior_rate[k], max: mx, txt: pct(learnedRate(k)) })));
  const am = Math.max(0.2, ...Object.values(s.byAge).map(x => x.contacted ? x.paid / x.contacted : 0));
  bars('byAge', Object.entries(s.byAge).map(([k, x]) => ({ label: k, sub: `${x.paid}/${x.contacted}`, v: x.contacted ? x.paid / x.contacted : 0, max: am, txt: x.contacted ? pct(x.paid / x.contacted) : '—' })));
  const rm = Math.max(0.3, ...Object.values(s.byAngle).map(x => x.contacted ? x.replied / x.contacted : 0));
  bars('byAngle', Object.entries(s.byAngle).map(([k, x]) => ({ label: ANGLES[k], sub: `${x.replied} replies / ${x.contacted} sent`, v: x.contacted ? x.replied / x.contacted : 0, max: rm, txt: x.contacted ? pct(x.replied / x.contacted) : '—' })));
  $('recos').innerHTML = recommendations().map(r => `<div class="reco">${r}</div>`).join('');
}
function renderSetup() {
  $('cfg').value = JSON.stringify(Object.fromEntries(Object.entries(CFG).filter(([k]) => k !== 'watch_repos')), null, 2);
  $('repos').value = CFG.watch_repos.join('\n');
}
function renderAll() { renderKpis(); renderTop5(); renderFind(); renderQualify(); renderSell(); renderLearn(); }

// ---------- RUN ----------
const wait = ms => new Promise(r => setTimeout(r, ms));
function pickToday() {
  const r = ranked();
  // warm first: up to 4 slots from warm qualified leads, cold competes for what's left
  const warmQ = r.filter(l => l.qualified && SOURCES[l.source].warm), coldQ = r.filter(l => l.qualified && !SOURCES[l.source].warm);
  const top = [...warmQ.slice(0, 4), ...coldQ].slice(0, 5);
  if (top.length < 5) top.push(...warmQ.slice(4, 4 + 5 - top.length));
  return top.sort((a, b) => b.emrr - a.emrr);
}
async function runCycle() {
  const btn = $('runBtn'); btn.disabled = true; switchTab('run');
  const steps = [...document.querySelectorAll('.step')]; steps.forEach(s => s.className = 'step');
  const mark = async (i, ms = 450) => { steps[i].classList.add('on'); await wait(ms); steps[i].classList.replace('on', 'done'); };
  steps[0].classList.add('on'); await loadRemoteFeeds(); await wait(300); steps[0].classList.replace('on', 'done');
  const top = pickToday();
  TODAY = top.map(l => l.id); store.set('today', TODAY);
  await mark(1);
  renderAll();
  steps[2].classList.add('on');
  renderShowPicker(TODAY[0]);
  play(selectedLead());
  await wait(500); steps[2].classList.replace('on', 'done');
  await mark(3); renderSell();
  steps[4].classList.add('on'); renderLearn();
  btn.disabled = false; toast(`Top prospect: ${top[0]?.company} · launch video ready · ${top.length} pitches await approval`);
  window.onCycleDone && window.onCycleDone();
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
$('playBtn').onclick = () => play(selectedLead());
$('recBtn').onclick = () => { const l = selectedLead(); l && record(l); };
$('briefExport').onclick = () => { const l = selectedLead(); l && download(new Blob([exportBrief(l)], { type: 'text/markdown' }), `AdaL_brief_${l.company.replace(/\W+/g, '_')}.md`); };
$('briefCopy').onclick = async () => { const l = selectedLead(); if (!l) return; try { await navigator.clipboard.writeText(exportBrief(l)); toast('Brief copied. Paste it into AdaL.'); } catch { toast('Clipboard blocked. Use Download instead.'); } };
document.body.addEventListener('click', async e => {
  const go = e.target.closest('[data-go]');
  if (go) { switchTab(go.dataset.go); if (go.dataset.go === 'show') { renderShowPicker(go.dataset.id); play(selectedLead()); } else document.getElementById('p-' + go.dataset.id)?.scrollIntoView({ behavior: 'smooth' }); return; }
  const send = e.target.closest('[data-send]');
  if (send) { markSent(send.dataset.send); setTimeout(() => { renderSell(); renderTop5(); }, 50); toast('Marked as sent. Follow-ups scheduled.'); return; }
  const a = e.target.closest('[data-act]');
  if (a) {
    const id = a.dataset.id, act = a.dataset.act;
    if (act === 'approve' || act === 'skip') {
      const ta = document.querySelector(`textarea[data-id="${id}"]`);
      PITCH[id] = { ...(PITCH[id] || {}), status: act === 'approve' ? 'approved' : 'skipped', text: ta?.value };
      save(); renderSell(); renderTop5(); toast(act === 'approve' ? 'Approved. Send it with your own mail app or X.' : 'Skipped');
    }
    if (act === 'copy') {
      const ta = document.querySelector(`textarea[data-id="${id}"]`);
      try { await navigator.clipboard.writeText(ta.value); } catch { }
      markSent(id); renderSell(); renderTop5(); toast('Copied and marked as sent. Follow-ups scheduled.');
    }
    if (act === 'fusend' || act === 'fuskip') { const f = PITCH[id]?.fu?.[+a.dataset.n]; if (f) { f.done = act === 'fusend' ? 'sent' : 'skipped'; save(); renderTop5(); toast(act === 'fusend' ? 'Follow-up sent' : 'Follow-up skipped'); } }
    if (act === 'clock') { CLOCK += 3; save(); renderAll(); toast(`Demo clock moved to +${CLOCK} days`); }
    if (act === 'clock0') { CLOCK = 0; save(); renderAll(); }
    if (act === 'win7') { CFG.freshness_window_days = 7; save(); renderAll(); toast('Freshness window → 7 days. Ranking updated.'); }
    return;
  }
  const o = e.target.closest('[data-out]');
  if (o) {
    const l = ranked().find(x => x.id === o.dataset.id), k = o.dataset.out;
    logOutcome(l, k); PITCH[l.id] = { ...(PITCH[l.id] || {}), outcome: k };
    save(); renderSell(); renderTop5(); renderLearn(); toast('Outcome logged. Learning updated.');
  }
});
document.body.addEventListener('input', e => { if (e.target.matches('textarea.msg[data-id]')) { const id = e.target.dataset.id; PITCH[id] = { ...(PITCH[id] || {}), text: e.target.value }; save(); } });
$('simBtn').onclick = () => { simulateWeek(); renderAll(); toast('Simulated 1 week'); };
$('sim3Btn').onclick = () => { for (let i = 0; i < 3; i++) simulateWeek(); renderAll(); toast('Simulated 3 weeks'); };
$('postImport').onclick = () => {
  const added = importPosts($('postPaste').value);
  const launches = added.filter(l => l.signal !== 'not-a-launch').length;
  $('postNote').textContent = `Imported ${added.length} post${added.length === 1 ? '' : 's'} (${launches} look like launches).`;
  $('postPaste').value = ''; renderAll();
};
$('postClear').onclick = () => { IMPORTED = []; save(); renderAll(); $('postNote').textContent = 'Imported posts cleared.'; };
$('outExport').onclick = () => STATS.log.length ? download(new Blob([toCSV(STATS.log)], { type: 'text/csv' }), 'adal_outcomes.csv') : toast('No outcomes yet');
$('outFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; const { n, miss } = importOutcomes(await f.text()); renderAll(); $('outNote').textContent = `Imported ${n} outcome${n === 1 ? '' : 's'}${miss ? `, skipped ${miss} with an unknown outcome value` : ''}.`; };
$('csvFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const text = await f.text(), rows = loadCSV(text, 'upload');
    LEADS = rows; store.set('upload', text);
    $('csvNote').textContent = `Loaded ${rows.length} contacts from ${f.name}. Contacts whose company or repo appears in the daily feed inherit its latest release.`;
    const gh = rows.filter(r => r.github && !LIVE.some(x => x.github === r.github));
    if (gh.length) { const { out } = await refreshGitHub(gh.map(r => r.github)); LIVE = [...LIVE, ...out]; }
    TODAY = []; renderAll(); toast('List loaded');
  } catch (err) { $('csvNote').textContent = 'Could not parse CSV: ' + err.message; }
};
$('tplBtn').onclick = () => download(new Blob([window.SAMPLE_CSV], { type: 'text/csv' }), 'adal_leads_template.csv');
$('sampleBtn').onclick = () => { LEADS = loadCSV(window.SAMPLE_CSV, 'sample'); store.set('upload', null); TODAY = []; renderAll(); toast('Sample data loaded'); };
$('fetchBtn').onclick = async () => {
  CFG.watch_repos = $('repos').value.split('\n').map(s => s.trim()).filter(s => /^[\w.-]+\/[\w.-]+$/.test(s)); save();
  $('fetchNote').textContent = 'Fetching…';
  const { out, errs } = await refreshGitHub(CFG.watch_repos);
  LIVE = [...LIVE.filter(l => l.source !== 'github'), ...out]; renderAll();
  $('fetchNote').textContent = `${out.length} repos refreshed${errs.length ? ` · ${errs.length} failed (${errs[0]})` : ''}`;
};
$('cfgSave').onclick = () => {
  try { CFG = mergeDeep(structuredClone(DEFAULT_CONFIG), { ...JSON.parse($('cfg').value), watch_repos: CFG.watch_repos }); save(); renderAll(); $('cfgNote').textContent = 'Applied.'; }
  catch (e) { $('cfgNote').textContent = 'Invalid JSON: ' + e.message; }
};
$('cfgReset').onclick = () => { CFG = structuredClone(DEFAULT_CONFIG); save(); renderSetup(); renderAll(); $('cfgNote').textContent = 'Defaults restored.'; };
$('learnReset').onclick = () => { STATS = freshStats(); PITCH = {}; CLOCK = 0; save(); renderAll(); toast('Learning, pitches and clock reset'); };

// ---------- boot ----------
(function boot() {
  const up = store.get('upload', null);
  LEADS = loadCSV(up || window.SAMPLE_CSV, up ? 'upload' : 'sample');
  applyFeeds(window.FEEDS);
  TODAY = store.get('today', []);
  renderAll();
  let t = 'run'; try { t = localStorage.getItem('adal_tab') || 'run'; } catch { }
  switchTab(t);
  if (/autosim/.test(location.hash)) for (let i = 0; i < 3; i++) simulateWeek(); // pre-warm learning for a demo
  if (/autorun/.test(location.hash)) runCycle(); // e.g. index.html#autorun for kiosk demos
  else loadRemoteFeeds().then(ok => ok && renderAll());
})();
