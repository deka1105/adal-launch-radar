/* Deterministic launch-post parser, shared by the browser (paste importer) and scripts/find.mjs.
 * SWAP POINT: production replaces this with LLM extraction. The output shape stays the same. */
(function (root) {
  'use strict';
  const LAUNCH_RE = /\b(just (shipped|launched|released)|now (live|available)|is (live|out)|launching today|we('|’)re live|introducing|announcing|changelog|release notes|v\d+\.\d+|new release|shipped)\b/i;
  const VERSION_RE = /\bv?(\d+\.\d+(?:\.\d+)?)\b/;
  const VIDEO_RE = /(youtube\.com|youtu\.be|loom\.com|vimeo\.com|\.mp4|\.mov|\/video\/|📹|🎥|▶️|watch the (demo|video))/i;
  const JUNK_RE = /full changelog|what'?s changed|new contributors|dependabot|renovate|^bump |^merge |^release v?\d|first contribution|^update dependencies/i;
  const BULLET_RE = /^\s*(?:[-*•✅✨🚀🔥⚡️👉➡️→]|\d+[.)])\s*(.+)$/u;

  function clean(s) {
    return String(s || '').replace(/https?:\/\/\S+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
  }
  function bullets(text, max) {
    const out = [];
    for (const line of String(text || '').split(/\n/)) {
      const m = line.match(BULLET_RE);
      if (m) {
        let c = clean(m[1].replace(/\s+by @\S+.*$/i, '').replace(/\(#\d+\)/g, '').replace(/\bin\s*$/, ''));
        if (JUNK_RE.test(c)) continue;
        const cc = c.match(/^(feat|fix|perf|refactor|docs|chore|ci|build|style|test)(\([^)]*\))?!?:\s*(.+)$/i);
        if (cc) { if (/^(chore|ci|build|style|test|docs)$/i.test(cc[1])) continue; c = cc[3]; }
        c = c.replace(/^\w/, x => x.toUpperCase());
        if (c.length > 6 && !out.includes(c)) out.push(c.length > 72 ? c.slice(0, 70) + '…' : c);
      }
      if (out.length >= (max || 4)) break;
    }
    return out;
  }
  function domainOf(url) { try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function companyFromDomain(d) { const p = (d || '').split('.'); return p.length > 1 ? p[p.length - 2].replace(/^\w/, c => c.toUpperCase()) : ''; }

  /** text: post body. meta: {url, author, handle, website, date, hasVideo} */
  function parsePost(text, meta) {
    meta = meta || {};
    const t = String(text || '');
    const links = (t.match(/https?:\/\/[^\s)]+/g) || []).filter(u => !/(x\.com|twitter\.com|t\.co|linkedin\.com|lnkd\.in)/.test(u));
    const gh = (t.match(/github\.com\/([\w.-]+\/[\w.-]+)/) || [])[1] || '';
    const website = meta.website || links.find(u => !/github\.com/.test(u)) || '';
    const vm = t.match(VERSION_RE);
    const firstLine = clean(t.split('\n').find(l => clean(l).length > 3) || '');
    const company = meta.company || companyFromDomain(domainOf(website)) || (gh ? gh.split('/')[1] : '') || meta.author || '(unknown)';
    let changelog = bullets(t, 4);
    if (!changelog.length && firstLine) changelog = [firstLine.length > 72 ? firstLine.slice(0, 70) + '…' : firstLine];
    return {
      is_launch: LAUNCH_RE.test(t),
      company,
      website: website ? domainOf(website) : '',
      github: gh.replace(/\.git$/, ''),
      release_version: vm ? (vm[0].startsWith('v') ? vm[0] : 'v' + vm[1]) : '',
      launch_video: meta.hasVideo === true || VIDEO_RE.test(t) ? 'produced' : meta.hasVideo === false ? 'none' : 'unknown',
      changelog,
      handle: meta.handle || ((t.match(/(^|\s)@(\w{2,15})/) || [])[2] || ''),
      author: meta.author || '',
      post_url: meta.url || '',
      release_date: meta.date || ''
    };
  }
  /** Splits pasted text into posts: blocks separated by a blank line or "---". A URL line inside a block is taken as the post URL. */
  function splitPasted(raw) {
    return String(raw || '').split(/\n\s*(?:---+)?\s*\n/).map(b => b.trim()).filter(Boolean).map(b => {
      const url = (b.match(/https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|linkedin\.com)\/\S+/) || [])[0] || '';
      const handle = (url.match(/(?:x|twitter)\.com\/(\w+)/) || [])[1] || '';
      const channel = /linkedin\.com/.test(url) ? 'linkedin' : 'x';
      return { text: b.replace(url, '').trim(), url, handle, channel };
    });
  }
  function changelogLatest(md) {
    // Latest section of a CHANGELOG.md: first "## " heading and the bullets under it.
    const lines = String(md || '').split('\n'); let start = -1;
    for (let i = 0; i < lines.length; i++) if (/^##\s+/.test(lines[i]) && !/unreleased/i.test(lines[i])) { start = i; break; }
    if (start < 0) return null;
    let end = lines.length; for (let i = start + 1; i < lines.length; i++) if (/^##\s+/.test(lines[i])) { end = i; break; }
    const head = lines[start];
    const date = (head.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
    const ver = (head.match(/v?\d+\.\d+(\.\d+)?/) || [])[0] || '';
    return { version: ver ? (ver.startsWith('v') ? ver : 'v' + ver) : clean(head.replace(/^##\s+/, '')), date, bullets: bullets(lines.slice(start + 1, end).join('\n'), 4) };
  }
  const api = { parsePost, splitPasted, changelogLatest, bullets, clean, domainOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ParsePost = api;
})(typeof window !== 'undefined' ? window : globalThis);
