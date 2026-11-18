/* Guided mode: explains each stage (what / why / how it helps AdaL), quotes the challenge brief it answers,
 * and scores expected vs actual output quality from the live app state. Depends on globals from app.js. */
'use strict';

const BRIEF_QUOTES = {
  run: 'Transform fragmented public business signals into a repeatable lead discovery, qualification, and outreach workflow.',
  find: 'Exploration 01: explore how fragmented public or sample business data could be assessed against AdaL’s ideal customer profile.',
  qualify: 'Context: the internal bots surface prospects, but there’s no complete process for evaluating which businesses match the ICP, show a meaningful need for video support, and are likely to become paying customers.',
  show: 'Exploration 02: communicate AdaL’s value in ways that reflect each prospect’s business situation.',
  sell: 'Exploration 02: select a message angle and plan follow-ups while maintaining human oversight and responsible outreach practices.',
  learn: 'Exploration 03: compare outreach strategies, interpret test results, and use engagement outcomes to improve future qualification and messaging decisions.',
  done: 'Value lens: what business decision does this improve, how could value be measured, and could the approach extend to other teams or customers?'
};

const STAGES = [
  { key: 'run', tab: 'run', target: '#steps', title: 'One click runs the whole loop',
    what: 'The cycle just ran all five stages: it found contacts, scored them, made a video for the best one, drafted pitches and opened the learning log.',
    why: 'AdaL’s problem isn’t a lack of names. It’s having no repeatable way to decide <i>who</i>, <i>why</i> and <i>why now</i>. One button with the same steps every day makes the process repeatable.',
    help: 'A founder gets a 2-minute morning routine in place of an afternoon of scrolling LinkedIn.' },
  { key: 'find', tab: 'find', target: '#sourceCards', title: 'Find: warm lists first, then release signals',
    what: 'Contacts come from AdaL’s own community lists (ambassadors, London Dec 3, coffee pop-ups, Vapi hackathon) and from a <b>live GitHub releases feed</b>. Each release counts as a buying signal.',
    why: 'AdaL’s leads come from community, not cold outbound. People who already know AdaL convert far better, so they’re scored first, and cold leads only fill the slots that are left.',
    help: 'Pipeline starts from relationships AdaL has already paid for (events, ambassadors), so nothing has to be bought or mass-scraped.' },
  { key: 'qualify', tab: 'qualify', target: '#qualTable', title: 'Qualify: rank by expected revenue',
    what: 'Every contact gets <b>P(upgrade) × plan price = expected MRR</b>. P(upgrade) combines the source’s learned conversion rate, how recently they shipped, and how weak their launch video is. Release cadence decides Pro, Max or Contact Sales.',
    why: 'AdaL makes launch videos from a codebase and its CHANGELOG, so the moment to sell is right after a release that went out without a good video. Funding counts only as a tiebreaker.',
    help: 'The sales goal is a <b>free → paid upgrade</b>, not a download, so the ranking is in dollars and each row shows the reasons behind it.' },
  { key: 'show', tab: 'show', target: '#vid', title: 'Show: their launch video, made from their own CHANGELOG',
    what: 'The #1 prospect’s latest release notes become a short launch video, with a title card, one scene per new feature, and a call to action. You can download it as .webm.',
    why: 'The best demo of AdaL is AdaL doing the work for the prospect. It’s proof, not a claim.',
    help: 'The prospect gets something they can post the same day. Here it’s a canvas template; in production this step calls AdaL’s own video agent (marked SWAP POINT in the code).' },
  { key: 'sell', tab: 'sell', target: '#pitches .card', title: 'Sell: a pitch per prospect, with a human approving each one',
    what: 'Each prospect gets a draft chosen from three playbooks: <b>warm follow-up</b>, <b>free → paid nudge</b> or <b>Contact Sales</b>. It names the relationship, the release and the video, and offers the plan that fits their tier.',
    why: 'The brief asks for relevance and responsible outreach. Five drafts a day, each approved by a person, is the opposite of mass outreach.',
    help: 'Writing goes from about 15 minutes to about 1 minute per message. Logging an outcome here feeds the Learn tab.' },
  { key: 'learn', tab: 'learn', target: '#bySource', targetUp: true, title: 'Learn: each cycle improves the next ranking',
    what: 'Outcomes (reply, tried free, paid, sales call) update the conversion rate for each source and for each release age. The next ranking uses the updated rates. Thompson sampling keeps some outreach going to sources it isn’t sure about yet.',
    why: 'AdaL is spending on several community channels and can’t yet tell which ones turn into revenue.',
    help: 'It answers a budget question: <i>which channel should get the next event, the next ambassador or the next hour?</i>' },
  { key: 'done', tab: 'run', target: '#top5', title: 'The outcome for AdaL', summary: true }
];

