#!/usr/bin/env node
/* Daily Find: pulls launch signals from GitHub, Product Hunt and X into data/feeds.json + data/feeds.js.
 * No dependencies (Node 18+). Runs locally or from .github/workflows/daily-find.yml.
 *
 *   GITHUB_TOKEN     optional; raises the GitHub rate limit from 60 to 5,000/hr
 *   PH_TOKEN         optional; Product Hunt API v2 developer token: adds website, makers, topics, video detection.
 *                    Without it, the public Product Hunt Atom feed is used.
 *   X_BEARER_TOKEN   optional; X API v2 recent search (paid tier). Without it, data/x_posts.json (manual export) is used.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePost, changelogLatest, bullets, clean } = createRequire(import.meta.url)(join(ROOT, 'lib/parse_post.js'));
const CFG = JSON.parse(readFileSync(join(ROOT, 'config/sources.json'), 'utf8'));
const DAY = 864e5, now = Date.now();
const log = (...a) => console.error('[find]', ...a);

async function get(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': 'adal-launch-radar', ...headers } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
}

// ---------- GitHub: releases, with CHANGELOG.md as the fallback ----------
async function github() {
  const H = { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const out = [];
  for (const full of CFG.github_repos) {
    try {
      const [owner, repo] = full.split('/');
      const rels = (await get(`https://api.github.com/repos/${full}/releases?per_page=30`, H)).filter(r => !r.draft);
      let lead = { company: repo, github: full, website: 'github.com/' + full };
      if (rels.length) {
        const l = rels[0], body = l.body || '';
        lead = { ...lead, release_version: l.tag_name, release_date: l.published_at, release_url: l.html_url,
          releases_90d: rels.filter(r => now - Date.parse(r.published_at) <= 90 * DAY).length, releases_capped: rels.length === 30,
          launch_video: /youtube\.com|youtu\.be|loom\.com|vimeo\.com|\.mp4|\.mov|<video|\.gif/i.test(body) ? 'produced' : 'none',
          changelog: bullets(body.replace(/\bby @\S+.*$/gim, ''), 4).length ? bullets(body.replace(/ by @\S+.*$/gim, ''), 4) : [clean(l.name || l.tag_name)] };
      } else {
        // no GitHub releases: read the latest CHANGELOG.md section instead
        const md = await get(`https://raw.githubusercontent.com/${full}/HEAD/CHANGELOG.md`).catch(() => '');
        const c = changelogLatest(md);
        if (c) lead = { ...lead, release_version: c.version, release_date: c.date, changelog: c.bullets, launch_video: 'unknown', release_url: `https://github.com/${full}/blob/HEAD/CHANGELOG.md`, releases_90d: 0, signal: 'changelog' };
      }
      // contact paths from the owner's public profile
      const p = await get(`https://api.github.com/users/${owner}`, H).catch(() => ({}));
      Object.assign(lead, { name: '', email: p.email || '', twitter: p.twitter_username || '', contact_url: p.blog || p.html_url || '', team_size: null, company: p.name || repo });
      out.push({ ...lead, source: 'github', list_name: lead.signal === 'changelog' ? 'CHANGELOG.md (live)' : 'GitHub releases (live)' });
    } catch (e) { log('github', full, e.message); }
  }
  return out;
}

// ---------- Product Hunt ----------
async function productHunt() {
  if (process.env.PH_TOKEN) {
    const q = `{ posts(first: 40, order: NEWEST) { edges { node { name tagline description url website createdAt votesCount
      topics { edges { node { name } } } media { type url videoUrl } makers { name username twitterUsername } } } } }`;
    const r = await fetch('https://api.producthunt.com/v2/api/graphql', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.PH_TOKEN}` }, body: JSON.stringify({ query: q }) });
    const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
    return j.data.posts.edges.map(({ node: n }) => {
      const topics = n.topics.edges.map(e => e.node.name);
      const maker = n.makers[0] || {};
      const p = parsePost(`${n.tagline}\n${n.description || ''}`, { website: n.website, company: n.name, date: n.createdAt, hasVideo: n.media.some(m => m.type === 'video' || m.videoUrl) });
      return { ...p, name: maker.name || '', twitter: maker.twitterUsername || '', contact_url: n.url, release_url: n.url, source: 'producthunt',
        list_name: 'Product Hunt launch (live)', topics, votes: n.votesCount, saas: topics.some(t => CFG.ph_saas_topics.includes(t)), video_verified: true };
    });
  }
  // public Atom feed: no key, no video or topic data
  const xml = await get('https://www.producthunt.com/feed', { 'User-Agent': 'Mozilla/5.0' });
  const ents = xml.split('<entry>').slice(1);
  const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return ents.map(e => {
    const tag = n => (e.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)) || [])[1] || '';
    const tagline = clean(dec(tag('content')).replace(/<[^>]+>/g, '\n').split('\n').map(s => s.trim()).filter(Boolean)[0] || '');
    const link = (e.match(/<link[^>]+href="([^"]+)"/) || [])[1] || '';
    return { company: dec(tag('title')), name: clean(tag('name')), website: '', github: '', release_version: 'launch', release_date: tag('published'),
      launch_video: 'unknown', video_verified: false, changelog: tagline ? [tagline] : [], release_url: link, contact_url: link,
      source: 'producthunt', list_name: 'Product Hunt launch (live)', saas: null };
  }).filter(x => now - Date.parse(x.release_date) <= CFG.max_age_days * DAY);
}

// ---------- X launch posts ----------
async function xPosts() {
  if (process.env.X_BEARER_TOKEN) {
    const u = new URL('https://api.x.com/2/tweets/search/recent');
    u.search = new URLSearchParams({ query: CFG.x_query, max_results: '50', 'tweet.fields': 'created_at,attachments,entities,author_id',
      expansions: 'author_id,attachments.media_keys', 'user.fields': 'name,username,url,entities,public_metrics', 'media.fields': 'type' });
    const j = await get(u, { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` });
    const users = Object.fromEntries((j.includes?.users || []).map(x => [x.id, x]));
    const media = Object.fromEntries((j.includes?.media || []).map(m => [m.media_key, m]));
    return (j.data || []).map(t => {
      const a = users[t.author_id] || {}, keys = t.attachments?.media_keys || [];
      const site = a.entities?.url?.urls?.[0]?.expanded_url || (t.entities?.urls || []).map(x => x.expanded_url).find(x => !/x\.com|twitter\.com/.test(x)) || '';
      const p = parsePost(t.text, { url: `https://x.com/${a.username}/status/${t.id}`, handle: a.username, author: a.name, website: site, date: t.created_at,
        hasVideo: keys.some(k => ['video', 'animated_gif'].includes(media[k]?.type)) });
      return { ...p, name: a.name || '', twitter: a.username || '', contact_url: p.post_url, release_url: p.post_url, source: 'x_post', list_name: 'X launch post (live)', video_verified: true, followers: a.public_metrics?.followers_count };
    }).filter(x => x.is_launch);
  }
  const f = join(ROOT, 'data/x_posts.json');
  if (!existsSync(f)) return [];
  return JSON.parse(readFileSync(f, 'utf8')).map(p => ({ ...parsePost(p.text, p), name: p.author || '', twitter: p.handle || '', contact_url: p.url, release_url: p.url,
    source: 'x_post', list_name: 'X launch post (import)', video_verified: p.hasVideo != null }));
}

// ---------- run ----------
const results = {}, errors = [];
for (const [k, fn] of Object.entries({ github, producthunt: productHunt, x: xPosts })) {
  try { results[k] = await fn(); log(k, results[k].length); } catch (e) { results[k] = []; errors.push(`${k}: ${e.message}`); log(k, 'FAILED', e.message); }
}
const feeds = {
  generated_at: new Date().toISOString(),
  modes: { github: process.env.GITHUB_TOKEN ? 'api (token)' : 'api (anonymous)', producthunt: process.env.PH_TOKEN ? 'api' : 'atom feed', x: process.env.X_BEARER_TOKEN ? 'api' : 'manual import' },
  counts: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length])), errors,
  leads: [...results.github, ...results.producthunt, ...results.x]
};
writeFileSync(join(ROOT, 'data/feeds.json'), JSON.stringify(feeds, null, 1));
writeFileSync(join(ROOT, 'data/feeds.js'), '// generated by scripts/find.mjs — do not edit\nwindow.FEEDS = ' + JSON.stringify(feeds) + ';\n');
log('wrote', feeds.leads.length, 'leads', errors.length ? `(${errors.length} source errors)` : '');