// ---------- quality checks: expected vs actual ----------
const Q = (label, expected, actual, status, note) => ({ label, expected, actual, status, note });
const ratio = (n, d, metAt, partialAt) => n / Math.max(1, d) >= metAt ? 'met' : n / Math.max(1, d) >= partialAt ? 'partial' : 'miss';
function todayLeads() { const r = ranked(); return TODAY.map(id => r.find(x => x.id === id)).filter(Boolean); }
function pitchText(l) { return PITCH[l.id]?.text ?? draftPitch(l); }

function qualityFor(key) {
  const top = todayLeads(), n = top.length || 0, all = allLeads(), r = ranked();
  if (!n && key !== 'learn') return [Q('Cycle has run', 'Yes', 'Not yet', 'miss', 'Press ▶ Run today’s cycle')];
  switch (key) {
    case 'run': case 'find': {
      const warm = top.filter(l => SOURCES[l.source].warm).length;
      const withRel = all.filter(l => l.release_days_ago != null).length;
      return [
        Q('Today’s 5 drawn from warm lists', '≥ 3 of 5', `${warm} of ${n}`, warm >= 3 ? 'met' : warm >= 1 ? 'partial' : 'miss'),
        Q('Live public signal feed connected', '≥ 1 real source', LIVE.length ? `${LIVE.length} GitHub repos` : 'offline, sample only', LIVE.length ? 'met' : 'partial'),
        Q('Contacts with a release signal', '≥ 50%', pct(withRel / Math.max(1, all.length)), ratio(withRel, all.length, 0.5, 0.25)),
        Q('Data collection is targeted, not bulk', '< 100 contacts/day', `${all.length} scanned`, all.length < 100 ? 'met' : 'partial')
      ];
    }
    case 'qualify': {
      const w = CFG.freshness_window_days;
      const fresh = top.filter(l => l.release_days_ago != null && l.release_days_ago <= w).length;
      const gap = top.filter(l => l.launch_video !== 'produced').length;
      const feas = top.filter(l => l.feasible).length;
      const explained = top.filter(l => l.why.length >= 3).length;
      const qr = r.filter(l => l.qualified).length / Math.max(1, r.length);
      return [
        Q(`Shipped within ${w} days`, '5 of 5', `${fresh} of ${n}`, ratio(fresh, 5, 1, 0.6)),
        Q('Has a launch-video gap', '5 of 5', `${gap} of ${n}`, ratio(gap, 5, 1, 0.6)),
        Q('AdaL can build their video (repo/CHANGELOG)', '5 of 5', `${feas} of ${n}`, ratio(feas, 5, 1, 0.8)),
        Q('Every score explained', '5 of 5', `${explained} of ${n}`, ratio(explained, 5, 1, 0.6)),
        Q('Selective, not a bigger list', '15–50% qualify', pct(qr), qr >= 0.15 && qr <= 0.5 ? 'met' : 'partial')
      ];
    }
    case 'show': {
      const l = selectedLead() || top[0]; if (!l) return [];
      const scenes = Math.min(4, l.changelog.length), len = videoLength(l);
      return [
        Q('Built from the prospect’s real release', 'Real CHANGELOG', l.origin === 'live' ? 'Live GitHub release' : 'Sample CHANGELOG', l.origin === 'live' ? 'met' : 'partial', l.origin === 'live' ? '' : 'Upload a list with a github column to use real notes'),
        Q('Feature scenes', '3–4', String(scenes), scenes >= 3 ? 'met' : scenes >= 1 ? 'partial' : 'miss'),
        Q('Length fits X / LinkedIn', '10–30 s', `${len.toFixed(0)} s`, len >= 10 && len <= 30 ? 'met' : 'partial'),
        Q('Production polish (voice, product footage, brand)', 'AdaL agent output', 'Template render', 'partial', 'SWAP POINT: call AdaL’s video agent')
      ];
    }
    case 'sell': {
      const t = top.map(l => [l, pitchText(l)]);
      const hasRel = t.filter(([l, s]) => !l.release_version || s.includes(l.release_version)).length;
      const warmL = t.filter(([l]) => SOURCES[l.source].warm), warmRef = warmL.filter(([l, s]) => s.includes(l.list_name)).length;
      const vid = t.filter(([, s]) => /launch video/i.test(s)).length;
      const offer = t.filter(([l, s]) => l.tier === 'sales' ? /call/i.test(s) : /\$\d/.test(s)).length;
      const reviewed = top.filter(l => ['approved', 'skipped'].includes(PITCH[l.id]?.status)).length;
      const contact = top.filter(l => l.email).length;
      return [
        Q('Names the specific release', '5 of 5', `${hasRel} of ${n}`, ratio(hasRel, 5, 1, 0.6)),
        Q('Warm pitches reference the relationship', 'All warm', `${warmRef} of ${warmL.length}`, ratio(warmRef, warmL.length, 1, 0.5)),
        Q('Video attached', '5 of 5', `${vid} of ${n}`, ratio(vid, 5, 1, 0.6)),
        Q('Offer matches tier (plan vs sales call)', '5 of 5', `${offer} of ${n}`, ratio(offer, 5, 1, 0.6)),
        Q('Reachable contact on file', '5 of 5', `${contact} of ${n}`, ratio(contact, 5, 1, 0.6), contact < n ? 'Cold release-feed leads still need a contact found' : ''),
        Q('Human reviewed before send', '100%', `${reviewed} of ${n}`, ratio(reviewed, 5, 1, 0.01) === 'miss' ? 'partial' : ratio(reviewed, 5, 1, 0.01), reviewed < n ? 'Waiting on you: approve or skip below' : '')
      ];
    }
    case 'learn': {
      const s = STATS, f = s.funnel, enough = Object.keys(SOURCES).filter(k => s.bySource[k].contacted >= 5).length;
      const recos = f.contacted >= 20 ? recommendations().filter(x => !/Not enough|close to the starting/.test(x)).length : 0;
      const conv = f.contacted ? f.paid / f.contacted : 0;
      return [
        Q('Outcomes before changing weights', '≥ 20', String(f.contacted), f.contacted >= 20 ? 'met' : f.contacted ? 'partial' : 'miss', f.contacted ? '' : 'Press “Simulate 1 week”'),
        Q('Sources with enough data (≥ 5 each)', '5 of 5', `${enough} of 5`, ratio(enough, 5, 1, 0.4)),
        Q('Actionable recommendations', '≥ 1', String(recos), recos ? 'met' : 'miss'),
        Q('Free → paid conversion of contacted', '≥ 10% (assumption)', f.contacted ? pct(conv) : '—', !f.contacted ? 'miss' : conv >= 0.1 ? 'met' : 'partial'),
        Q('Outcomes are real, not simulated', '> 0 real', `${s.real} real · ${s.simulated} sim`, s.real ? 'met' : 'partial', 'Log outcomes in Sell, or connect CRM webhooks')
      ];
    }
  }
  return [];
}
function qTable(rows) {
  if (!rows.length) return '';
  const sym = { met: '✓ met', partial: '◐ partial', miss: '✕ not yet' };
  return `<table class="qtable"><tr><th>Quality check</th><th>Expected</th><th>Actual</th><th></th></tr>` +
    rows.map(q => `<tr><td>${q.label}${q.note ? `<div class="note">${q.note}</div>` : ''}</td><td>${q.expected}</td><td><b>${q.actual}</b></td><td class="qs ${q.status}">${sym[q.status]}</td></tr>`).join('') + '</table>';
}

// ---------- coach ----------
let tourIdx = -1, tourOnly = false;
const coach = () => document.getElementById('coach'), spot = () => document.getElementById('spot');
function placeSpot() {
  const st = STAGES[tourIdx]; if (!st) return;
  let el = document.querySelector(st.target); if (!el) { spot().classList.remove('on'); return; }
  if (st.targetUp) el = el.closest('.card') || el;
  if (el.tagName === 'TABLE') el = el.closest('.card') || el;
  const r = el.getBoundingClientRect(), pad = 6, vh = innerHeight;
  const top = Math.max(4, r.top - pad), bottom = Math.min(vh - 4, r.bottom + pad);
  Object.assign(spot().style, { left: (r.left - pad) + 'px', top: top + 'px', width: (r.width + pad * 2) + 'px', height: Math.max(0, bottom - top) + 'px' });
  spot().classList.add('on');
}
function showStage(i) {
  tourIdx = i; const st = STAGES[i]; if (!st) return endTour();
  switchTab(st.tab);
  if (st.key === 'show') { const l = selectedLead(); l && play(l); }
  const el = document.querySelector(st.target);
  el && el.scrollIntoView({ block: 'center', behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
  document.getElementById('coachStep').textContent = tourOnly ? 'Explain' : `Step ${i + 1} of ${STAGES.length}`;
  document.getElementById('coachTitle').textContent = st.title;
  document.getElementById('coachBody').innerHTML = st.summary ? summaryHTML() : `
    <p class="brief"><b>From the brief:</b> “${BRIEF_QUOTES[st.key]}”</p>
    <div class="blk"><b class="k">What’s happening</b>${st.what}</div>
    <div class="blk"><b class="k">Why</b>${st.why}</div>
    <div class="blk"><b class="k">How it helps AdaL</b>${st.help}</div>
    <div class="blk"><b class="k">Output quality: expected vs actual</b>${qTable(qualityFor(st.key))}</div>
    ${st.key === 'learn' && STATS.funnel.contacted < 20 ? '<button class="btn sm primary" id="coachSim">Simulate 1 week now</button>' : ''}`;
  document.getElementById('coachPrev').style.visibility = i > 0 && !tourOnly ? 'visible' : 'hidden';
  document.getElementById('coachNext').textContent = tourOnly ? 'Got it' : i === STAGES.length - 1 ? 'Finish' : 'Next →';
  coach().classList.add('on'); coach().scrollTop = 0;
  requestAnimationFrame(() => requestAnimationFrame(placeSpot));
}
function summaryHTML() {
  const top = todayLeads(), q = ranked().filter(l => l.qualified);
  const pipe = q.reduce((a, l) => a + l.emrr, 0), today = top.reduce((a, l) => a + l.emrr, 0);
  const saved = (CFG.research_minutes_manual - CFG.research_minutes_tool) * allLeads().length / 60;
  const checks = ['find', 'qualify', 'show', 'sell', 'learn'].flatMap(k => qualityFor(k).map(x => ({ ...x, k })));
  const met = checks.filter(c => c.status === 'met').length, part = checks.filter(c => c.status === 'partial').length;
  const gaps = checks.filter(c => c.status !== 'met');
  return `<p class="brief"><b>Value lens:</b> “${BRIEF_QUOTES.done}”</p>
    <div class="blk"><b class="k">Decision it improves</b>Who to contact today, and which community channel to invest in next.</div>
    <div class="blk"><b class="k">Measured outcome (this run)</b>
      <table class="qtable"><tr><td>Today’s 5: expected MRR</td><td><b>${money(today)}/mo</b></td></tr>
      <tr><td>Qualified pipeline</td><td><b>${q.length} leads · ${money(pipe)}/mo</b></td></tr>
      <tr><td>Research time saved</td><td><b>${saved.toFixed(1)} h</b> <span class="note">(45→2 min/prospect, assumption)</span></td></tr>
      <tr><td>New MRR realised${STATS.simulated ? ' (simulated)' : ''}</td><td><b>${money(STATS.mrr)}/mo</b></td></tr></table></div>
    <div class="blk"><b class="k">Overall quality</b><span class="pill met">${met} met</span> <span class="pill partial">${part} partial</span> <span class="pill miss">${checks.length - met - part} not yet</span> of ${checks.length} checks
      ${gaps.length ? `<div class="note" style="margin-top:6px">Gaps: ${gaps.slice(0, 5).map(g => `${g.k}: ${g.label.toLowerCase()} (${g.actual})`).join(' · ')}</div>` : ''}</div>
    <div class="blk"><b class="k">Extends to</b>Any team or company: lists, ICP, weights and prices live in Setup as config, not code.</div>
    <button class="btn sm" id="coachBrief">📋 See how each brief requirement is covered</button>`;
}
function startTour(i = 0, only = false) { tourOnly = only; showStage(i); }
function endTour() { tourIdx = -1; coach().classList.remove('on'); spot().classList.remove('on'); }
addEventListener('resize', () => tourIdx >= 0 && placeSpot());
addEventListener('scroll', () => tourIdx >= 0 && placeSpot(), true);
document.getElementById('coachNext').onclick = () => tourOnly || tourIdx === STAGES.length - 1 ? endTour() : showStage(tourIdx + 1);
document.getElementById('coachPrev').onclick = () => showStage(Math.max(0, tourIdx - 1));
document.getElementById('coachClose').onclick = endTour;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { endTour(); closeModal(); }
  if (tourIdx >= 0 && e.key === 'ArrowRight' && !e.target.matches('textarea,input')) document.getElementById('coachNext').click();
  if (tourIdx >= 0 && e.key === 'ArrowLeft' && !e.target.matches('textarea,input')) document.getElementById('coachPrev').click();
});
coach().addEventListener('click', e => {
  if (e.target.id === 'coachSim') { simulateWeek(); renderAll(); showStage(tourIdx); }
  if (e.target.id === 'coachBrief') { endTour(); openBrief(); }
});

// "?" explain buttons on each tab
STAGES.filter(s => s.key !== 'done').forEach(s => {
  const h = document.querySelector(`#tab-${s.tab} h2`); if (!h || h.querySelector('.helpbtn')) return;
  const b = document.createElement('button'); b.className = 'btn sm helpbtn'; b.textContent = '? Explain';
  b.onclick = () => startTour(STAGES.indexOf(s), true); h.appendChild(b);
});

// ---------- modal: welcome + challenge fit ----------
function openModal(html) { document.getElementById('modalBody').innerHTML = html; document.getElementById('modal').hidden = false; }
function closeModal() { document.getElementById('modal').hidden = true; }
document.getElementById('modalClose').onclick = closeModal;
document.getElementById('modal').addEventListener('click', e => {
  if (e.target.id === 'modal') closeModal();
  if (e.target.id === 'welcomeGo') { closeModal(); document.getElementById('guideToggle').checked = true; runCycle(); }
  if (e.target.id === 'welcomeBrief') openBrief();
});

const FIT = [
  ['Business challenge', 'From Ideal Customer Profiles to qualified opportunities', 'The whole loop: Find → Qualify → Show → Sell → Learn, run once a day', 'Today', 'met'],
  ['Context: bots find names but can’t judge fit', 'Evaluate ICP match, video need, and likelihood to pay', 'Each lead is scored on fit (ICP config), need (launch-video gap), timing (release freshness) and likelihood to pay (tier from release cadence) to give expected MRR', 'Qualify', 'met'],
  ['Context: relevant signals', 'Stage, geography, launches, fundraising, video/social evidence', 'Stage and region in the ICP config. Launches are the <b>primary</b> signal. Funding is a tiebreaker. Video evidence is the gap score', 'Qualify · Setup', 'met'],
  ['Context: whom, how, which approach', 'Decide whom to contact, how to communicate relevance, and which approach works', 'Top 5 plus a playbook per lead (warm follow-up / upgrade nudge / sales). Outcomes rank the playbooks over time', 'Sell · Learn', 'met'],
  ['Context: no Clay/Apollo, no guaranteed data', 'Work without paid prospecting providers', 'Uses AdaL’s own event lists (CSV) and the free public GitHub releases API. Sources plug in as adapters', 'Find · Setup', 'met'],
  ['Context: no indiscriminate collection or mass outreach', 'Repeatable workflow, not volume', '5 a day, warm first, a human approves every message, and nothing sends automatically', 'Sell', 'met'],
  ['Exploration 01: ICP discovery & commercial signals', 'Help the team see why a prospect is promising rather than produce a bigger list', 'Each lead carries a one-line “why now” and its factor breakdown. Only 15–50% qualify', 'Qualify', 'met'],
  ['Exploration 02: relevant & personalised engagement', 'Message angle, follow-ups, human oversight', 'A launch video from their own CHANGELOG, a pitch that references the relationship and release, and human approval. Automated follow-up sequences are not built yet', 'Show · Sell', 'partial'],
  ['Exploration 03: experimentation & learning loop', 'Compare strategies, interpret tests, improve decisions', 'Beta-Bernoulli rates by source and release age, Thompson sampling, and one-click recommendations. Outcomes are simulated for now', 'Learn', 'partial'],
  ['Impact: more qualified opportunities', 'Qualification rate, positive responses, meetings, opportunities', 'Qualified %, the funnel (replied → tried free → paid → Max/sales), expected and realised MRR', 'Today · Learn', 'met'],
  ['Impact: go-to-market efficiency', 'Research time per prospect, prep time, leads per person', 'Research time saved per cycle; drafts and videos generated automatically. The 45→2 min figure is an assumption to validate', 'Today', 'partial'],
  ['Impact: better outreach decisions', 'Which signals, messages and sequences work', 'Conversion by source and by days since release, plus recommendations such as “tighten window to 7 days” and “pop-ups are community, not pipeline”', 'Learn', 'met'],
  ['Value lens', 'Decision improved, before/after, measurement, extensibility', 'Decision: who to contact today and which channel to fund. Measured in expected → realised MRR. Extensible because ICP, weights and prices are config', 'Guide summary', 'met'],
  ['Deliverable', 'Working prototype plus a concise explanation of problem, value, feasibility, assumptions and broader use', 'This app, guided mode, and the README (assumptions and SWAP POINTS listed)', 'README', 'met'],
  ['IMPORTANT: built with Converge.AI products', 'Only solutions built using Converge.AI products are accepted', '<b>Not mapped yet.</b> Covey, Enter, Framia and the 4th product need to be assigned to stages', '—', 'miss']
];
function openBrief() {
  const c = s => ({ met: '<span class="pill met">covered</span>', partial: '<span class="pill partial">partial</span>', miss: '<span class="pill miss">gap</span>' }[s]);
  const counts = ['met', 'partial', 'miss'].map(s => FIT.filter(f => f[4] === s).length);
  openModal(`<h2>How Launch Radar answers the challenge brief</h2>
    <p class="lead">Converge.AI × AdaL: “From Ideal Customer Profiles to Qualified Opportunities.” ${counts[0]} covered · ${counts[1]} partial · ${counts[2]} gap.</p>
    <div class="tablewrap"><table class="fit"><tr><th>Brief section</th><th>What it asks</th><th>How Launch Radar answers</th><th>Where</th><th></th></tr>
    ${FIT.map(f => `<tr><td>${f[0]}</td><td class="note">${f[1]}</td><td>${f[2]}</td><td class="note">${f[3]}</td><td>${c(f[4])}</td></tr>`).join('')}</table></div>`);
}
function openWelcome() {
  openModal(`<h2>AdaL Launch Radar</h2>
    <p class="lead">Turns AdaL’s community into qualified <b>free → paid</b> pipeline.</p>
    <div class="grid g2">
      <div><h3>The idea in one line</h3><p>Find people AdaL already knows who <b>just shipped a release</b> with a weak launch video, make that video from their CHANGELOG, and send it with a pitch.</p></div>
      <div><h3>What you’ll see</h3><p>Today’s 5 prospects with expected MRR, a generated launch video, five pitches waiting for approval, and a learning loop that improves tomorrow’s ranking.</p></div>
    </div>
    <p class="note">All people in the warm lists are fictional sample data. The cold feed is real public GitHub release data. Learning outcomes are simulated and labelled.</p>
    <div class="flex" style="margin-top:12px"><button class="btn primary big" id="welcomeGo">▶ Start guided demo</button><button class="btn" id="welcomeBrief">📋 How it maps to the challenge</button></div>`);
}
document.getElementById('briefBtn').onclick = openBrief;
(function () {
  let g = true; try { g = localStorage.getItem('adal_guide') !== '0'; } catch { }
  const t = document.getElementById('guideToggle'); t.checked = g;
  t.onchange = () => { try { localStorage.setItem('adal_guide', t.checked ? '1' : '0'); } catch { } if (!t.checked) endTour(); };
  let seen = false; try { seen = localStorage.getItem('adal_seen') === '1'; localStorage.setItem('adal_seen', '1'); } catch { }
  if (!seen && !/autorun|autosim/.test(location.hash)) openWelcome();
})();
window.onCycleDone = () => { if (document.getElementById('guideToggle').checked) startTour(0); };
