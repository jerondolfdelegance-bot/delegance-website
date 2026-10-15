/* Delegance dashboards: one app, six role spaces. */
(function () {
  'use strict';
  var main = document.getElementById('main'), dlg = document.getElementById('dlg');
  var ME = null, ROLE = null, TEAM = false, ADMIN = false, SUPER = false, EMAIL = false;
  var STAGES = [['new', 'New'], ['contacted', 'Contacted'], ['call', 'Discovery call'], ['proposal', 'Proposal'], ['won', 'Won'], ['lost', 'Lost']];
  var STAGE = Object.fromEntries(STAGES);
  var STATUS = { new: 'New', in_progress: 'In progress', done: 'Done', closed: 'Closed', open: 'To do', doing: 'Doing', active: 'Active', invited: 'Invited', disabled: 'Off', pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
  var ROLE_NAME = { super_admin: 'Super admin', admin: 'Admin', staff: 'Staff', va: 'Virtual assistant', client: 'Client', member: 'Member' };

  // ---------- helpers ----------
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  async function api(path, method, data) {
    var r = await fetch('/api/' + path, { method: method || 'GET', credentials: 'same-origin', headers: data !== undefined ? { 'Content-Type': 'application/json' } : {}, body: data !== undefined ? JSON.stringify(data) : undefined });
    if (r.status === 401) { location.replace('/login?next=' + encodeURIComponent('/dashboard' + location.hash)); throw new Error('Please sign in.'); }
    var j = await r.json().catch(function () { return {}; });
    if (r.status === 403 && j.code === 'mfa_setup') { location.reload(); throw new Error(j.error); }
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  }
  function toast(msg, err) { var t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, err ? 6000 : 3000); }
  var day = function (d) { return d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(d).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) : ''; };
  function ago(d) { if (!d) return ''; var s = (Date.now() - new Date(d)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; if (s < 604800) return Math.floor(s / 86400) + 'd ago'; return day(d); }
  var pill = function (s, label) { return '<span class="pill ' + esc(s) + '">' + esc(label || STATUS[s] || STAGE[s] || s) + '</span>'; };
  var initials = function (n) { return esc(String(n || '?').split(/\s+/).map(function (x) { return x[0]; }).slice(0, 2).join('').toUpperCase()); };
  var money = function (v) { return v ? 'US$' + Number(v).toLocaleString() : ''; };
  var hrs = function (m) { return (Math.round((m || 0) / 6) / 10).toLocaleString() + 'h'; };
  var empty = function (t) { return '<p class="empty">' + esc(t) + '</p>'; };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  function top(title, sub, actions) { return '<div class="top"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div><div class="inline tright">' + (actions || '') + '<span data-theme-toggle></span>' + (TEAM ? '<button class="ibtn" id="srchBtn" aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)">' + I.search + '</button>' : '') + '<button class="ibtn" id="bell" aria-label="Notifications" title="Notifications" data-n="0">' + I.bell + '<span class="dot" hidden></span></button><button class="menu" id="menuBtn" aria-label="Open menu">' + I.menu + '</button></div></div>'; }
  function opts(list, sel, blank) { return (blank != null ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(sel == null ? '' : sel) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function modal(html, onSubmit) {
    dlg.innerHTML = '<form method="dialog" novalidate>' + html + '<p class="err" role="alert"></p><div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn btn-acc" value="ok" id="dlgOk">Save</button></div></form>';
    var f = dlg.querySelector('form');
    f.addEventListener('submit', async function (e) {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      var b = f.querySelector('#dlgOk'), M = window.DLGMotion; if (M) M.busy(b, true); else b.disabled = true; f.querySelector('.err').textContent = '';
      try { var keep = await onSubmit(Object.fromEntries(new FormData(f)), f); if (!keep) dlg.close(); } catch (x) { f.querySelector('.err').textContent = x.message; }
      if (M) M.busy(b, false); else b.disabled = false;
    });
    dlg.showModal();
    var i = f.querySelector('input,select,textarea'); if (i) i.focus();
  }
  function showLink(title, link, note) {
    dlg.innerHTML = '<h2>' + esc(title) + '</h2><p class="lead">' + esc(note) + '</p><div class="copy"><input readonly value="' + esc(link) + '" aria-label="Link"><button class="btn btn-acc" id="cp">Copy</button></div><div class="acts"><button class="btn" id="cl">Done</button></div>';
    dlg.querySelector('#cp').onclick = function () { var i = dlg.querySelector('input'); i.select(); (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { toast('Link copied.'); }, function () { document.execCommand('copy'); toast('Link copied.'); }); };
    dlg.querySelector('#cl').onclick = function () { dlg.close(); };
    dlg.showModal();
  }
  var I = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    pipe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.4.2 4 1.8 4.5 4.5"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M8 7h7"/></svg>',
    task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
    mega: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10v4h4l7 5V5L7 10z"/><path d="M17.5 9a4 4 0 0 1 0 6"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="12" width="3" height="5" rx="1"/><rect x="12" y="8" width="3" height="9" rx="1"/><rect x="17" y="5" width="3" height="12" rx="1"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
    plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    va: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.2-7 8-7s7 2.5 8 7"/><path d="M16 4.5l1.5-1.5"/></svg>'
  };
  var SPACES = {
    super_admin: ['Command Center', 'Everything, everyone, every setting'],
    admin: ['Control Room', 'Run the team and the pipeline'],
    staff: ['Workspace', 'Your leads, tasks and requests'],
    va: ['VA Studio', 'Your clients, tasks and hours'],
    client: ['Client Suite', 'Your projects with Delegance'],
    member: ['Member Lounge', 'Guides, updates and requests']
  };
  function navFor(r) {
    var n = [['home', 'Home', 'home']];
    if (TEAM) n.push(['pipeline', 'Pipeline', 'pipe'], ['contacts', 'Contacts', 'book'], ['tasks', 'My day', 'task'], ['calendar', 'Calendar', 'cal'], ['requests', 'Requests', 'inbox'], ['reports', 'Reports', 'chart']);
    if (ADMIN) n.push(['automations', 'Automations', 'bolt']);
    if (TEAM) n.push(['chat', 'Chat', 'chat'], ['social', 'Social', 'share'], ['outreach', 'LinkedIn outreach', 'send'], ['integrations', 'Integrations', 'plug']);
    if (ADMIN) n.push(['people', 'People', 'people'], ['vas', 'VA profiles', 'va'], ['contracts', 'Agreements', 'pen'], ['hours', 'Hours', 'clock'], ['news', 'Announcements', 'mega']);
    if (TEAM) n.push(['updates', 'What\'s new', 'star'], ['roadmap', 'Roadmap', 'chart']);
    if (SUPER) n.push(['audit', 'Security log', 'shield']);
    if (r === 'va') n.push(['chat', 'Chat', 'chat'], ['clients', 'My clients', 'people'], ['tasks', 'Tasks', 'task'], ['hours', 'Timesheet', 'clock'], ['news', 'Updates', 'mega']);
    if (r === 'client') n.push(['chat', 'Team chat', 'chat'], ['requests', 'Requests', 'inbox'], ['messages', 'Messages', 'chat'], ['team', 'My team', 'star'], ['news', 'Updates', 'mega']);
    if (r === 'member' && ME && (ME.intent === 'work' || ME.intent === 'both')) n.push(['portfolio', 'My portfolio', 'va'], ['board', 'Job board', 'people']);
    if (r === 'member') n.push(['requests', 'My requests', 'inbox'], ['messages', 'Messages', 'chat'], ['guides', 'Guides', 'book'], ['news', 'Updates', 'mega']);
    n.push(['account', 'Account', 'gear']);
    return n;
  }
  function drawNav() {
    var cur = (location.hash.slice(1) || 'home').split('/')[0];
    if (cur === 'contact') cur = 'contacts';
    if (cur === 'deal') cur = 'pipeline';
    var GRP = TEAM ? { pipeline: 'Sell', chat: 'Engage', people: 'Team', updates: 'Delegance' } : {};
    if (TEAM && !ADMIN) GRP = { pipeline: 'Sell', chat: 'Engage', updates: 'Delegance' };
    document.getElementById('nav').innerHTML = navFor(ROLE).map(function (x) { return (GRP[x[0]] ? '<p class="ngrp">' + GRP[x[0]] + '</p>' : '') + '<a href="#' + x[0] + '"' + (x[0] === cur ? ' aria-current="page"' : '') + '>' + I[x[2]] + '<span>' + esc(x[1]) + '</span></a>'; }).join('');
  }

  // ---------- views ----------
  var V = {};

  V.home = async function () {
    var d = await api('dash');
    if (TEAM) return homeTeam(d);
    if (ROLE === 'va') return homeVa(d);
    return homeClient(d);
  };
  function announceCard(list) {
    return '<div class="card"><h2>Updates <a href="#news">All</a></h2>' + (list && list.length ? '<ul class="list">' + list.slice(0, 4).map(function (a) { return '<li><div class="t"><b>' + esc(a.title) + '</b><span>' + esc(ago(a.created_at)) + ' · ' + esc(a.author_name || 'Delegance') + '</span></div></li>'; }).join('') + '</ul>' : empty('No updates yet.')) + '</div>';
  }
  function homeTeam(d) {
    var c = d.counts || {}, first = esc(ME.name.split(' ')[0]);
    var hr = new Date().getHours(), part = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    var setup = d.setup || [], done = setup.filter(function (s) { return s.done; }).length, pct = setup.length ? Math.round(done / setup.length * 100) : 100;
    var waiting = [c.open_requests ? c.open_requests + ' request' + (c.open_requests === 1 ? '' : 's') + ' waiting' : '', (d.today || {}).today ? d.today.today + ' task' + (d.today.today === 1 ? '' : 's') + ' due today' : '', d.pending_vas ? d.pending_vas + ' new VA' + (d.pending_vas === 1 ? '' : 's') + ' to meet' : ''].filter(Boolean);
    var warm = '<section class="welcome"><div class="wl">' + avatar(ME, 72) + '<div><span class="eyebrow">' + esc(SPACES[ROLE][0]) + ' · ' + esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })) + '</span><h1>' + part + ', ' + first + '.</h1><p>' + (waiting.length ? 'Today: ' + esc(waiting.join(' · ')) + '.' : 'All calm right now. A good moment to plan, post or reach out to someone new.') + '</p></div></div>' +
      '<div class="qa">' + [['#pipeline', 'pipe', 'New deal', 'qDeal'], ['#social', 'share', 'New post', ''], ['#chat/team', 'chat', 'Message the team', ''], ['', 'cal', 'Copy booking link', 'qBook']].map(function (q) { return q[3] ? '<button class="qbtn" id="' + q[3] + '">' + I[q[1]] + '<span>' + q[2] + '</span></button>' : '<a class="qbtn" href="' + q[0] + '">' + I[q[1]] + '<span>' + q[2] + '</span></a>'; }).join('') + '</div></section>';
    if (setup.length && done < setup.length) warm += '<section class="card nextsteps"><div class="nsh"><div class="ring" style="--p:' + pct + '"><b>' + pct + '%</b></div><div><h2>Your next steps</h2><p class="sub">' + done + ' of ' + setup.length + ' done. Each one makes Delegance work harder for you.</p></div></div><ul class="nsl">' + setup.map(function (s) { return '<li class="' + (s.done ? 'done' : '') + '"><a href="' + esc(s.link) + '"><i aria-hidden="true">' + (s.done ? '✓' : '') + '</i><span>' + esc(s.label) + '</span></a></li>'; }).join('') + '</ul></section>';
    var FI = { chat: 'chat', lead: 'star', post: 'share', va: 'va' };
    if ((d.feed || []).length) warm += '<section class="card feedcard"><h2>Around Delegance</h2><ul class="list">' + d.feed.map(function (f) { var href = f.kind === 'chat' ? '#chat/' + f.ref : f.kind === 'lead' ? '#contact/' + f.ref : f.kind === 'post' ? '#social' : '/va/' + f.ref; var what = { chat: 'in chat', lead: 'new lead', post: 'post going out', va: 'joined the job board' }[f.kind]; return '<li><a class="row" href="' + esc(href) + '">' + (f.avatar ? avatar({ avatar: f.avatar, name: f.who }, 32) : '<span class="fico">' + I[FI[f.kind]] + '</span>') + '<div class="t"><b>' + esc(f.kind === 'post' ? 'Scheduled post' : f.who) + ' <small class="sub" style="display:inline">· ' + what + '</small></b><span>' + esc(f.text) + '</span></div><small class="sub">' + esc(f.kind === 'post' ? new Date(f.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ago(f.at)) + '</small></a></li>'; }).join('') + '</ul></section>';
    setTimeout(function () {
      var qd = document.getElementById('qDeal'); if (qd) qd.onclick = function () { location.hash = '#pipeline'; setTimeout(function () { var b = document.getElementById('addD'); if (b) b.click(); }, 700); };
      var qb = document.getElementById('qBook'); if (qb) qb.onclick = function () { var l = location.origin + '/book'; (navigator.clipboard ? navigator.clipboard.writeText(l) : Promise.reject()).then(function () { toast('Booking link copied: ' + l); }, function () { showLink('Your booking link', l, 'Share it anywhere: email signature, Instagram bio, proposals.'); }); };
    });
    var hero = SUPER
      ? '<div class="hero"><span class="eyebrow">Command Center</span><h1>Good to see you, ' + first + '.</h1><p>The whole of Delegance at a glance: people, pipeline, requests and security.</p><div class="actions"><a class="btn btn-acc" href="#people">Invite someone</a><a class="btn" href="#audit">Security log</a><a class="btn" href="https://desk.delegance.app/" target="_blank" rel="noopener">Open Desk</a></div></div>'
      : ADMIN ? '<div class="hero photo"><div class="txt"><span class="eyebrow">Control Room</span><h1>Hi ' + first + ', here is today.</h1><p>Requests waiting, VA applications to review, and where every lead stands.</p><div class="actions"><a class="btn btn-acc" href="#requests">Open requests</a><a class="btn" href="#vas">Review VAs</a></div></div><img src="/img/meeting.webp" alt=""></div>'
      : '<div class="hero"><span class="eyebrow">Workspace</span><h1>Let\'s move things forward, ' + first + '.</h1><p>Your tasks first, then fresh requests and leads.</p><div class="actions"><a class="btn btn-acc" href="#tasks">My tasks</a><a class="btn" href="#contacts">Add a contact</a></div></div>';
    var kpis = [['Contacts', c.contacts, c.new_this_week + ' new this week'], ['Open requests', c.open_requests, 'New or in progress', c.open_requests > 0], ['My open tasks', c.my_tasks, c.overdue ? c.overdue + ' overdue across the team' : 'Nothing overdue', c.overdue > 0], ['Website chats', c.chats_week, 'Last 7 days']];
    if (ADMIN) kpis[3] = ['New VA profiles', d.pending_vas, 'Live, not verified yet', d.pending_vas > 0];
    var html = warm + '<div class="grid g4" style="margin-bottom:16px">' + kpis.map(function (k) { return '<div class="card kpi' + (k[3] ? ' hot' : '') + '"><span>' + esc(k[0]) + '</span><b data-count>' + esc(k[1] || 0) + '</b><small>' + esc(k[2]) + '</small></div>'; }).join('') + '</div>';
    var pipe = DSTAGES.map(function (s) { var r = (d.pipeline || []).find(function (x) { return x.stage === s[0]; }) || { n: 0, v: 0 }; return [s[1], r.n, r.v]; });
    var fc = d.forecast || { w: 0, v: 0 }, td = d.today || {};
    html += '<div class="grid g3" style="margin-bottom:16px"><a class="card kpi gold" href="#reports" style="text-decoration:none"><span>Weighted forecast</span><b data-count>' + (money(Math.round(fc.w)) || 'US$0') + '</b><small>' + (money(fc.v) || 'US$0') + ' in open deals</small></a><a class="card kpi gold" href="#reports" style="text-decoration:none"><span>Won this month</span><b data-count>' + (money((d.won_month || {}).v) || 'US$0') + '</b><small>' + ((d.won_month || {}).n || 0) + ' deals</small></a><a class="card kpi' + (td.overdue ? ' hot' : '') + '" href="#tasks" style="text-decoration:none"><span>My day</span><b>' + (td.today || 0) + ' due today</b><small>' + (td.overdue ? td.overdue + ' overdue, start there' : 'Nothing overdue') + '</small></a></div>';
    if ((d.stale || []).length) html += '<div class="card stale" style="margin-bottom:16px"><h2>Deals going quiet <a href="#pipeline">Pipeline</a></h2><ul class="list">' + d.stale.map(function (x) { return '<li><a class="row" href="#deal/' + esc(x.id) + '"><div class="t"><b>' + esc(x.title) + '</b><span>' + esc(DSTAGE[x.stage] + ' · no activity since ' + day(x.updated_at)) + '</span></div></a>' + (x.value_usd ? '<b class="goldtxt">' + money(x.value_usd) + '</b>' : '') + '</li>'; }).join('') + '</ul></div>';
    var mx = Math.max.apply(null, pipe.map(function (p) { return p[1]; }).concat([1]));
    html += '<div class="grid g21" style="margin-bottom:16px"><div class="card"><h2>Pipeline <a href="#pipeline">Board</a></h2><ul class="list stagebars">' + pipe.map(function (p) { return '<li><span>' + esc(p[0]) + '</span><div class="bar"><i style="width:' + (p[1] / mx * 100) + '%"></i></div><b>' + p[1] + '</b></li>'; }).join('') + '</ul></div>';
    html += '<div class="card"><h2>My tasks <a href="#tasks">All</a></h2>' + (d.my_tasks.length ? '<ul class="list">' + d.my_tasks.map(function (t) { return '<li><div class="t"><b>' + esc(t.title) + '</b><span>' + esc([t.contact_name, t.due ? 'Due ' + day(t.due) : ''].filter(Boolean).join(' · ')) + '</span></div>' + pill(t.status) + '</li>'; }).join('') + '</ul>' : empty('No open tasks. Nice.')) + '</div></div>';
    html += '<div class="grid g3"><div class="card"><h2>New requests <a href="#requests">All</a></h2>' + (d.requests.length ? '<ul class="list">' + d.requests.map(function (r) { return '<li><a class="row" href="#contact/' + esc(r.contact_id) + '"><div class="t"><b>' + esc(r.title) + '</b><span>' + esc(r.contact_name) + ' · ' + esc(ago(r.created_at)) + '</span></div></a>' + pill(r.status) + '</li>'; }).join('') + '</ul>' : empty('No open requests.')) + '</div>';
    html += '<div class="card"><h2>Recently active <a href="#contacts">Contacts</a></h2>' + (d.recent.length ? '<ul class="list">' + d.recent.map(function (r) { return '<li><a class="row" href="#contact/' + esc(r.id) + '"><span class="av">' + initials(r.name) + '</span><div class="t"><b>' + esc(r.name) + '</b><span>' + esc(r.company || '') + '</span></div></a>' + pill(r.kind === 'client' ? 'won' : r.kind === 'partner' ? 'call' : 'new', { lead: 'Lead', client: 'Client', partner: 'Partner' }[r.kind] || 'Lead') + '</li>'; }).join('') + '</ul>' : empty('No contacts yet. Website requests land here automatically.')) + '</div>';
    if (SUPER) html += '<div class="card"><h2>Security <a href="#audit">Log</a></h2><div class="grid g2" style="margin-bottom:12px"><div><span class="sub" style="color:var(--dim);font-size:12px">Active sessions</span><b style="display:block;font:600 22px Montserrat">' + d.sessions + '</b></div><div><span style="color:var(--dim);font-size:12px">Failed sign-ins (7d)</span><b style="display:block;font:600 22px Montserrat;color:' + (d.failed_logins > 10 ? 'var(--bad)' : 'inherit') + '">' + d.failed_logins + '</b></div></div><ul class="list feed">' + d.audit.slice(0, 5).map(function (a) { return '<li><div class="t"><b>' + esc(a.action) + '</b><span>' + esc(a.actor) + ' · ' + esc(ago(a.created_at)) + '</span></div></li>'; }).join('') + '</ul></div>';
    else if (ADMIN) html += '<div class="card"><h2>People <a href="#people">Manage</a></h2><ul class="list">' + ['admin', 'staff', 'va', 'client', 'member'].map(function (r) { var n = (d.people || []).filter(function (p) { return p.role === r; }).reduce(function (a, p) { return a + p.n; }, 0); return '<li><div class="t"><b>' + esc(ROLE_NAME[r]) + 's</b></div><b>' + n + '</b></li>'; }).join('') + '<li><div class="t"><b>VA hours this week</b></div><b>' + hrs(d.hours_week) + '</b></li></ul></div>';
    else html += announceCard(d.announcements);
    return '<div class="hometop">' + top('Home', '') + '</div>' + html;
  }
  function homeVa(d) {
    var p = d.profile, goal = 40 * 60, pct = Math.min(100, Math.round(d.week_minutes / goal * 100));
    var mx = Math.max.apply(null, (d.days || []).map(function (x) { return x.m; }).concat([60]));
    var bars = ''; for (var i = 13; i >= 0; i--) { var k = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), r = (d.days || []).find(function (x) { return x.day === k; }); bars += '<i title="' + esc(day(k) + ': ' + hrs(r ? r.m : 0)) + '" style="height:' + Math.max(4, (r ? r.m : 0) / mx * 100) + '%"></i>'; }
    var html = '<div class="hero photo"><div class="txt"><span class="eyebrow">VA Studio</span><h1>Hi ' + esc(ME.name.split(' ')[0]) + ', ready when you are.</h1><p>Your clients, today\'s tasks and your hours in one place.</p><div class="actions"><button class="btn btn-acc" id="logBtn">Log hours</button>' + (p && p.slug && p.status === 'approved' ? '<a class="btn" href="/va/' + esc(p.slug) + '" target="_blank" rel="noopener">View my profile</a>' : '<a class="btn" href="/me">My profile</a>') + '</div></div><img src="/img/va-800.webp" alt=""></div>';
    html += '<div class="grid g3" style="margin-bottom:16px"><div class="card" style="text-align:center"><h2>This week</h2><div class="ring" style="--p:' + pct + '"><div><div><b>' + hrs(d.week_minutes) + '</b><span>of 40h</span></div></div></div></div>';
    html += '<div class="card"><h2>Last 14 days <a href="#hours">Timesheet</a></h2><div class="days" aria-label="Hours per day">' + bars + '</div><p class="sub" style="color:var(--dim);font-size:12px;margin-top:10px">Tap Log hours at the end of each day.</p></div>';
    html += '<div class="card"><h2>Profile</h2>' + (p ? '<div class="person"><span class="av">' + (p.photo_id ? '<img src="https://desk.delegance.app/public/media/' + esc(p.photo_id) + '.png" alt="">' : initials(p.name)) + '</span><div><b>' + esc(p.name) + '</b><div style="color:var(--muted);font-size:13px">' + esc(p.headline || '') + '</div><div style="margin-top:6px">' + pill(p.status) + '</div></div></div>' + (p.review_note ? '<p class="fine">Note from Delegance: ' + esc(p.review_note) + '</p>' : '') : empty('Your VA profile is not linked yet. Ask your Delegance admin to link it, or create one at delegance.app/apply.')) + '</div></div>';
    html += '<div class="grid g2"><div class="card"><h2>My tasks <a href="#tasks">All</a></h2>' + (d.my_tasks.length ? '<ul class="list">' + d.my_tasks.map(function (t) { return '<li><div class="t"><b>' + esc(t.title) + '</b><span>' + esc([t.contact_name, t.due ? 'Due ' + day(t.due) : ''].filter(Boolean).join(' · ')) + '</span></div>' + pill(t.status) + '</li>'; }).join('') + '</ul>' : empty('No open tasks.')) + '</div>';
    html += '<div class="card"><h2>My clients <a href="#clients">All</a></h2>' + (d.clients.length ? '<ul class="list">' + d.clients.map(function (c) { return '<li><span class="av">' + initials(c.company || c.name) + '</span><div class="t"><b>' + esc(c.company || c.name) + '</b><span>' + esc(c.company ? c.name : '') + '</span></div></li>'; }).join('') + '</ul>' : empty('No clients assigned yet. Delegance will add you to a client here.')) + '</div></div>';
    setTimeout(function () { var b = document.getElementById('logBtn'); if (b) b.onclick = function () { logHours(d.clients); }; });
    return top('Home', SPACES.va[1]) + html + '<div style="margin-top:16px">' + announceCard(d.announcements) + '</div>';
  }
  var INTENT = [['hire', 'Hiring'], ['work', 'Working as a VA'], ['both', 'Both']];
  function intentSwitch() { setTimeout(function () { document.querySelectorAll('[data-sw]').forEach(function (b) { b.onclick = async function () { try { await api('auth/intent', 'POST', { intent: b.dataset.sw }); await boot(); drawNav(); route.last = ''; route(); toast('Switched.'); } catch (x) { toast(x.message, true); } }; }); }); return '<div class="seg" role="group" aria-label="My space" style="max-width:480px;margin-bottom:16px">' + INTENT.map(function (x) { return '<button data-sw="' + x[0] + '" aria-pressed="' + (ME.intent === x[0]) + '" aria-selected="' + (ME.intent === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>'; }
  function homeClient(d) {
    var first = esc(ME.name.split(' ')[0]), isClient = ROLE === 'client';
    if (!isClient && !ME.intent) {
      setTimeout(function () { document.querySelectorAll('[data-intent]').forEach(function (b) { b.onclick = async function () { try { await api('auth/intent', 'POST', { intent: b.dataset.intent }); await boot(); if (b.dataset.intent === 'work') location.href = '/apply'; else route(); } catch (x) { toast(x.message, true); } }; }); });
      return top('Welcome', 'One quick question') + '<div class="card" style="margin-bottom:16px"><span class="eyebrow">Hi ' + first + '</span><h1 style="margin:8px 0 6px">What brings you to Delegance?</h1><p class="sub" style="margin-bottom:20px">Pick one and we will set up the right space for you. You can switch later in your profile.</p><div class="choose"><button data-intent="hire"><span class="eyebrow">For businesses</span><b>I want to hire a VA</b><span>Browse virtual assistants, send a request, book a call and work with your VA team.</span></button><button data-intent="work"><span class="eyebrow">For virtual assistants</span><b>I am a VA looking for work</b><span>Build your portfolio with your skills, experience and past work. It goes live on the Delegance job board and clients can message you.</span></button><button data-intent="both" style="grid-column:1/-1"><span class="eyebrow">Both</span><b>I work as a VA and also hire help</b><span>Get both spaces: your portfolio and job board, plus requests, VA browsing and calls for your own business.</span></button></div></div>';
    }
    var vaHero = '<div class="hero"><span class="eyebrow">VA space</span><h1>Hi ' + first + ', let\'s get you hired.</h1><p>Your portfolio is your storefront: a photo, your skills, experience, projects with images, certificates and your rate. It goes live on the Delegance job board as soon as you submit, and clients message you from it.</p><div class="actions"><a class="btn btn-acc" href="/apply">Build or edit my portfolio</a><a class="btn" href="/me">Messages from clients</a><a class="btn" href="/candidates">See the job board</a></div></div>' +
        '<div class="grid g3" style="margin-top:16px">' + [['1', 'Build your portfolio', 'Add a no-background photo, a clear headline, your skills and tools, past work with screenshots, and your rate.'], ['2', 'Get the Verified badge', 'Delegance checks your profile and adds a gold Verified badge, which moves you to the top of the board.'], ['3', 'Chat, sign, start', 'Clients message you on Delegance. When you agree, you both sign online, contact details unlock, and you start working.']].map(function (s) { return '<div class="card"><span class="eyebrow">Step ' + s[0] + '</span><h2 style="margin:6px 0">' + s[1] + '</h2><p class="sub">' + s[2] + '</p></div>'; }).join('') + '</div>' +
        '<p class="fine" style="margin:16px 0">Your portfolio dashboard opens at delegance.app/me on this device after you submit.</p>';
    if (!isClient && ME.intent === 'work') return top('Home', 'Your VA space') + intentSwitch() + vaHero;
    var html = isClient
      ? '<div class="hero photo"><div class="txt"><span class="eyebrow">Client Suite</span><h1>Welcome back, ' + first + '.</h1><p>' + esc(d.company && d.company.company ? d.company.company + ' with Delegance.' : 'Your work with Delegance.') + ' See progress, message the team and send new requests.</p><div class="actions"><button class="btn btn-acc" id="newReq">New request</button><a class="btn" href="#messages">Message us' + (d.unread ? ' (' + d.unread + ')' : '') + '</a></div></div><img src="/img/loft.webp" alt=""></div>'
      : '<div class="hero"><span class="eyebrow">Hiring a VA</span><h1>Hi ' + first + ', welcome in.</h1><p>Browse Delegance virtual assistants, book a free call, or tell us what you need and we will match you.</p><div class="actions"><a class="btn btn-acc" href="/candidates">Browse VAs</a><button class="btn" id="newReq">Start a request</button><a class="btn" href="/book">Book a call</a><a class="btn" href="/guides">Read the guides</a></div></div>';
    if (!isClient) html = intentSwitch() + (ME.intent === 'both' ? vaHero + '<div style="height:16px"></div>' : '') + html;
    if (isClient) {
      html += '<div class="grid g4" style="margin-bottom:16px">' + [['Open requests', d.requests.filter(function (r) { return r.status === 'new' || r.status === 'in_progress'; }).length], ['Tasks in progress', d.tasks.filter(function (t) { return t.status !== 'done'; }).length], ['Your team', d.team.length], ['Hours this month', hrs(d.hours_month)]].map(function (k) { return '<div class="card kpi"><span>' + k[0] + '</span><b data-count>' + esc(k[1]) + '</b></div>'; }).join('') + '</div>';
      html += '<div class="grid g21" style="margin-bottom:16px"><div class="card"><h2>What we are working on</h2>' + (d.tasks.length ? '<ul class="list">' + d.tasks.map(function (t) { return '<li><div class="t"><b>' + esc(t.title) + '</b><span>' + esc(t.due ? 'Due ' + day(t.due) : '') + '</span></div>' + pill(t.status) + '</li>'; }).join('') + '</ul>' : empty('Your task list appears here once work starts.')) + '</div>';
      html += '<div class="card"><h2>Your team <a href="#team">All</a></h2>' + (d.team.length ? '<ul class="list">' + d.team.map(function (t) { return '<li><span class="av">' + (t.photo ? '<img src="' + esc(t.photo) + '" alt="">' : initials(t.name)) + '</span><div class="t"><b>' + esc(t.name) + '</b><span>' + esc(t.title) + '</span></div></li>'; }).join('') + '</ul>' : empty('Your virtual assistant shows here once assigned.')) + '</div></div>';
    }
    html += '<div class="grid g2"><div class="card"><h2>Requests <a href="#requests">All</a></h2>' + (d.requests.length ? '<ul class="list">' + d.requests.map(function (r) { return '<li><div class="t"><b>' + esc(r.title) + '</b><span>Sent ' + esc(ago(r.created_at)) + '</span></div>' + pill(r.status) + '</li>'; }).join('') + '</ul>' : empty('No requests yet. Tell us what you need and we will reply.')) + '</div>' + announceCard(d.announcements) + '</div>';
    if (!isClient) html += '<div class="grid g3" style="margin-top:16px">' + [['/guides/how-to-brief-a-va', 'How to brief a VA', '/img/guide-brief.webp'], ['/guides/first-tasks-for-a-va', 'First tasks to hand over', '/img/t-admin.webp'], ['/guides/keeping-your-accounts-safe', 'Keeping your accounts safe', '/img/t-social.webp']].map(function (g) { return '<a class="card" href="' + g[0] + '" style="text-decoration:none;padding:0;overflow:hidden"><img src="' + g[2] + '" alt="" style="width:100%;height:140px;object-fit:cover;display:block"><div style="padding:16px"><b>' + esc(g[1]) + '</b></div></a>'; }).join('') + '</div>';
    setTimeout(function () { var b = document.getElementById('newReq'); if (b) b.onclick = newRequest; });
    return top('Home', SPACES[ROLE][1]) + html;
  }
  function newRequest() {
    modal('<h2>New request</h2><label class="fld"><span>What do you need?</span><input name="title" maxlength="140" required placeholder="e.g. Manage my inbox, 10 hours a week"></label><label class="fld"><span>Details (optional)</span><textarea name="details" maxlength="3000" placeholder="Deadlines, tools you use, anything that helps."></textarea></label>', async function (f) { await api('requests', 'POST', f); toast('Request sent. We will reply soon.'); route(); });
  }
  function logHours(clients) {
    modal('<h2>Log hours</h2><div class="row2"><label class="fld"><span>Day</span><input type="date" name="day" value="' + today() + '" max="' + today() + '"></label><label class="fld"><span>Hours</span><input type="number" name="hours" min="0.1" max="16" step="0.25" required></label></div><label class="fld"><span>Client</span><select name="contact_id">' + opts((clients || []).map(function (c) { return [c.id, c.company || c.name]; }), '', 'General / internal') + '</select></label><label class="fld"><span>What did you work on?</span><input name="note" maxlength="300"></label>', async function (f) { await api('timesheets', 'POST', f); toast('Hours saved.'); route(); });
  }

  // ================= CRM v2 =================
  var DSTAGES = [['new', 'New'], ['contacted', 'Contacted'], ['call', 'Discovery call'], ['proposal', 'Proposal sent'], ['negotiation', 'Negotiation'], ['won', 'Won'], ['lost', 'Lost']];
  var DSTAGE = Object.fromEntries(DSTAGES);
  var KIND_ICON = { note: '✎', call: '☎', meeting: '◷', email: '✉', system: '•' };
  var KIND_NAME = { note: 'Note', call: 'Call', meeting: 'Meeting', email: 'Email', system: 'Update' };
  var TEAMLIST = null;
  async function teamList() { if (!TEAMLIST) { try { TEAMLIST = (await api('team')).items; } catch (e) { TEAMLIST = [{ id: ME.id, name: ME.name, role: ROLE }]; } } return TEAMLIST; }
  function dealCard(d) {
    return '<a class="deal' + (d.rotting ? ' rot' : '') + '" draggable="true" data-id="' + esc(d.id) + '" href="#deal/' + esc(d.id) + '"><b>' + esc(d.title) + '</b><span>' + esc([d.contact_name, d.company && d.company !== d.contact_name ? d.company : ''].filter(Boolean).join(' · ')) + '</span><div class="dmeta">' + (d.value_usd ? '<span class="v">' + money(d.value_usd) + '</span>' : '<span class="muted">No value</span>') + (d.owner_name ? '<span class="av xs" title="' + esc(d.owner_name) + '">' + initials(d.owner_name) + '</span>' : '') + '</div>' + (d.rotting ? '<i class="flag" title="No activity for ' + d.idle_days + ' days">Idle ' + d.idle_days + 'd</i>' : d.overdue ? '<i class="flag" title="Close date passed">Past close date</i>' : '') + '</a>';
  }

  V.pipeline = async function () {
    var mine = sessionStorage.getItem('pmine') === '1', d = await api('deals' + (mine ? '?mine=1' : ''));
    var open = d.items.filter(function (x) { return x.stage !== 'won' && x.stage !== 'lost'; });
    var total = open.reduce(function (a, x) { return a + (x.value_usd || 0); }, 0), weighted = open.reduce(function (a, x) { return a + x.weighted; }, 0);
    var usd = function (v) { return 'US$' + Math.round(v || 0).toLocaleString(); };
    var html = top('Pipeline', open.length + ' open deal' + (open.length === 1 ? '' : 's') + ' · ' + usd(total) + ' total · ' + usd(weighted) + ' weighted', '<button class="btn btn-acc" id="addD">New deal</button>');
    html += '<div class="tools"><div class="seg" style="margin:0"><button data-m="0" aria-selected="' + !mine + '">All deals</button><button data-m="1" aria-selected="' + mine + '">My deals</button></div><span class="hint">Drag a card to another stage. Gold flags mean a deal has gone quiet.</span></div>';
    html += '<div class="board">' + DSTAGES.map(function (s) {
      var items = d.items.filter(function (x) { return x.stage === s[0]; }), sum = items.reduce(function (a, x) { return a + (x.value_usd || 0); }, 0);
      var show = (s[0] === 'won' || s[0] === 'lost') ? items.slice(0, 12) : items;
      return '<section class="col ' + s[0] + '" data-stage="' + s[0] + '" aria-label="' + esc(s[1]) + '"><h3><span>' + esc(s[1]) + '</span><span>' + items.length + '</span></h3><div class="colsum">' + (sum ? money(sum) : '&nbsp;') + '</div>' + show.map(dealCard).join('') + (items.length > show.length ? '<p class="hint">+' + (items.length - show.length) + ' more in Reports</p>' : '') + '</section>';
    }).join('') + '</div>';
    setTimeout(function () {
      document.getElementById('addD').onclick = function () { addDeal(); };
      document.querySelectorAll('.seg button[data-m]').forEach(function (b) { b.onclick = function () { sessionStorage.setItem('pmine', b.dataset.m); route(); }; });
      document.querySelectorAll('.deal').forEach(function (el) { el.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('dragging'); }); el.addEventListener('dragend', function () { el.classList.remove('dragging'); }); });
      document.querySelectorAll('.col').forEach(function (col) {
        col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('over'); });
        col.addEventListener('dragleave', function () { col.classList.remove('over'); });
        col.addEventListener('drop', async function (e) {
          e.preventDefault(); col.classList.remove('over'); var id = e.dataTransfer.getData('text/plain'), st = col.dataset.stage;
          if (st === 'lost') return lostDialog(id);
          try { await api('deals/' + id, 'PATCH', { stage: st }); if (st === 'won') celebrate(); route(); } catch (x) { toast(x.message, true); }
        });
      });
    });
    return html;
  };
  function celebrate() { toast('Deal won. Nicely done!'); var c = document.createElement('div'); c.className = 'confetti'; c.setAttribute('aria-hidden', 'true'); for (var i = 0; i < 24; i++) { var s = document.createElement('i'); s.style.left = (Math.random() * 100) + '%'; s.style.animationDelay = (Math.random() * .4) + 's'; c.appendChild(s); } document.body.appendChild(c); setTimeout(function () { c.remove(); }, 2200); }
  function lostDialog(id) {
    modal('<h2>Mark as lost</h2><label class="fld"><span>Why was it lost?</span><select name="lost_reason">' + opts([['Price', 'Price'], ['Went with someone else', 'Went with someone else'], ['No budget', 'No budget'], ['Bad timing', 'Bad timing'], ['No reply', 'No reply'], ['Not a fit', 'Not a fit'], ['Other', 'Other']], 'No reply') + '</select></label>', async function (f) { await api('deals/' + id, 'PATCH', { stage: 'lost', lost_reason: f.lost_reason }); route(); });
    document.getElementById('dlgOk').textContent = 'Mark lost';
  }
  async function addDeal(contact) {
    var team = await teamList();
    modal('<h2>New deal</h2><label class="fld"><span>Deal name</span><input name="title" required maxlength="140" placeholder="e.g. Acme · VA 20h/week"></label>' + (contact ? '<p class="lead">For ' + esc(contact.name) + '</p>' : '<div class="row2"><label class="fld"><span>Contact name</span><input name="contact_name" maxlength="120" required></label><label class="fld"><span>Company</span><input name="company" maxlength="120"></label></div><label class="fld"><span>Contact email</span><input name="email" type="email"></label>') + '<div class="row2"><label class="fld"><span>Value (USD)</span><input name="value_usd" type="number" min="0" step="1"></label><label class="fld"><span>Expected close</span><input name="close_date" type="date"></label></div><div class="row2"><label class="fld"><span>Stage</span><select name="stage">' + opts(DSTAGES.slice(0, 5), 'new') + '</select></label><label class="fld"><span>Owner</span><select name="owner_id">' + opts(team.filter(function (t) { return t.role !== 'va'; }).map(function (t) { return [t.id, t.name]; }), ME.id) + '</select></label></div>', async function (f) { if (contact) f.contact_id = contact.id; var r = await api('deals', 'POST', f); location.hash = '#deal/' + r.id; });
  }

  // Activity composer shared by contact and deal pages
  function composer(ctx) {
    return '<div class="card composer" style="margin-bottom:16px"><div class="ctabs" role="tablist">' + [['note', 'Note'], ['call', 'Log call'], ['meeting', 'Log meeting'], ['email', 'Email'], ['task', 'Task']].map(function (t, i) { return '<button role="tab" data-k="' + t[0] + '" aria-selected="' + (i === 0) + '">' + (KIND_ICON[t[0]] || '✓') + ' ' + t[1] + '</button>'; }).join('') + '</div><div id="cbody"></div></div>';
  }
  function bindComposer(ctx, reload) {
    var bodyEl = document.getElementById('cbody');
    function draw(k) {
      document.querySelectorAll('.ctabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.k === k)); });
      if (k === 'email') {
        if (!ctx.email) { bodyEl.innerHTML = '<p class="empty">Add an email address to this contact first.</p>'; return; }
        bodyEl.innerHTML = '<form id="cF"><div class="inline" style="margin-bottom:10px;flex-wrap:wrap"><select id="tpl" aria-label="Template" style="width:auto;flex:1"><option value="">Start from a template…</option></select><button type="button" class="btn btn-sm" id="saveTpl">Save as template</button></div><label class="fld"><span>To</span><input value="' + esc(ctx.name + ' <' + ctx.email + '>') + '" readonly></label><label class="fld"><span>Subject</span><input name="subject" required maxlength="160"></label><label class="fld"><span>Message</span><textarea name="body" required maxlength="8000" style="min-height:150px" placeholder="Hi {{first_name}},"></textarea><small>Merge fields: {{first_name}}, {{name}}, {{company}}, {{my_name}}. Replies come back to ' + esc(ME.email) + '.</small></label><div class="inline" style="justify-content:flex-end"><button class="btn btn-acc">Send email</button></div></form>';
        api('templates').then(function (r) { var s = document.getElementById('tpl'); if (!s) return; r.items.forEach(function (t) { var o = document.createElement('option'); o.value = t.id; o.textContent = t.name; s.appendChild(o); }); s.onchange = function () { var t = r.items.find(function (x) { return x.id === s.value; }); if (t) { document.querySelector('#cF [name=subject]').value = t.subject; document.querySelector('#cF [name=body]').value = t.body; } }; }).catch(function () {});
        document.getElementById('saveTpl').onclick = function () { var f = document.getElementById('cF'); if (!f.subject.value || !f.body.value) return toast('Write a subject and message first.', true); modal('<h2>Save template</h2><label class="fld"><span>Template name</span><input name="name" required maxlength="80"></label><label class="fld"><span>Who can use it</span><select name="shared">' + opts([['1', 'Whole team'], ['0', 'Only me']], '1') + '</select></label>', async function (x) { await api('templates', 'POST', { name: x.name, subject: f.subject.value, body: f.body.value, shared: x.shared === '1' }); toast('Template saved.'); draw('email'); }); };
        document.getElementById('cF').onsubmit = async function (e) { e.preventDefault(); var b = e.target.querySelector('.btn-acc'); b.disabled = true; try { await api('contacts/' + ctx.contact_id + '/email', 'POST', { subject: e.target.subject.value, body: e.target.body.value, deal_id: ctx.deal_id || null }); toast('Email sent and logged.'); reload(); } catch (x) { toast(x.message, true); b.disabled = false; } };
        return;
      }
      if (k === 'task') {
        bodyEl.innerHTML = '<form id="cF"><label class="fld"><span>Task</span><input name="title" required maxlength="200" placeholder="e.g. Send proposal"></label><div class="row2"><label class="fld"><span>Due</span><input type="date" name="due"></label><label class="fld"><span>Assign to</span><select name="assignee_id" id="tAs"></select></label></div><div class="inline" style="justify-content:space-between;flex-wrap:wrap"><span class="inline" style="gap:16px;flex-wrap:wrap"><label class="chk" style="margin:0"><input type="checkbox" name="priority"> <span>High priority</span></label><label class="chk" style="margin:0"><input type="checkbox" name="client_visible"> <span>Client can see it</span></label></span><button class="btn btn-acc">Add task</button></div></form>';
        teamList().then(function (t) { document.getElementById('tAs').innerHTML = opts(t.map(function (u) { return [u.id, u.name]; }), ME.id); });
        document.getElementById('cF').onsubmit = async function (e) { e.preventDefault(); var f = Object.fromEntries(new FormData(e.target)); f.priority = !!f.priority; f.client_visible = !!f.client_visible; f.contact_id = ctx.contact_id; f.deal_id = ctx.deal_id || null; try { await api('tasks', 'POST', f); toast('Task added.'); reload(); } catch (x) { toast(x.message, true); } };
        return;
      }
      var ph = { note: 'What should the team know? Type @name to notify a teammate.', call: 'Who did you speak to and what was agreed? Next step?', meeting: 'Meeting notes, decisions and next steps.' }[k];
      bodyEl.innerHTML = '<form id="cF"><textarea name="body" required maxlength="3000" placeholder="' + esc(ph) + '"></textarea><div class="inline" style="justify-content:space-between;margin-top:10px;flex-wrap:wrap">' + (k === 'note' && ctx.portal ? '<label class="chk" style="margin:0"><input type="checkbox" name="client"> <span>Also send to the client\'s Messages</span></label>' : '<span></span>') + '<button class="btn btn-acc">Save ' + esc(KIND_NAME[k].toLowerCase()) + '</button></div></form>';
      document.getElementById('cF').onsubmit = async function (e) { e.preventDefault(); var f = Object.fromEntries(new FormData(e.target)); try { await api('activities', 'POST', { kind: k, body: f.body, contact_id: ctx.contact_id, deal_id: ctx.deal_id || null, visibility: f.client ? 'client' : 'internal' }); reload(); } catch (x) { toast(x.message, true); } };
    }
    document.querySelectorAll('.ctabs button').forEach(function (b) { b.onclick = function () { draw(b.dataset.k); }; });
    draw('note');
  }
  function timeline(notes) {
    if (!notes.length) return empty('Calls, emails, notes and stage changes appear here.');
    var groups = {}; notes.forEach(function (n) { var k = n.created_at.slice(0, 10); (groups[k] = groups[k] || []).push(n); });
    return Object.keys(groups).map(function (k) { return '<h4 class="tday">' + esc(k === today() ? 'Today' : day(k)) + '</h4><ul class="timeline">' + groups[k].map(function (n) { var kd = n.kind || 'note'; return '<li class="' + esc(kd) + (n.visibility === 'client' ? ' client' : '') + '"><span class="ticon" aria-hidden="true">' + (KIND_ICON[kd] || '•') + '</span><div class="meta">' + esc(KIND_NAME[kd] || 'Note') + ' · ' + esc(n.author_name || 'Client') + ' · ' + esc(new Date(n.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + (n.visibility === 'client' ? ' · shared with client' : '') + '</div><p>' + esc(n.body).replace(/@([A-Za-z][\w.-]{1,30})/g, '<b class="mention">@$1</b>') + '</p></li>'; }).join('') + '</ul>'; }).join('');
  }

  V.deal = async function (id) {
    var d = await api('deals/' + encodeURIComponent(id)), x = d.deal, c = d.contact;
    var idx = DSTAGES.findIndex(function (s) { return s[0] === x.stage; });
    var html = top(x.title, [c ? c.name : 'No contact', c && c.company].filter(Boolean).join(' · '), '<a class="btn" href="#pipeline">Pipeline</a>');
    html += '<div class="dealhead card"><div class="dh-val"><span>Value</span><b>' + (x.value_usd ? money(x.value_usd) : '—') + '</b><small>' + x.probability + '% chance · ' + money(x.weighted || 0) + ' weighted</small></div><div class="dh-st">' + (x.stage === 'won' ? '<span class="pill won big">Won ' + esc(day(x.closed_at)) + '</span>' : x.stage === 'lost' ? '<span class="pill lost big">Lost' + (x.lost_reason ? ': ' + esc(x.lost_reason) : '') + '</span>' : '<button class="btn btn-acc" id="win">Won</button><button class="btn btn-danger" id="lose">Lost</button>') + '</div></div>';
    html += '<ol class="stepper" aria-label="Deal stage">' + DSTAGES.slice(0, 5).map(function (s, i) { return '<li><button data-st="' + s[0] + '" class="' + (i < idx || x.stage === 'won' ? 'done' : i === idx ? 'cur' : '') + '"' + (i === idx ? ' aria-current="step"' : '') + '>' + esc(s[1]) + '</button></li>'; }).join('') + '</ol>';
    html += '<div class="split"><div>' + composer() + '<div class="card" style="margin-bottom:16px"><h2>Tasks</h2>' + (d.tasks.length ? '<ul class="list">' + d.tasks.map(taskRow).join('') + '</ul>' : empty('No tasks yet. Add one above so nothing slips.')) + '</div><div class="card"><h2>Activity</h2>' + timeline(d.notes) + '</div></div>';
    html += '<div><div class="card" style="margin-bottom:16px"><h2>Details <button class="btn btn-sm" id="editD">Edit</button></h2><dl class="kv"><dt>Owner</dt><dd><select id="dOwner" aria-label="Owner">' + opts(d.team.filter(function (t) { return t.role !== 'va'; }).map(function (t) { return [t.id, t.name]; }), x.owner_id, 'Nobody') + '</select></dd><dt>Close date</dt><dd>' + esc(x.close_date ? day(x.close_date) : '—') + (x.overdue ? ' <span class="pill gold">past</span>' : '') + '</dd><dt>Source</dt><dd>' + esc(x.source || '—') + '</dd><dt>Created</dt><dd>' + esc(day(x.created_at)) + '</dd><dt>In stage</dt><dd>' + esc(ago(x.stage_changed_at).replace(' ago', '')) + (x.rotting ? ' <span class="pill gold">idle ' + x.idle_days + 'd</span>' : '') + '</dd></dl></div>';
    html += c ? '<div class="card"><h2>Contact <a href="#contact/' + esc(c.id) + '">Open</a></h2><div class="person"><span class="av">' + initials(c.name) + '</span><div><b>' + esc(c.name) + '</b><div style="color:var(--muted);font-size:13px">' + esc(c.company || '') + '</div></div></div><dl class="kv" style="margin-top:14px"><dt>Email</dt><dd>' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '—') + '</dd><dt>Phone</dt><dd>' + (c.phone ? '<a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + '</a>' : '—') + '</dd></dl></div>' : '';
    if (ADMIN) html += '<p style="margin-top:14px"><button class="btn btn-sm btn-danger" id="delD">Delete deal</button></p>';
    html += '</div></div>';
    setTimeout(function () {
      var reload = function () { route(); };
      bindComposer({ contact_id: c && c.id, deal_id: x.id, email: c && c.email, name: c && c.name }, reload);
      bindTasks(reload);
      document.querySelectorAll('.stepper button').forEach(function (b) { b.onclick = async function () { try { await api('deals/' + x.id, 'PATCH', { stage: b.dataset.st }); reload(); } catch (e) { toast(e.message, true); } }; });
      var w = document.getElementById('win'); if (w) w.onclick = async function () { try { await api('deals/' + x.id, 'PATCH', { stage: 'won' }); celebrate(); reload(); } catch (e) { toast(e.message, true); } };
      var l = document.getElementById('lose'); if (l) l.onclick = function () { lostDialog(x.id); };
      document.getElementById('dOwner').onchange = async function (e) { try { await api('deals/' + x.id, 'PATCH', { owner_id: e.target.value }); toast('Owner updated.'); } catch (er) { toast(er.message, true); } };
      document.getElementById('editD').onclick = function () { modal('<h2>Edit deal</h2><label class="fld"><span>Deal name</span><input name="title" required value="' + esc(x.title) + '"></label><div class="row2"><label class="fld"><span>Value (USD)</span><input name="value_usd" type="number" min="0" value="' + esc(x.value_usd == null ? '' : x.value_usd) + '"></label><label class="fld"><span>Expected close</span><input name="close_date" type="date" value="' + esc(x.close_date || '') + '"></label></div><label class="fld"><span>Chance of winning (%)</span><input name="probability" type="number" min="0" max="100" value="' + esc(x.probability) + '"><small>Leave as is to use the stage default.</small></label>', async function (f) { await api('deals/' + x.id, 'PATCH', f); reload(); }); };
      var del = document.getElementById('delD'); if (del) del.onclick = function () { modal('<h2>Delete this deal?</h2><p class="lead">Its notes and tasks stay on the contact.</p>', async function () { await api('deals/' + x.id, 'DELETE'); location.hash = '#pipeline'; }); document.getElementById('dlgOk').textContent = 'Delete'; };
    });
    return html;
  };

  function addContact() {
    modal('<h2>Add contact</h2><div class="row2"><label class="fld"><span>Name</span><input name="name" required maxlength="120"></label><label class="fld"><span>Company</span><input name="company" maxlength="120"></label></div><div class="row2"><label class="fld"><span>Email</span><input name="email" type="email"></label><label class="fld"><span>Phone</span><input name="phone" maxlength="40"></label></div><div class="row2"><label class="fld"><span>Country</span><input name="country" maxlength="60"></label><label class="fld"><span>Source</span><input name="source" maxlength="60" placeholder="Referral, LinkedIn…"></label></div><div class="row2"><label class="fld"><span>Type</span><select name="kind">' + opts([['lead', 'Lead'], ['client', 'Client'], ['partner', 'Partner']], 'lead') + '</select></label><label class="fld"><span>LinkedIn profile</span><input name="linkedin" maxlength="300" placeholder="linkedin.com/in/…"></label></div><label class="chk"><input type="checkbox" name="private"> <span>Private: only I can see this contact</span></label>', async function (f) { f.private = !!f.private; var r = await api('contacts', 'POST', f); location.hash = '#contact/' + r.id; });
  }
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) { var ch = text[i]; if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; } else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    var head = (rows.shift() || []).map(function (h) { return h.trim().toLowerCase().replace(/[^a-z]/g, ''); });
    var map = { name: ['name', 'fullname', 'contact', 'contactname'], email: ['email', 'emailaddress'], company: ['company', 'business', 'organization', 'organisation'], phone: ['phone', 'mobile', 'phonenumber'], country: ['country'], source: ['source', 'leadsource'], tags: ['tags', 'tag', 'labels'], kind: ['kind', 'type'] };
    return rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); }).map(function (r) { var o = {}; Object.keys(map).forEach(function (k) { var i = head.findIndex(function (h) { return map[k].includes(h); }); if (i >= 0) o[k] = (r[i] || '').trim(); }); if (!o.name && head.includes('firstname')) o.name = [r[head.indexOf('firstname')], r[head.indexOf('lastname')]].filter(Boolean).join(' ').trim(); return o; });
  }

  V.contacts = async function () {
    var F = JSON.parse(sessionStorage.getItem('cf') || '{}'), qs = new URLSearchParams();
    ['q', 'kind', 'tag', 'owner'].forEach(function (k) { if (F[k]) qs.set(k, F[k]); });
    var d = await api('contacts' + (qs.toString() ? '?' + qs : ''));
    var html = top('Contacts', d.items.length + ' people and companies', (ADMIN ? '<a class="btn" href="/api/contacts.csv" download>Export</a>' : '') + '<label class="btn" style="cursor:pointer">Import CSV<input type="file" id="imp" accept=".csv,text/csv" hidden></label><button class="btn btn-acc" id="addC">Add contact</button>');
    html += '<div class="tools"><input type="search" id="q" placeholder="Search name, company, email or phone" value="' + esc(F.q || '') + '" aria-label="Search contacts"><select id="fk" aria-label="Type">' + opts([['lead', 'Leads'], ['client', 'Clients'], ['partner', 'Partners']], F.kind, 'All types') + '</select><select id="ft" aria-label="Tag">' + opts(d.tags.map(function (t) { return [t, '#' + t]; }), F.tag, 'All tags') + '</select><select id="fo" aria-label="Owner">' + opts([['me', 'Mine']], F.owner, 'Any owner') + '</select></div>';
    html += '<div class="bulk" id="bulk" hidden><b id="bn">0 selected</b><select id="ba" aria-label="Bulk action">' + opts([['outreach', 'Add to LinkedIn queue…'], ['tag', 'Add tag…'], ['untag', 'Remove tag…'], ['owner', 'Set owner…'], ['kind', 'Set type…']].concat(ADMIN ? [['delete', 'Delete']] : []), '', 'Choose an action') + '</select><button class="btn btn-sm btn-acc" id="bgo">Apply</button><button class="btn btn-sm" id="bclr">Clear</button></div>';
    html += d.items.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th style="width:34px"><input type="checkbox" id="all" aria-label="Select all"></th><th>Name</th><th class="hide-sm">Type</th><th class="hide-sm">Open deals</th><th class="hide-sm">Owner</th><th>Last activity</th></tr></thead><tbody>' + d.items.map(function (c) { return '<tr class="click" data-href="#contact/' + esc(c.id) + '"><td><input type="checkbox" class="sel" value="' + esc(c.id) + '" aria-label="Select ' + esc(c.name) + '"></td><td><a href="#contact/' + esc(c.id) + '" style="text-decoration:none"><b>' + esc(c.name) + '</b></a>' + (c.private ? ' <span class="pill priv" title="Only you can see this contact">Private</span>' : '') + '<span class="sub">' + esc([c.company, c.email].filter(Boolean).join(' · ')) + '</span>' + (c.tags.length ? '<span class="chips" style="margin-top:4px">' + c.tags.map(function (t) { return '<span class="tag">#' + esc(t) + '</span>'; }).join('') + '</span>' : '') + '</td><td class="hide-sm">' + pill(c.kind === 'client' ? 'won' : c.kind === 'partner' ? 'call' : 'new', { lead: 'Lead', client: 'Client', partner: 'Partner' }[c.kind]) + '</td><td class="hide-sm">' + (c.open_deals ? c.open_deals + (c.open_value ? ' · ' + money(c.open_value) : '') : '—') + '</td><td class="hide-sm">' + esc(c.owner_name || '') + '</td><td>' + esc(ago(c.last_activity || c.updated_at)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="card">' + empty(F.q || F.kind || F.tag ? 'Nothing matches these filters.' : 'No contacts yet. Website requests land here automatically, or import a CSV.') + '</div>';
    setTimeout(function () {
      var save = function () { sessionStorage.setItem('cf', JSON.stringify(F)); route(); };
      document.getElementById('addC').onclick = addContact;
      var t; document.getElementById('q').addEventListener('input', function (e) { clearTimeout(t); t = setTimeout(function () { F.q = e.target.value; sessionStorage.setItem('cf', JSON.stringify(F)); route().then(function () { var i = document.getElementById('q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); });
      document.getElementById('fk').onchange = function (e) { F.kind = e.target.value; save(); };
      document.getElementById('ft').onchange = function (e) { F.tag = e.target.value; save(); };
      document.getElementById('fo').onchange = function (e) { F.owner = e.target.value; save(); };
      document.querySelectorAll('tr.click').forEach(function (tr) { tr.onclick = function (e) { if (e.target.tagName !== 'A' && e.target.tagName !== 'INPUT') location.hash = tr.dataset.href; }; });
      var sels = function () { return [].slice.call(document.querySelectorAll('.sel:checked')).map(function (x) { return x.value; }); };
      var sync = function () { var n = sels().length; document.getElementById('bulk').hidden = !n; document.getElementById('bn').textContent = n + ' selected'; };
      document.querySelectorAll('.sel').forEach(function (x) { x.onchange = sync; });
      var all = document.getElementById('all'); if (all) all.onchange = function () { document.querySelectorAll('.sel').forEach(function (x) { x.checked = all.checked; }); sync(); };
      document.getElementById('bclr').onclick = function () { document.querySelectorAll('.sel').forEach(function (x) { x.checked = false; }); if (all) all.checked = false; sync(); };
      document.getElementById('bgo').onclick = async function () {
        var a = document.getElementById('ba').value, ids = sels(); if (!a) return toast('Choose an action.', true);
        if (a === 'outreach') return queueOutreach(ids);
        var team = a === 'owner' ? await teamList() : null;
        var field = a === 'owner' ? '<select name="value">' + opts(team.filter(function (u) { return u.role !== 'va'; }).map(function (u) { return [u.id, u.name]; }), ME.id) + '</select>' : a === 'kind' ? '<select name="value">' + opts([['lead', 'Lead'], ['client', 'Client'], ['partner', 'Partner']], 'lead') + '</select>' : a === 'delete' ? '<p class="lead">This deletes ' + ids.length + ' contacts with their notes and requests. Deals stay without a contact.</p><input type="hidden" name="value" value="x">' : '<input name="value" maxlength="30" required placeholder="e.g. vip">';
        modal('<h2>' + esc({ tag: 'Add a tag', untag: 'Remove a tag', owner: 'Set owner', kind: 'Set type', delete: 'Delete contacts' }[a]) + ' (' + ids.length + ')</h2><label class="fld">' + field + '</label>', async function (f) { var r = await api('contacts/bulk', 'POST', { ids: ids, action: a, value: f.value }); toast(r.count + ' contacts updated.'); route(); });
        if (a === 'delete') document.getElementById('dlgOk').textContent = 'Delete';
      };
      document.getElementById('imp').onchange = function (e) {
        var file = e.target.files[0]; if (!file) return;
        var rd = new FileReader(); rd.onload = function () {
          var rows = parseCsv(String(rd.result)); var ok = rows.filter(function (r) { return r.name; });
          modal('<h2>Import ' + ok.length + ' contacts?</h2><p class="lead">We found columns for: ' + esc(Object.keys(rows[0] || {}).join(', ') || 'nothing we recognise') + '. Rows without a name, and emails already in the CRM, are skipped.</p>' + (ok.length ? '<div class="tblwrap" style="max-height:220px;overflow:auto"><table class="tbl"><tbody>' + ok.slice(0, 6).map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.email || '') + '</td><td>' + esc(r.company || '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="err">Your file needs a "Name" column (or First name and Last name).</p>'), async function () { if (!ok.length) throw new Error('Nothing to import.'); var r = await api('contacts/import', 'POST', { rows: ok }); toast(r.added + ' added, ' + r.skipped + ' skipped.'); route(); });
          document.getElementById('dlgOk').textContent = 'Import';
        }; rd.readAsText(file);
      };
    });
    return html;
  };

  V.contact = async function (id) {
    var d = await api('contacts/' + encodeURIComponent(id)), c = d.contact;
    var html = top(c.name, [c.company, { lead: 'Lead', client: 'Client', partner: 'Partner' }[c.kind]].filter(Boolean).join(' · '), '<a class="btn" href="#contacts">Back</a>');
    html += '<div class="split"><div>' + composer();
    html += '<div class="card" style="margin-bottom:16px"><h2>Deals <button class="btn btn-sm" id="addD">New deal</button></h2>' + (d.deals.length ? '<ul class="list">' + d.deals.map(function (x) { return '<li><a class="row" href="#deal/' + esc(x.id) + '"><div class="t"><b>' + esc(x.title) + '</b><span>' + esc([x.value_usd ? money(x.value_usd) : '', x.owner_name, x.close_date ? 'Close ' + day(x.close_date) : ''].filter(Boolean).join(' · ')) + '</span></div></a>' + pill(x.stage === 'won' ? 'won' : x.stage === 'lost' ? 'lost' : 'call', DSTAGE[x.stage]) + '</li>'; }).join('') + '</ul>' : empty('No deals yet.')) + '</div>';
    html += '<div class="card" style="margin-bottom:16px"><h2>Tasks</h2>' + (d.tasks.length ? '<ul class="list">' + d.tasks.map(taskRow).join('') + '</ul>' : empty('No tasks for this contact.')) + '</div>';
    if (d.requests.length) html += '<div class="card" style="margin-bottom:16px"><h2>Requests</h2><ul class="list">' + d.requests.map(function (r) { return '<li><div class="t"><b>' + esc(r.title) + '</b><span style="white-space:pre-wrap">' + esc(r.details || '') + '</span><span>' + esc(ago(r.created_at)) + '</span></div><select class="reqSt" data-id="' + esc(r.id) + '" aria-label="Request status" style="width:auto">' + opts([['new', 'New'], ['in_progress', 'In progress'], ['done', 'Done'], ['closed', 'Closed']], r.status) + '</select></li>'; }).join('') + '</ul></div>';
    html += '<div class="card"><h2>Activity</h2>' + timeline(d.notes) + '</div></div><div>';
    html += '<div class="card" style="margin-bottom:16px"><h2>Details <button class="btn btn-sm" id="editC">Edit</button></h2><dl class="kv"><dt>Email</dt><dd>' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '—') + '</dd><dt>Phone</dt><dd>' + (c.phone ? '<a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + '</a>' : '—') + '</dd><dt>Country</dt><dd>' + esc(c.country || '—') + '</dd><dt>Source</dt><dd>' + esc(c.source || '—') + '</dd><dt>LinkedIn</dt><dd>' + (c.linkedin ? '<a href="' + esc(c.linkedin) + '" target="_blank" rel="noopener">Open profile</a>' : '—') + '</dd><dt>Who sees it</dt><dd>' + (!c.owner_id || c.owner_id === ME.id || SUPER ? '<select id="privSel" aria-label="Who sees this contact">' + opts([['0', 'Whole team'], ['1', 'Only me']], c.private ? '1' : '0') + '</select>' : esc(c.private ? 'Only its owner' : 'Whole team')) + '</dd><dt>Owner</dt><dd><select id="ownerSel" aria-label="Owner">' + opts(d.team.filter(function (t) { return t.role !== 'va'; }).map(function (t) { return [t.id, t.name]; }), c.owner_id, 'Nobody') + '</select></dd><dt>Added</dt><dd>' + esc(day(c.created_at)) + '</dd><dt>Tags</dt><dd><div class="chips" id="tags">' + c.tags.map(function (t) { return '<button class="tag rm" data-t="' + esc(t) + '" title="Remove">#' + esc(t) + ' ×</button>'; }).join('') + '<button class="tag add" id="addTag">+ tag</button></div></dd></dl></div>';
    html += '<div class="card" style="margin-bottom:16px"><h2>Virtual assistants</h2>' + (d.vas.length ? '<ul class="list">' + d.vas.map(function (v) { return '<li><span class="av">' + initials(v.name) + '</span><div class="t"><b>' + esc(v.name) + '</b></div><button class="btn btn-sm unassign" data-va="' + esc(v.id) + '">Remove</button></li>'; }).join('') + '</ul>' : empty('No VA assigned.')) + (d.all_vas.length ? '<div class="inline" style="margin-top:10px"><select id="vaSel" aria-label="Virtual assistant">' + opts(d.all_vas.filter(function (v) { return !d.vas.some(function (x) { return x.id === v.id; }); }).map(function (v) { return [v.id, v.name]; }), '', 'Pick a VA') + '</select><button class="btn btn-sm" id="assign">Assign</button></div>' : '<p class="fine">Invite VAs from People to assign them.</p>') + '</div>';
    html += '<div class="card"><h2>Client sign-in</h2>' + (d.portal.length ? '<ul class="list">' + d.portal.map(function (u) { return '<li><div class="t"><b>' + esc(u.name) + '</b><span>' + esc(u.email) + '</span></div>' + pill(u.status) + '</li>'; }).join('') + '</ul>' : empty('This contact has no dashboard yet.') + (ADMIN && c.email ? '<button class="btn btn-sm" id="invClient">Invite to Client Suite</button>' : '')) + (ADMIN ? '<p style="margin-top:14px"><button class="btn btn-sm btn-danger" id="delC">Delete contact</button></p>' : '') + '</div>';
    html += '</div></div>';
    setTimeout(function () {
      var reload = function () { route(); };
      bindComposer({ contact_id: c.id, email: c.email, name: c.name, portal: d.portal.length > 0 }, reload);
      bindTasks(reload);
      document.getElementById('addD').onclick = function () { addDeal(c); };
      var ps = document.getElementById('privSel'); if (ps) ps.onchange = async function (e) { try { await api('contacts/' + c.id, 'PATCH', { private: e.target.value === '1' }); toast(e.target.value === '1' ? 'Private: only you can see this contact now.' : 'Shared with the team.'); } catch (x) { toast(x.message, true); route(); } };
      document.getElementById('ownerSel').onchange = async function (e) { try { await api('contacts/' + c.id, 'PATCH', { owner_id: e.target.value }); toast('Owner updated.'); } catch (x) { toast(x.message, true); } };
      document.querySelectorAll('.reqSt').forEach(function (s) { s.onchange = async function () { try { await api('requests/' + s.dataset.id, 'PATCH', { status: s.value }); toast('Request updated.'); } catch (x) { toast(x.message, true); } }; });
      var setTags = async function (tags) { try { await api('contacts/' + c.id, 'PATCH', { tags: tags }); reload(); } catch (x) { toast(x.message, true); } };
      document.querySelectorAll('.tag.rm').forEach(function (b) { b.onclick = function () { setTags(c.tags.filter(function (t) { return t !== b.dataset.t; })); }; });
      document.getElementById('addTag').onclick = function () { modal('<h2>Add a tag</h2><label class="fld"><span>Tag</span><input name="t" required maxlength="30" placeholder="e.g. vip, referral, 2026"></label>', async function (f) { await setTags(c.tags.concat([f.t.replace(/^#/, '')])); }); };
      document.getElementById('editC').onclick = function () {
        modal('<h2>Edit contact</h2><div class="row2"><label class="fld"><span>Name</span><input name="name" required value="' + esc(c.name) + '"></label><label class="fld"><span>Company</span><input name="company" value="' + esc(c.company || '') + '"></label></div><div class="row2"><label class="fld"><span>Email</span><input name="email" type="email" value="' + esc(c.email || '') + '"></label><label class="fld"><span>Phone</span><input name="phone" value="' + esc(c.phone || '') + '"></label></div><div class="row2"><label class="fld"><span>Country</span><input name="country" value="' + esc(c.country || '') + '"></label><label class="fld"><span>Source</span><input name="source" value="' + esc(c.source || '') + '"></label></div><div class="row2"><label class="fld"><span>Type</span><select name="kind">' + opts([['lead', 'Lead'], ['client', 'Client'], ['partner', 'Partner']], c.kind) + '</select></label><label class="fld"><span>LinkedIn profile</span><input name="linkedin" maxlength="300" value="' + esc(c.linkedin || '') + '" placeholder="linkedin.com/in/…"></label></div>', async function (f) { await api('contacts/' + c.id, 'PATCH', f); reload(); });
      };
      var a = document.getElementById('assign'); if (a) a.onclick = async function () { var v = document.getElementById('vaSel').value; if (!v) return toast('Pick a VA first.', true); try { await api('contacts/' + c.id + '/assign', 'POST', { va_id: v }); reload(); } catch (x) { toast(x.message, true); } };
      document.querySelectorAll('.unassign').forEach(function (b) { b.onclick = async function () { try { await api('contacts/' + c.id + '/assign', 'POST', { va_id: b.dataset.va, on: false }); reload(); } catch (x) { toast(x.message, true); } }; });
      var inv = document.getElementById('invClient'); if (inv) inv.onclick = async function () { try { var r = await api('users', 'POST', { name: c.name, email: c.email, role: 'client', contact_id: c.id }); showLink(r.emailed ? 'Client invite sent' : 'Client invite ready', r.link, (r.emailed ? 'We emailed it to ' + c.email + '. ' : 'Send this link to ' + c.name + '. ') + 'It works once and expires in 7 days.'); } catch (x) { toast(x.message, true); } };
      var del = document.getElementById('delC'); if (del) del.onclick = function () { modal('<h2>Delete ' + esc(c.name) + '?</h2><p class="lead">This removes the contact, its notes, requests and VA assignments. Deals and tasks stay, without the contact.</p>', async function () { await api('contacts/' + c.id, 'DELETE'); location.hash = '#contacts'; }); document.getElementById('dlgOk').textContent = 'Delete'; };
    });
    return html;
  };
  function taskRow(t) {
    var od = t.status !== 'done' && t.due && t.due < today();
    return '<li class="trow' + (t.priority ? ' hi' : '') + '"><input type="checkbox" class="tdone" data-id="' + esc(t.id) + '"' + (t.status === 'done' ? ' checked' : '') + ' aria-label="Done" style="width:18px;height:18px;accent-color:var(--gold)"><div class="t"><b' + (t.status === 'done' ? ' style="text-decoration:line-through;color:var(--dim)"' : '') + '>' + (t.priority ? '<span class="prio" title="High priority">!</span> ' : '') + esc(t.title) + '</b><span>' + esc([t.deal_title || t.contact_name, t.assignee_name, t.client_visible ? 'Client can see' : ''].filter(Boolean).join(' · ')) + (t.due ? ' <span class="' + (od ? 'od' : '') + '">' + (od ? 'Overdue · ' : 'Due ') + esc(day(t.due)) + '</span>' : '') + '</span></div><select class="tst" data-id="' + esc(t.id) + '" aria-label="Task status" style="width:auto">' + opts([['open', 'To do'], ['doing', 'Doing'], ['done', 'Done']], t.status) + '</select></li>';
  }
  function bindTasks(reload) {
    var set = async function (id, status) { try { await api('tasks/' + id, 'PATCH', { status: status }); reload(); } catch (x) { toast(x.message, true); } };
    document.querySelectorAll('.tdone').forEach(function (c) { c.onchange = function () { set(c.dataset.id, c.checked ? 'done' : 'open'); }; });
    document.querySelectorAll('.tst').forEach(function (s) { s.onchange = function () { set(s.dataset.id, s.value); }; });
  }
  async function addTask(team, contactId, contacts) {
    var html = '<h2>Add task</h2><label class="fld"><span>Task</span><input name="title" required maxlength="200"></label><div class="row2"><label class="fld"><span>Due</span><input type="date" name="due"></label>';
    if (TEAM) html += '<label class="fld"><span>Assign to</span><select name="assignee_id">' + opts((team || []).map(function (t) { return [t.id, t.name]; }), ME.id) + '</select></label>';
    html += '</div>';
    if (contacts) html += '<label class="fld"><span>Client</span><select name="contact_id">' + opts(contacts.map(function (c) { return [c.id, c.company || c.name]; }), '', 'None') + '</select></label>';
    html += '<label class="chk"><input type="checkbox" name="priority"> <span>High priority</span></label>';
    if (TEAM) html += '<label class="chk"><input type="checkbox" name="client_visible"> <span>Show this task to the client</span></label>';
    modal(html, async function (f) { if (contactId) f.contact_id = contactId; f.client_visible = !!f.client_visible; f.priority = !!f.priority; await api('tasks', 'POST', f); route(); });
  }

  V.tasks = async function () {
    var mine = TEAM ? (sessionStorage.getItem('tmine') !== '0') : true;
    var d = await api('tasks' + (TEAM && mine ? '?mine=1' : ''));
    var t0 = today(), wk = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    var open = d.items.filter(function (t) { return t.status !== 'done'; }), done = d.items.filter(function (t) { return t.status === 'done'; });
    var groups = [['Overdue', open.filter(function (t) { return t.due && t.due < t0; }), 'od'], ['Today', open.filter(function (t) { return t.due === t0; }), 'today'], ['Next 7 days', open.filter(function (t) { return t.due > t0 && t.due <= wk; }), ''], ['Later', open.filter(function (t) { return t.due > wk; }), ''], ['No due date', open.filter(function (t) { return !t.due; }), '']];
    var cons = null;
    if (TEAM) { try { cons = (await api('contacts')).items; } catch (e) {} }
    if (ROLE === 'va') { try { cons = (await api('va/clients')).items; } catch (e) {} }
    var html = top(ROLE === 'va' ? 'Tasks' : 'My day', open.length + ' open · ' + groups[0][1].length + ' overdue · ' + groups[1][1].length + ' due today', '<button class="btn btn-acc" id="addT">Add task</button>');
    if (TEAM) html += '<div class="seg" style="max-width:320px"><button data-m="1" aria-selected="' + mine + '">Mine</button><button data-m="0" aria-selected="' + !mine + '">Everyone</button></div>';
    html += groups.filter(function (g) { return g[1].length; }).map(function (g) { return '<div class="card tgroup ' + g[2] + '" style="margin-bottom:16px"><h2>' + esc(g[0]) + ' <span class="count">' + g[1].length + '</span></h2><ul class="list">' + g[1].map(taskRow).join('') + '</ul></div>'; }).join('') || '<div class="card">' + empty('All clear. Nothing open.') + '</div>';
    if (done.length) html += '<details class="card"><summary><b>Done</b> <span class="count">' + done.length + '</span></summary><ul class="list" style="margin-top:10px">' + done.slice(0, 40).map(taskRow).join('') + '</ul></details>';
    setTimeout(function () {
      bindTasks(route);
      document.querySelectorAll('.seg button[data-m]').forEach(function (b) { b.onclick = function () { sessionStorage.setItem('tmine', b.dataset.m); route(); }; });
      document.getElementById('addT').onclick = async function () { addTask(TEAM ? await teamList() : null, null, cons || []); };
    });
    return html;
  };

  // ----- Reports -----
  function bars(items, label, value, fmt) {
    var mx = Math.max.apply(null, items.map(value).concat([1]));
    return items.length ? '<ul class="list stagebars rbars">' + items.map(function (x) { return '<li><span title="' + esc(label(x)) + '">' + esc(label(x)) + '</span><div class="bar"><i style="width:' + (value(x) / mx * 100) + '%"></i></div><b>' + esc(fmt ? fmt(value(x)) : value(x)) + '</b></li>'; }).join('') + '</ul>' : empty('No data in this period yet.');
  }
  V.reports = async function () {
    var days = +(sessionStorage.getItem('rdays') || 90), r = await api('reports?days=' + days);
    var openTot = r.open.reduce(function (a, x) { return a + x.v; }, 0), openW = r.open.reduce(function (a, x) { return a + x.w; }, 0);
    var html = top('Reports', 'How Delegance is selling', '<select id="rd" aria-label="Period" style="width:auto">' + opts([[30, 'Last 30 days'], [90, 'Last 90 days'], [180, 'Last 6 months'], [365, 'Last 12 months']], days) + '</select>');
    html += '<div class="grid g4" style="margin-bottom:16px">' + [['Won', money(r.won.v) || 'US$0', r.won.n + ' deals', true], ['Win rate', r.win_rate == null ? '—' : r.win_rate + '%', r.won.n + ' won · ' + r.lost + ' lost'], ['Average deal', r.avg_deal ? money(r.avg_deal) : '—', r.won.cycle != null ? r.won.cycle + ' days to close on average' : 'Days to close appear after the first win'], ['Open pipeline', money(openTot) || 'US$0', money(Math.round(openW)) + ' weighted forecast', true]].map(function (k) { return '<div class="card kpi' + (k[3] ? ' hot' : '') + '"><span>' + esc(k[0]) + '</span><b data-count>' + esc(k[1]) + '</b><small>' + esc(k[2]) + '</small></div>'; }).join('') + '</div>';
    // revenue by month (12 months)
    var months = []; for (var i = 11; i >= 0; i--) { var dt = new Date(); dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() - i); var k = dt.toISOString().slice(0, 7), f = r.months.find(function (m) { return m.mo === k; }); months.push({ k: k, v: f ? f.v : 0, n: f ? f.n : 0 }); }
    var mx = Math.max.apply(null, months.map(function (m) { return m.v; }).concat([1]));
    html += '<div class="card" style="margin-bottom:16px"><h2>Won per month</h2><div class="vbars" role="img" aria-label="Revenue won per month, last 12 months">' + months.map(function (m) { return '<div class="vb" style="--i:' + months.indexOf(m) + '" title="' + esc(m.k + ': ' + (money(m.v) || 'US$0') + ' from ' + m.n + ' deals') + '"><i style="height:' + Math.max(2, m.v / mx * 100) + '%"></i><span>' + esc(new Date(m.k + '-15').toLocaleDateString(undefined, { month: 'short' })) + '</span></div>'; }).join('') + '</div></div>';
    var funnel = DSTAGES.slice(0, 5).map(function (s) { var f = r.open.find(function (x) { return x.stage === s[0]; }) || { n: 0, v: 0 }; return { name: s[1], n: f.n, v: f.v }; });
    html += '<div class="grid g2" style="margin-bottom:16px"><div class="card"><h2>Open deals by stage</h2>' + bars(funnel, function (x) { return x.name; }, function (x) { return x.n; }) + '</div><div class="card"><h2>New leads by source <small style="font:400 12px Inter;color:var(--dim)">' + r.new_leads + ' total</small></h2>' + bars(r.sources, function (x) { return x.source; }, function (x) { return x.n; }) + '</div></div>';
    html += '<div class="grid g2"><div class="card"><h2>Leaderboard</h2>' + (r.owners.length ? '<table class="tbl"><thead><tr><th>Owner</th><th>Won</th><th>Value</th><th>Open</th></tr></thead><tbody>' + r.owners.map(function (o, i) { return '<tr><td>' + (i === 0 && o.v ? '<span class="crown" aria-hidden="true">♛</span> ' : '') + esc(o.name) + '</td><td>' + o.won + '</td><td>' + (money(o.v) || '—') + '</td><td>' + o.open + '</td></tr>'; }).join('') + '</tbody></table>' : empty('No deals yet.')) + '</div><div class="card"><h2>Why deals were lost</h2>' + bars(r.lost_reasons, function (x) { return x.reason; }, function (x) { return x.n; }) + '</div></div>';
    var act = {}; r.activity.forEach(function (a) { act[a.name] = act[a.name] || { name: a.name, n: 0 }; act[a.name].n += a.n; });
    html += '<div class="card" style="margin-top:16px"><h2>Team activity <small style="font:400 12px Inter;color:var(--dim)">notes, calls, meetings and emails</small></h2>' + bars(Object.values(act).sort(function (a, b) { return b.n - a.n; }), function (x) { return x.name; }, function (x) { return x.n; }) + '</div>';
    setTimeout(function () { document.getElementById('rd').onchange = function (e) { sessionStorage.setItem('rdays', e.target.value); route(); }; });
    return html;
  };

  // ----- Global search (Ctrl/Cmd+K) and the bell -----
  function openSearch() {
    dlg.innerHTML = '<div class="search"><input type="search" id="gs" placeholder="Search contacts, deals and tasks…" aria-label="Search" autocomplete="off"><div id="gsr" class="gsr"><p class="hint">Type at least 2 letters. Tip: press Ctrl+K anywhere.</p></div></div>';
    dlg.classList.add('sdlg'); dlg.showModal();
    dlg.addEventListener('close', function () { dlg.classList.remove('sdlg'); }, { once: true });
    var inp = document.getElementById('gs'), out = document.getElementById('gsr'), t;
    inp.focus();
    inp.oninput = function () { clearTimeout(t); t = setTimeout(async function () { var q = inp.value.trim(); if (q.length < 2) { out.innerHTML = '<p class="hint">Type at least 2 letters.</p>'; return; } try { var r = await api('search?q=' + encodeURIComponent(q)); var sec = function (title, items, fn) { return items.length ? '<h4>' + title + '</h4>' + items.map(fn).join('') : ''; }; out.innerHTML = (sec('Contacts', r.contacts, function (c) { return '<a href="#contact/' + esc(c.id) + '"><span class="av xs">' + initials(c.name) + '</span><span><b>' + esc(c.name) + '</b><small>' + esc([c.company, c.email].filter(Boolean).join(' · ')) + '</small></span></a>'; }) + sec('Deals', r.deals, function (d) { return '<a href="#deal/' + esc(d.id) + '"><span class="av xs gold">$</span><span><b>' + esc(d.title) + '</b><small>' + esc([DSTAGE[d.stage], d.value_usd ? money(d.value_usd) : '', d.contact_name].filter(Boolean).join(' · ')) + '</small></span></a>'; }) + sec('Tasks', r.tasks, function (x) { return '<a href="#tasks"><span class="av xs">✓</span><span><b>' + esc(x.title) + '</b><small>' + esc(x.due ? 'Due ' + day(x.due) : 'No due date') + '</small></span></a>'; })) || '<p class="hint">Nothing found for "' + esc(q) + '".</p>'; out.querySelectorAll('a').forEach(function (a) { a.onclick = function () { dlg.close(); }; }); } catch (x) { out.innerHTML = '<p class="err">' + esc(x.message) + '</p>'; } }, 220); };
    inp.onkeydown = function (e) { if (e.key === 'Escape') { e.preventDefault(); dlg.close(); return; } if (e.key === 'Enter') { var a = out.querySelector('a'); if (a) { location.hash = a.getAttribute('href'); dlg.close(); } } };
  }
  async function loadBell() {
    var b = document.getElementById('bell'); if (!b) return;
    try { var r = await api('notifications'); b.dataset.n = r.unread; b.querySelector('.dot').hidden = !r.unread; b.querySelector('.dot').textContent = r.unread > 9 ? '9+' : r.unread; b._items = r.items; } catch (e) {}
  }
  function openBell() {
    var b = document.getElementById('bell'), items = b._items || [];
    dlg.innerHTML = '<div class="bellp"><h2>Notifications</h2>' + (items.length ? '<ul class="list">' + items.map(function (n) { return '<li class="' + (n.read_at ? '' : 'unread') + '"><a class="row" href="' + esc(n.link || '#home') + '"><div class="t"><b>' + esc(n.title) + '</b><span>' + esc([n.body, ago(n.created_at)].filter(Boolean).join(' · ')) + '</span></div></a></li>'; }).join('') + '</ul>' : empty('You are all caught up.')) + '<div class="acts"><button class="btn" id="bclose">Close</button></div></div>';
    dlg.showModal();
    dlg.querySelectorAll('a').forEach(function (a) { a.onclick = function () { dlg.close(); }; });
    document.getElementById('bclose').onclick = function () { dlg.close(); };
    if (b.dataset.n !== '0') api('notifications/read', 'POST', {}).then(loadBell).catch(function () {});
  }

  V.requests = async function () {
    var d = await api('requests');
    var html = top(TEAM ? 'Requests' : 'Requests', TEAM ? 'From the website, members and clients' : 'Everything you have asked us for', TEAM ? '' : '<button class="btn btn-acc" id="newReq">New request</button>');
    if (!d.items.length) html += '<div class="card">' + empty(TEAM ? 'No requests yet. The website "Start a request" form sends them here.' : 'No requests yet.') + '</div>';
    else if (TEAM) html += '<div class="tblwrap"><table class="tbl"><thead><tr><th>Request</th><th class="hide-sm">From</th><th>Status</th><th class="hide-sm">Sent</th></tr></thead><tbody>' + d.items.map(function (r) { return '<tr><td><b>' + esc(r.title) + '</b><span class="sub" style="white-space:pre-wrap">' + esc((r.details || '').slice(0, 220)) + '</span></td><td class="hide-sm"><a href="#contact/' + esc(r.contact_id) + '">' + esc(r.contact_name || 'Contact') + '</a><span class="sub">' + esc(r.company || '') + '</span></td><td><select class="reqSt" data-id="' + esc(r.id) + '" aria-label="Status" style="width:auto">' + opts([['new', 'New'], ['in_progress', 'In progress'], ['done', 'Done'], ['closed', 'Closed']], r.status) + '</select></td><td class="hide-sm">' + esc(ago(r.created_at)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    else html += '<div class="card"><ul class="list">' + d.items.map(function (r) { return '<li><div class="t"><b>' + esc(r.title) + '</b><span style="white-space:pre-wrap">' + esc(r.details || '') + '</span><span>Sent ' + esc(day(r.created_at)) + '</span></div>' + pill(r.status) + '</li>'; }).join('') + '</ul></div>';
    setTimeout(function () {
      var b = document.getElementById('newReq'); if (b) b.onclick = newRequest;
      document.querySelectorAll('.reqSt').forEach(function (s) { s.onchange = async function () { try { await api('requests/' + s.dataset.id, 'PATCH', { status: s.value }); toast('Request updated.'); } catch (x) { toast(x.message, true); } }; });
    });
    return html;
  };

  V.messages = async function () {
    var d = await api('messages');
    var html = top('Messages', 'A direct line to the Delegance team') + '<div class="card"><div class="chat" id="chat">' + (d.items.length ? d.items.map(function (m) { return '<div class="bub ' + (m.from === 'you' ? 'you' : '') + '"><p>' + esc(m.body) + '</p><small>' + esc(m.name) + ' · ' + esc(ago(m.at)) + '</small></div>'; }).join('') : empty('Say hello. We usually reply within one business day.')) + '</div><form id="msgF" style="margin-top:14px"><label class="fld"><span class="sr" style="position:absolute;left:-9999px">Message</span><textarea name="body" required maxlength="3000" placeholder="Write a message…" style="min-height:80px"></textarea></label><div class="inline" style="justify-content:flex-end"><button class="btn btn-acc">Send</button></div></form></div>';
    setTimeout(function () { var ch = document.getElementById('chat'); ch.scrollTop = ch.scrollHeight; document.getElementById('msgF').onsubmit = async function (e) { e.preventDefault(); var f = Object.fromEntries(new FormData(e.target)); try { await api('messages', 'POST', f); route(); } catch (x) { toast(x.message, true); } }; });
    return html;
  };

  V.team = async function () {
    var d = await api('dash');
    return top('My team', 'The people working with you') + (d.team.length ? '<div class="grid g3">' + d.team.map(function (t) { return '<div class="card"><div class="person"><span class="av">' + (t.photo ? '<img src="' + esc(t.photo) + '" alt="">' : initials(t.name)) + '</span><div><b>' + esc(t.name) + '</b><div style="color:var(--muted);font-size:13px">' + esc(t.title) + '</div></div></div>' + (t.slug ? '<p style="margin-top:14px"><a class="btn btn-sm" href="/va/' + esc(t.slug) + '" target="_blank" rel="noopener">View profile</a></p>' : '') + '</div>'; }).join('') + '</div>' : '<div class="card">' + empty('Your virtual assistant shows here once Delegance assigns one.') + '</div>');
  };

  V.clients = async function () {
    var d = await api('va/clients');
    return top('My clients', 'Clients Delegance assigned to you') + (d.items.length ? '<div class="grid g3">' + d.items.map(function (c) { return '<div class="card"><div class="person"><span class="av">' + initials(c.company || c.name) + '</span><div><b>' + esc(c.company || c.name) + '</b><div style="color:var(--muted);font-size:13px">' + esc([c.company ? c.name : '', c.country].filter(Boolean).join(' · ')) + '</div></div></div></div>'; }).join('') + '</div><p class="fine">Client contact details stay with Delegance. Use your tasks and the team chat for questions.</p>' : '<div class="card">' + empty('No clients assigned yet.') + '</div>');
  };

  V.hours = async function () {
    var d = await api('timesheets'), cl = [];
    if (ROLE === 'va') { try { cl = (await api('va/clients')).items; } catch (e) {} }
    var total = d.items.reduce(function (a, t) { return a + t.minutes; }, 0);
    var html = top(ROLE === 'va' ? 'Timesheet' : 'Hours', hrs(total) + ' in the last ' + d.items.length + ' entries', ROLE === 'va' ? '<button class="btn btn-acc" id="logBtn">Log hours</button>' : '');
    html += d.items.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Day</th>' + (TEAM ? '<th>VA</th>' : '') + '<th>Client</th><th>Hours</th><th class="hide-sm">Note</th><th></th></tr></thead><tbody>' + d.items.map(function (t) { return '<tr><td>' + esc(day(t.day)) + '</td>' + (TEAM ? '<td>' + esc(t.va_name || '') + '</td>' : '') + '<td>' + esc(t.contact_name || 'General') + '</td><td><b>' + hrs(t.minutes) + '</b></td><td class="hide-sm">' + esc(t.note || '') + '</td><td><button class="btn btn-sm delTs" data-id="' + esc(t.id) + '" aria-label="Delete entry">Delete</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="card">' + empty('No hours logged yet.') + '</div>';
    setTimeout(function () {
      var b = document.getElementById('logBtn'); if (b) b.onclick = function () { logHours(cl); };
      document.querySelectorAll('.delTs').forEach(function (x) { x.onclick = async function () { try { await api('timesheets/' + x.dataset.id, 'DELETE'); route(); } catch (e) { toast(e.message, true); } }; });
    });
    return html;
  };

  V.people = async function () {
    var d = await api('users');
    var roles = d.can_give.map(function (r) { return [r, ROLE_NAME[r]]; });
    var html = top('People', d.items.length + ' accounts', '<button class="btn btn-acc" id="inv">Invite someone</button>');
    html += '<div class="tblwrap"><table class="tbl"><thead><tr><th>Person</th><th>Role</th><th>Status</th><th class="hide-sm">Last sign-in</th><th></th></tr></thead><tbody>' + d.items.map(function (u) {
      return '<tr><td><b>' + esc(u.name) + '</b>' + (u.id === ME.id ? ' <span class="pill">You</span>' : '') + '<span class="sub">' + esc(u.email) + (u.title ? ' · ' + esc(u.title) : '') + '</span></td><td>' + esc(u.role_name) + '</td><td>' + pill(u.status) + (u.mfa ? ' <span class="pill active" title="2-step sign-in on">2-step</span>' : '') + '</td><td class="hide-sm">' + esc(u.last_login ? ago(u.last_login) : 'Never') + '</td><td>' + (u.id !== ME.id && (SUPER || ['staff', 'va', 'client', 'member'].includes(u.role)) ? '<button class="btn btn-sm editU" data-id="' + esc(u.id) + '">Manage</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="fine">Invite links and password reset links work once. Send them to the person yourself, by email or chat.</p>';
    setTimeout(function () {
      document.getElementById('inv').onclick = function () {
        modal('<h2>Invite someone</h2><div class="row2"><label class="fld"><span>Name</span><input name="name" required maxlength="80"></label><label class="fld"><span>Email</span><input name="email" type="email" required></label></div><div class="row2"><label class="fld"><span>Role</span><select name="role" id="invRole">' + opts(roles, 'staff') + '</select></label><label class="fld"><span>Job title (optional)</span><input name="title" maxlength="80"></label></div><label class="fld" id="invVa" hidden><span>Link VA profile</span><select name="candidate_id">' + opts(d.candidates.map(function (c) { return [c.id, c.name]; }), '', 'Not yet') + '</select></label><label class="fld" id="invCl" hidden><span>Client record</span><select name="contact_id">' + opts(d.contacts.map(function (c) { return [c.id, c.company ? c.company + ' (' + c.name + ')' : c.name]; }), '', 'Create a new one') + '</select></label>', async function (f) { var r = await api('users', 'POST', f); showLink(r.emailed ? 'Invite sent' : 'Invite ready', r.link, r.emailed ? 'We emailed this link to ' + f.email + '. You can also copy it and send it another way. It works once and expires in 7 days.' : 'Send this link to ' + f.name + '. It works once and expires in 7 days.'); setTimeout(route, 50); return true; });
        var rs = document.getElementById('invRole'), sync = function () { document.getElementById('invVa').hidden = rs.value !== 'va'; document.getElementById('invCl').hidden = rs.value !== 'client'; }; rs.onchange = sync; sync();
      };
      document.querySelectorAll('.editU').forEach(function (b) {
        b.onclick = function () {
          var u = d.items.find(function (x) { return x.id === b.dataset.id; });
          modal('<h2>' + esc(u.name) + '</h2><p class="lead">' + esc(u.email) + '</p><div class="row2"><label class="fld"><span>Name</span><input name="name" value="' + esc(u.name) + '"></label><label class="fld"><span>Job title</span><input name="title" value="' + esc(u.title || '') + '"></label></div><div class="row2"><label class="fld"><span>Role</span><select name="role">' + opts(roles.some(function (r) { return r[0] === u.role; }) ? roles : roles.concat([[u.role, ROLE_NAME[u.role]]]), u.role) + '</select></label><label class="fld"><span>Status</span><select name="status">' + opts([['active', 'Active'], ['disabled', 'Off (cannot sign in)']].concat(u.status === 'invited' ? [['invited', 'Invited']] : []), u.status) + '</select></label></div><label class="fld"><span>VA profile</span><select name="candidate_id">' + opts(d.candidates.map(function (c) { return [c.id, c.name]; }), u.candidate_id, 'None') + '</select></label><label class="fld"><span>Client record</span><select name="contact_id">' + opts(d.contacts.map(function (c) { return [c.id, c.company ? c.company + ' (' + c.name + ')' : c.name]; }), u.contact_id, 'None') + '</select></label><div class="inline" style="flex-wrap:wrap;margin:6px 0 10px"><button type="button" class="btn btn-sm" id="uLink">' + (u.status === 'invited' ? 'New invite link' : 'Password reset link') + '</button><button type="button" class="btn btn-sm" id="uOut">Sign out everywhere</button>' + (u.mfa ? '<button type="button" class="btn btn-sm" id="uMfa">Reset 2-step sign-in</button>' : '') + '' + (SUPER ? '<button type="button" class="btn btn-sm btn-danger" id="uDel">Delete account</button>' : '') + '</div>', async function (f) { await api('users/' + u.id, 'PATCH', f); toast('Saved.'); route(); });
          document.getElementById('uLink').onclick = async function () { try { var r = await api('users/' + u.id + '/link', 'POST', {}); showLink(u.status === 'invited' ? 'New invite link' : 'Password reset link', r.link, (r.emailed ? 'We emailed this to ' + u.email + '. ' : 'Send this to ' + u.name + '. ') + 'It works once and expires in ' + (u.status === 'invited' ? '7 days.' : '24 hours.')); } catch (x) { toast(x.message, true); } };
          document.getElementById('uOut').onclick = async function () { try { await api('users/' + u.id + '/sessions', 'DELETE'); toast(u.name + ' is signed out everywhere.'); } catch (x) { toast(x.message, true); } };
          var um = document.getElementById('uMfa'); if (um) um.onclick = async function () { if (um.dataset.sure !== '1') { um.dataset.sure = '1'; um.textContent = 'Click again: they set it up again at next sign-in'; return; } try { await api('users/' + u.id + '/mfa', 'DELETE'); toast('2-step sign-in reset for ' + u.name + '.'); dlg.close(); route(); } catch (x) { toast(x.message, true); } };
          var del = document.getElementById('uDel'); if (del) del.onclick = async function () { if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Click again to delete'; return; } try { await api('users/' + u.id, 'DELETE'); dlg.close(); toast('Account deleted.'); route(); } catch (x) { toast(x.message, true); } };
        };
      });
    });
    return html;
  };

  V.vas = async function () {
    var st = sessionStorage.getItem('vst2') || 'new', d = await api('candidates?status=' + st), n = d.counts || {};
    var tabs = [['new', 'New on the board'], ['verified', 'Verified'], ['hidden', 'Hidden']].concat(n.pending ? [['pending', 'Older, waiting']] : []);
    var html = top('VA profiles', 'Open job board: profiles go live at delegance.app/candidates as soon as a VA applies. Verify the good ones, hide the rest.') + '<div class="seg" style="max-width:560px">' + tabs.map(function (s) { return '<button data-s="' + s[0] + '" aria-selected="' + (s[0] === st) + '">' + esc(s[1]) + (n[s[0]] ? ' (' + n[s[0]] + ')' : '') + '</button>'; }).join('') + '</div>';
    html += d.items.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Candidate</th><th class="hide-sm">Experience</th><th class="hide-sm">Updated</th><th></th></tr></thead><tbody>' + d.items.map(function (c) {
      var live = c.status === 'approved';
      return '<tr><td><b>' + esc(c.name) + '</b>' + (c.verified ? ' <span class="pill gold">Verified</span>' : '') + '<span class="sub">' + esc([c.headline, c.location].filter(Boolean).join(' · ')) + '</span></td><td class="hide-sm">' + esc([c.years ? c.years + ' yrs' : '', c.availability].filter(Boolean).join(' · ')) + '</td><td class="hide-sm">' + esc(ago(c.updated_at)) + '</td><td><div class="inline" style="flex-wrap:wrap">' + (live ? '<a class="btn btn-sm" href="/va/' + esc(c.slug) + '" target="_blank" rel="noopener">View</a>' : '<a class="btn btn-sm" href="https://desk.delegance.app/#/candidates" target="_blank" rel="noopener">Full profile</a>') + (!c.verified ? '<button class="btn btn-sm btn-acc cand" data-id="' + esc(c.id) + '" data-a="verify">Verify</button>' : '<button class="btn btn-sm cand" data-id="' + esc(c.id) + '" data-a="unverify">Remove badge</button>') + (live ? '<button class="btn btn-sm cand" data-id="' + esc(c.id) + '" data-a="hide">Hide</button>' : '<button class="btn btn-sm cand" data-id="' + esc(c.id) + '" data-a="show">Show on board</button>') + '</div></td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="card">' + empty(st === 'new' ? 'No new profiles. When a VA applies at delegance.app/apply, they show up here and on the board right away.' : 'Nothing here.') + '</div>';
    setTimeout(function () {
      document.querySelectorAll('.seg button[data-s]').forEach(function (b) { b.onclick = function () { sessionStorage.setItem('vst2', b.dataset.s); route(); }; });
      var A = { verify: ['Verify this VA?', 'Adds a gold "Verified by Delegance" badge and moves them to the top of the board.', 'Verify', { status: 'approved', verified: true }, 'Verified.'], unverify: ['Remove the Verified badge?', 'The profile stays on the board without the badge.', 'Remove badge', { status: 'approved', verified: false }, 'Badge removed.'], hide: ['Hide this profile?', 'It disappears from the board. You can show it again later.', 'Hide', { status: 'rejected' }, 'Hidden from the board.'], show: ['Show this profile on the board?', 'It goes live at delegance.app/candidates.', 'Show', { status: 'approved', verified: false }, 'Live on the board.'] };
      document.querySelectorAll('.cand').forEach(function (b) { b.onclick = function () { var x = A[b.dataset.a]; modal('<h2>' + x[0] + '</h2><p class="lead">' + x[1] + '</p><label class="fld"><span>Note to the VA (optional)</span><textarea name="note" maxlength="500"></textarea></label>', async function (f) { await api('candidates/' + b.dataset.id, 'POST', Object.assign({ note: f.note }, x[3])); toast(x[4]); route(); }); document.getElementById('dlgOk').textContent = x[2]; }; });
    });
    return html;
  };

  V.news = async function () {
    var d = await api('announcements');
    var html = top(ADMIN ? 'Announcements' : 'Updates', ADMIN ? 'Post news to everyone, the team, VAs, clients or members' : 'News from Delegance', ADMIN ? '<button class="btn btn-acc" id="post">Post update</button>' : '');
    html += d.items.length ? '<div class="grid">' + d.items.map(function (a) { return '<article class="card"><h2 style="margin-bottom:6px">' + esc(a.title) + (ADMIN ? '<button class="btn btn-sm delA" data-id="' + esc(a.id) + '">Delete</button>' : '') + '</h2><p class="meta" style="color:var(--dim);font-size:12px;margin-bottom:10px">' + esc(a.author_name || 'Delegance') + ' · ' + esc(day(a.created_at)) + (ADMIN ? ' · For ' + esc({ all: 'everyone', team: 'the team', va: 'VAs', client: 'clients', member: 'members' }[a.audience]) : '') + '</p><p style="white-space:pre-wrap;color:var(--muted)">' + esc(a.body) + '</p></article>'; }).join('') + '</div>' : '<div class="card">' + empty('No updates yet.') + '</div>';
    setTimeout(function () {
      var p = document.getElementById('post'); if (p) p.onclick = function () { modal('<h2>Post an update</h2><label class="fld"><span>Title</span><input name="title" required maxlength="120"></label><label class="fld"><span>Message</span><textarea name="body" required maxlength="2000"></textarea></label><label class="fld"><span>Who sees it</span><select name="audience">' + opts([['all', 'Everyone'], ['team', 'Team (staff and admins)'], ['va', 'Virtual assistants'], ['client', 'Clients'], ['member', 'Members']], 'all') + '</select></label>', async function (f) { await api('announcements', 'POST', f); route(); }); document.getElementById('dlgOk').textContent = 'Post'; };
      document.querySelectorAll('.delA').forEach(function (b) { b.onclick = async function () { try { await api('announcements/' + b.dataset.id, 'DELETE'); route(); } catch (x) { toast(x.message, true); } }; });
    });
    return html;
  };

  V.audit = async function () {
    var d = await api('audit');
    return top('Security log', 'The last 200 sign-ins, invites and changes') + '<div class="tblwrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>What</th><th class="hide-sm">Detail</th></tr></thead><tbody>' + d.items.map(function (a) { return '<tr><td>' + esc(ago(a.created_at)) + '</td><td>' + esc(a.actor) + '</td><td>' + pill(/fail|delete|disabled/.test(a.action) ? 'lost' : 'x', a.action) + '</td><td class="hide-sm" style="color:var(--dim);font-size:13px">' + esc(a.detail || '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  };

  V.guides = async function () { location.href = '/guides'; return ''; };
  V.portfolio = async function () { location.href = '/apply'; return ''; };
  V.board = async function () { location.href = '/candidates'; return ''; };

  V.account = async function () {
    var ses = await api('auth/sessions');
    var html = top('Account', ROLE_NAME[ROLE] + ' · ' + ME.email);
    var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    html += '<div class="card" style="margin-bottom:16px"><h2>Delegance app</h2>' + (standalone ? '<p class="status-ok" role="status"><i aria-hidden="true"></i>You are using the installed app.</p>' : '<p class="sub" style="margin-bottom:12px">Put Delegance on your home screen or desktop. It opens full-screen like a normal app, on iPhone, iPad, Android, Windows, Mac and Chromebook.</p>' + (window.DLG_INSTALL ? '<button class="btn btn-acc" id="instApp">Install the app</button>' : ios ? '<p class="fine">On iPhone or iPad: in Safari tap the <b>Share</b> button, then <b>Add to Home Screen</b>, then <b>Add</b>.</p>' : '<p class="fine">In Chrome or Edge: click the install icon at the right end of the address bar, or open the browser menu and choose <b>Install Delegance</b> (on Android: <b>Add to Home screen</b>).</p>')) + '</div>';
    setTimeout(function () { var ib = document.getElementById('instApp'); if (ib) ib.onclick = async function () { var p = window.DLG_INSTALL; if (!p) return; p.prompt(); var r = await p.userChoice; window.DLG_INSTALL = null; toast(r.outcome === 'accepted' ? 'Installing Delegance…' : 'No problem. You can install it any time from here.'); route(); }; });
    html += '<div class="grid g2"><div class="card"><h2>Profile</h2><form id="profF"><label class="fld"><span>Name</span><input name="name" required maxlength="80" value="' + esc(ME.name) + '"></label><label class="fld"><span>Job title (optional)</span><input name="title" maxlength="80" value="' + esc(ME.title || '') + '"></label><button class="btn btn-acc">Save</button></form></div>';
    html += '<div class="card"><h2>Password</h2><form id="pwF"><label class="fld"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label><label class="fld"><span>New password</span><input type="password" name="password" autocomplete="new-password" minlength="10" required data-strength><small>At least 10 characters. Changing it signs out your other devices.</small></label><button class="btn btn-acc">Change password</button></form></div></div>';
    html += '<div class="grid g2" style="margin-top:16px"><div class="card"><h2>2-step sign-in ' + pill(ME.mfa ? 'active' : 'pending', ME.mfa ? 'On' : 'Off') + '</h2><div id="mfaBox">' + (ME.mfa
      ? '<p style="color:var(--muted);margin-bottom:14px">You enter a 6-digit code from your authenticator app after your password.' + (ME.mfa_required ? ' Required for team accounts.' : '') + '</p><form id="mfaAct" class="inline" style="flex-wrap:wrap"><input name="code" class="code-in" inputmode="numeric" maxlength="7" placeholder="123456" aria-label="Current 6-digit code" style="max-width:170px"><button class="btn" value="rec">New recovery codes</button>' + (ME.mfa_required ? '' : '<button class="btn btn-danger" value="off">Turn off</button>') + '</form><p class="fine">Type a current code from the app first.</p>'
      : '<p style="color:var(--muted);margin-bottom:14px">Add a 6-digit code from your phone to every sign-in, so a stolen password is not enough.</p><button class="btn btn-acc" id="mfaOn">Turn on</button>') + '</div></div>';
    html += '<div class="card"><h2>Email notifications</h2><label class="toggle"><span style="color:var(--muted)">Email me about new messages, tasks given to me and updates to my requests.</span><span class="switch"><input type="checkbox" id="notify"' + (ME.notify ? ' checked' : '') + ' aria-label="Email notifications"><i></i></span></label>' + (EMAIL ? '' : '<p class="fine">Email sending is being switched on.</p>') + '</div></div>';
    html += '<div class="card" style="margin-top:16px"><h2>Where you are signed in</h2><ul class="list">' + ses.items.map(function (x) { return '<li><div class="t"><b>' + esc(x.device) + (x.current ? ' <span class="pill active">This device</span>' : '') + '</b><span>' + esc([x.place, 'active ' + ago(x.last_seen), 'signed in ' + day(x.created_at)].filter(Boolean).join(' · ')) + '</span></div>' + (x.current ? '' : '<button class="btn btn-sm endS" data-id="' + esc(x.id) + '">Sign out</button>') + '</li>'; }).join('') + '</ul><div class="inline" style="flex-wrap:wrap;margin-top:14px"><button class="btn" id="so">Sign out</button><button class="btn btn-danger" id="soAll">Sign out on every device</button></div></div>';
    setTimeout(function () {
      document.getElementById('profF').onsubmit = async function (e) { e.preventDefault(); try { await api('auth/profile', 'POST', Object.fromEntries(new FormData(e.target))); toast('Saved.'); boot(); } catch (x) { toast(x.message, true); } };
      document.getElementById('pwF').onsubmit = async function (e) { e.preventDefault(); try { await api('auth/password', 'POST', Object.fromEntries(new FormData(e.target))); e.target.reset(); toast('Password changed.'); } catch (x) { toast(x.message, true); } };
      document.getElementById('so').onclick = signOut;
      document.getElementById('soAll').onclick = async function () { try { await api('auth/logout-all', 'POST', {}); } catch (x) {} location.replace('/login'); };
      document.querySelectorAll('.endS').forEach(function (b) { b.onclick = async function () { try { await api('auth/sessions/' + b.dataset.id, 'DELETE'); route(); } catch (x) { toast(x.message, true); } }; });
      document.getElementById('notify').onchange = async function (e) { try { await api('auth/notify', 'POST', { on: e.target.checked }); ME.notify = e.target.checked; toast(e.target.checked ? 'Email notifications on.' : 'Email notifications off.'); } catch (x) { toast(x.message, true); } };
      var on = document.getElementById('mfaOn'); if (on) on.onclick = function () { mfaSetup(document.getElementById('mfaBox'), async function () { await boot(); route(); }).catch(function (x) { toast(x.message, true); }); };
      var act = document.getElementById('mfaAct'); if (act) act.onsubmit = async function (e) {
        e.preventDefault(); var code = e.target.code.value, which = e.submitter && e.submitter.value;
        try {
          if (which === 'off') { await api('auth/totp/disable', 'POST', { code: code }); toast('2-step sign-in is off.'); await boot(); route(); }
          else { var r = await api('auth/totp/recovery', 'POST', { code: code }); showCodes(document.getElementById('mfaBox'), r.recovery, function () { route(); }); }
        } catch (x) { toast(x.message, true); }
      };
    });
    return html;
  };
  async function signOut() { try { await api('auth/logout', 'POST', {}); } catch (x) {} location.replace('/login'); }

  // ================= Automations, Integrations, Calendar =================
  var ACT_NAME = { create_task: 'Create a task', send_email: 'Send an email to the contact', notify: 'Notify someone (bell)', add_tag: 'Add a tag', remove_tag: 'Remove a tag', set_owner: 'Assign an owner', move_stage: 'Move the deal to a stage', create_deal: 'Create a deal', webhook: 'Send to a webhook (Zapier, Make, n8n, GoHighLevel)', wait: 'Wait' };
  var OPS = [['equals', 'is'], ['not_equals', 'is not'], ['contains', 'contains'], ['gte', 'is at least'], ['lte', 'is at most'], ['exists', 'is filled in'], ['missing', 'is empty']];
  var FIELD_NAME = { 'contact.source': 'Contact source', 'contact.kind': 'Contact type', 'contact.country': 'Country', 'contact.tags': 'Contact tags', 'contact.email': 'Contact email', 'deal.stage': 'Deal stage', 'deal.value_usd': 'Deal value (USD)', 'deal.source': 'Deal source', 'request.title': 'Request', 'booking.company': 'Booked company' };
  function stepSummary(s) {
    switch (s.type) {
      case 'create_task': return 'Task "' + (s.title || 'Follow up') + '"' + (s.due_days != null ? ', due in ' + s.due_days + ' day' + (s.due_days == 1 ? '' : 's') : '') + (s.assignee === 'round_robin' ? ', round robin' : s.assignee === 'owner' ? ', to the owner' : '');
      case 'send_email': return 'Email "' + (s.subject || '') + '"';
      case 'notify': return 'Notify ' + (s.to === 'admins' ? 'admins' : s.to === 'owner' ? 'the owner' : 'a teammate');
      case 'add_tag': return 'Add tag #' + (s.tag || '');
      case 'remove_tag': return 'Remove tag #' + (s.tag || '');
      case 'set_owner': return s.owner === 'round_robin' || !s.owner ? 'Assign owner (round robin)' : 'Assign owner';
      case 'move_stage': return 'Move deal to ' + (DSTAGE[s.stage] || s.stage);
      case 'create_deal': return 'Create a deal';
      case 'webhook': try { return 'Send to ' + new URL(s.url).hostname; } catch (e) { return 'Send to webhook'; }
      case 'wait': var h = +s.hours || 1; return 'Wait ' + (h % 24 === 0 ? (h / 24) + ' day' + (h === 24 ? '' : 's') : h + ' hour' + (h === 1 ? '' : 's'));
    }
    return s.type;
  }
  V.automations = async function () {
    var d = await api('automations'), tab = sessionStorage.getItem('atab') || 'list';
    var html = top('Automations', 'Your own workflows. New ones are private to you; share one with the team when you want to.', '<button class="btn btn-acc" id="newA">New automation</button>');
    html += '<div class="seg" style="max-width:340px"><button data-t="list" aria-selected="' + (tab === 'list') + '">Workflows</button><button data-t="log" aria-selected="' + (tab === 'log') + '">Run history</button></div>';
    if (tab === 'log') {
      var lg = await api('automations/log');
      html += lg.items.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>When</th><th>Automation</th><th class="hide-sm">For</th><th>What happened</th></tr></thead><tbody>' + lg.items.map(function (l) { return '<tr><td>' + esc(ago(l.created_at)) + '</td><td><b>' + esc(l.name || '') + '</b></td><td class="hide-sm">' + esc(l.subject || '') + '</td><td>' + pill(l.status === 'ok' ? 'done' : 'lost', l.status === 'ok' ? 'Done' : 'Error') + ' <span class="sub" style="display:inline">' + esc(l.detail || '') + '</span></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="card">' + empty('Nothing has run yet.') + '</div>';
    } else {
      var have = d.items.map(function (a) { return a.name; });
      var recipes = d.recipes.filter(function (r) { return have.indexOf(r.name) < 0; });
      if (recipes.length) html += '<div class="card recipes" style="margin-bottom:16px"><h2>One-click recipes</h2><div class="rgrid">' + recipes.map(function (r) { return '<button class="recipe" data-r="' + esc(r.key) + '"><b>' + esc(r.name) + '</b><span>When ' + esc((d.events[r.trigger] || r.trigger).toLowerCase()) + '</span><i>+ Add</i></button>'; }).join('') + '</div></div>';
      html += d.items.length ? '<div class="grid">' + d.items.map(function (a) { return '<div class="card flow"><div class="fhead"><div><h2 style="margin:0">' + esc(a.name) + '</h2><span class="sub">' + (a.mine ? '' : 'By ' + esc(a.owner_name || 'a teammate') + ' · ') + a.runs + ' runs' + (a.last_run ? ' · last ' + esc(ago(a.last_run)) : '') + '</span>' + '<span class="pill' + (a.sharing === 'private' ? ' priv' : '') + '" style="margin-top:6px;display:inline-block">' + esc({ private: 'Private: only you', view: 'Shared: team can view', edit: 'Shared: team can edit' }[a.sharing] || '') + '</span></div><div class="inline">' + (a.can_edit ? '<label class="switch" title="On / off"><input type="checkbox" class="aon" data-id="' + esc(a.id) + '"' + (a.active ? ' checked' : '') + ' aria-label="Automation on"><i></i></label><button class="btn btn-sm aedit" data-id="' + esc(a.id) + '">Edit</button>' : '<span class="sub">View only</span>') + '</div></div><ol class="chain"><li class="trig"><span>When</span>' + esc(d.events[a.trigger] || a.trigger) + (a.trigger_value ? ' <b>' + esc(a.trigger === 'deal.idle' ? a.trigger_value + ' days' : DSTAGE[a.trigger_value] || a.trigger_value) + '</b>' : '') + '</li>' + (a.conditions.length ? '<li class="cond"><span>If</span>' + a.conditions.map(function (c) { return esc(FIELD_NAME[c.field] + ' ' + (OPS.find(function (o) { return o[0] === c.op; }) || [0, c.op])[1] + (c.value ? ' "' + c.value + '"' : '')); }).join(' and ') + '</li>' : '') + a.actions.map(function (s) { return '<li class="' + (s.type === 'wait' ? 'wait' : 'act') + '"><span>' + (s.type === 'wait' ? 'Then' : 'Do') + '</span>' + esc(stepSummary(s)) + '</li>'; }).join('') + '</ol></div>'; }).join('') + '</div>' : '<div class="card">' + empty('No automations yet. Add a recipe above or build your own.') + '</div>';
    }
    setTimeout(function () {
      document.querySelectorAll('.seg button[data-t]').forEach(function (b) { b.onclick = function () { sessionStorage.setItem('atab', b.dataset.t); route(); }; });
      document.getElementById('newA').onclick = function () { editAutomation(d, null); };
      document.querySelectorAll('.recipe').forEach(function (b) { b.onclick = async function () { try { await api('automations', 'POST', { recipe: b.dataset.r }); toast('Recipe added and switched on.'); route(); } catch (x) { toast(x.message, true); } }; });
      document.querySelectorAll('.aon').forEach(function (c) { c.onchange = async function () { try { await api('automations/' + c.dataset.id, 'PATCH', { active: c.checked }); toast(c.checked ? 'Switched on.' : 'Paused.'); } catch (x) { toast(x.message, true); } }; });
      document.querySelectorAll('.aedit').forEach(function (b) { b.onclick = function () { editAutomation(d, d.items.find(function (a) { return a.id === b.dataset.id; })); }; });
    });
    return html;
  };
  function editAutomation(d, a) {
    var st = a ? JSON.parse(JSON.stringify(a)) : { name: '', trigger: 'lead.received', trigger_value: '', conditions: [], actions: [{ type: 'create_task', title: 'Follow up with {{contact.name}}', due_days: 1, assignee: 'owner' }] };
    var team = d.team.map(function (u) { return [u.id, u.name]; });
    function stepFields(s, i) {
      var f = function (k, label, input) { return '<label class="fld"><span>' + label + '</span>' + input + '</label>'; };
      var v = function (k) { return esc(s[k] == null ? '' : s[k]); };
      switch (s.type) {
        case 'create_task': return f('title', 'Task', '<input data-i="' + i + '" data-k="title" value="' + v('title') + '" placeholder="Call {{contact.name}}">') + '<div class="row2">' + f('due_days', 'Due in (days)', '<input type="number" min="0" data-i="' + i + '" data-k="due_days" value="' + v('due_days') + '">') + f('assignee', 'Give it to', '<select data-i="' + i + '" data-k="assignee">' + opts([['owner', 'The owner'], ['round_robin', 'Round robin (team takes turns)']].concat(team), s.assignee || 'owner') + '</select>') + '</div><label class="chk"><input type="checkbox" data-i="' + i + '" data-k="priority"' + (s.priority ? ' checked' : '') + '> <span>High priority</span></label>';
        case 'send_email': return f('subject', 'Subject', '<input data-i="' + i + '" data-k="subject" value="' + v('subject') + '">') + f('body', 'Message', '<textarea data-i="' + i + '" data-k="body" style="min-height:120px">' + v('body') + '</textarea>');
        case 'notify': return '<div class="row2">' + f('to', 'Who', '<select data-i="' + i + '" data-k="to">' + opts([['owner', 'The owner'], ['admins', 'All admins']].concat(team), s.to || 'owner') + '</select>') + f('title', 'Message', '<input data-i="' + i + '" data-k="title" value="' + v('title') + '">') + '</div>';
        case 'add_tag': case 'remove_tag': return f('tag', 'Tag', '<input data-i="' + i + '" data-k="tag" value="' + v('tag') + '" placeholder="vip">');
        case 'set_owner': return f('owner', 'Owner', '<select data-i="' + i + '" data-k="owner">' + opts([['round_robin', 'Round robin (team takes turns)']].concat(team), s.owner || 'round_robin') + '</select>');
        case 'move_stage': return f('stage', 'Stage', '<select data-i="' + i + '" data-k="stage">' + opts(DSTAGES, s.stage || 'contacted') + '</select>');
        case 'create_deal': return '<div class="row2">' + f('title', 'Deal name', '<input data-i="' + i + '" data-k="title" value="' + v('title') + '" placeholder="{{contact.company}} · VA team">') + f('value_usd', 'Value (USD)', '<input type="number" min="0" data-i="' + i + '" data-k="value_usd" value="' + v('value_usd') + '">') + '</div>';
        case 'webhook': return f('url', 'Webhook address (from Zapier, Make, n8n or GoHighLevel)', '<input data-i="' + i + '" data-k="url" value="' + v('url') + '" placeholder="https://hooks.zapier.com/…">') + f('secret', 'Signing secret (optional)', '<input data-i="' + i + '" data-k="secret" value="' + v('secret') + '">');
        case 'wait': return f('hours', 'Wait (hours) · 24 = 1 day, 168 = 1 week', '<input type="number" min="1" max="2160" data-i="' + i + '" data-k="hours" value="' + v('hours') + '">');
      }
      return '';
    }
    function draw() {
      var html = '<h2>' + (a ? 'Edit automation' : 'New automation') + '</h2><div class="aed">';
      html += '<div class="row2"><label class="fld"><span>Name</span><input id="aName" value="' + esc(st.name) + '" maxlength="80" required></label>' + (!a || a.mine ? '<label class="fld"><span>Who can see it</span><select id="aShare">' + opts([['private', 'Only me'], ['view', 'Team can view'], ['edit', 'Team can view and edit']], st.sharing || 'private') + '</select></label>' : '') + '</div>';
      html += '<div class="astep trig"><b>When</b><select id="aTrig">' + opts(Object.keys(d.events).map(function (k) { return [k, d.events[k]]; }), st.trigger) + '</select>' + (st.trigger === 'deal.stage_changed' ? '<select id="aTv">' + opts(DSTAGES, st.trigger_value, 'Any stage') + '</select>' : st.trigger === 'deal.idle' ? '<label class="inline">for <input id="aTv" type="number" min="1" style="width:90px" value="' + esc(st.trigger_value || 7) + '"> days</label>' : '') + '</div>';
      html += st.conditions.map(function (c, i) { return '<div class="astep cond"><b>If</b><select data-c="' + i + '" data-k="field">' + opts(d.fields.map(function (x) { return [x, FIELD_NAME[x] || x]; }), c.field) + '</select><select data-c="' + i + '" data-k="op">' + opts(OPS, c.op) + '</select>' + (c.op === 'exists' || c.op === 'missing' ? '' : '<input data-c="' + i + '" data-k="value" value="' + esc(c.value || '') + '">') + '<button type="button" class="xbtn" data-delc="' + i + '" aria-label="Remove condition">×</button></div>'; }).join('');
      html += '<button type="button" class="linkbtn" id="addCond">+ Add a condition</button>';
      html += st.actions.map(function (s, i) { return '<div class="astep act"><div class="ahead"><b>' + (s.type === 'wait' ? 'Then' : 'Do') + '</b><select data-i="' + i + '" data-k="type">' + opts(Object.keys(ACT_NAME).map(function (k) { return [k, ACT_NAME[k]]; }), s.type) + '</select><span class="amove">' + (i ? '<button type="button" class="xbtn" data-up="' + i + '" aria-label="Move up">↑</button>' : '') + '<button type="button" class="xbtn" data-dels="' + i + '" aria-label="Remove step">×</button></span></div>' + stepFields(s, i) + '</div>'; }).join('');
      html += '<button type="button" class="btn btn-sm" id="addStep">+ Add a step</button><p class="fine">Use {{first_name}}, {{contact.name}}, {{contact.company}}, {{deal.title}} or {{deal.value_usd}} in any text.</p></div>';
      if (a) html += '<div class="inline" style="flex-wrap:wrap;margin-top:8px"><button type="button" class="btn btn-sm" id="aTest">Test run now</button>' + (a.mine ? '<button type="button" class="btn btn-sm btn-danger" id="aDel">Delete</button>' : '') + '</div>';
      return html;
    }
    function bind() {
      var f = dlg.querySelector('form');
      f.querySelector('#aName').oninput = function (e) { st.name = e.target.value; };
      var sh = f.querySelector('#aShare'); if (sh) sh.onchange = function (e) { st.sharing = e.target.value; };
      f.querySelector('#aTrig').onchange = function (e) { st.trigger = e.target.value; st.trigger_value = ''; redraw(); };
      var tv = f.querySelector('#aTv'); if (tv) tv.onchange = function (e) { st.trigger_value = e.target.value; };
      f.querySelectorAll('[data-c]').forEach(function (el) { el.onchange = el.oninput = function () { st.conditions[+el.dataset.c][el.dataset.k] = el.value; if (el.dataset.k === 'op') redraw(); }; });
      f.querySelectorAll('[data-i]').forEach(function (el) { el.onchange = el.oninput = function () { var s = st.actions[+el.dataset.i]; if (el.dataset.k === 'type') { st.actions[+el.dataset.i] = { type: el.value }; if (el.value === 'wait') st.actions[+el.dataset.i].hours = 24; redraw(); return; } s[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; }; });
      f.querySelector('#addCond').onclick = function () { st.conditions.push({ field: 'contact.source', op: 'equals', value: '' }); redraw(); };
      f.querySelector('#addStep').onclick = function () { st.actions.push({ type: 'notify', to: 'owner', title: '' }); redraw(); };
      f.querySelectorAll('[data-delc]').forEach(function (b) { b.onclick = function () { st.conditions.splice(+b.dataset.delc, 1); redraw(); }; });
      f.querySelectorAll('[data-dels]').forEach(function (b) { b.onclick = function () { st.actions.splice(+b.dataset.dels, 1); redraw(); }; });
      f.querySelectorAll('[data-up]').forEach(function (b) { b.onclick = function () { var i = +b.dataset.up, x = st.actions[i]; st.actions[i] = st.actions[i - 1]; st.actions[i - 1] = x; redraw(); }; });
      var t = f.querySelector('#aTest'); if (t) t.onclick = async function () { try { var r = await api('automations/' + a.id + '/test', 'POST', {}); toast(r.result ? (r.result.status === 'ok' ? 'Ran: ' : 'Error: ') + r.result.detail : 'Ran.'); } catch (x) { toast(x.message, true); } };
      var del = f.querySelector('#aDel'); if (del) del.onclick = async function () { if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Click again to delete'; return; } await api('automations/' + a.id, 'DELETE'); dlg.close(); route(); };
    }
    function redraw() { var holder = dlg.querySelector('form'); var keep = holder.querySelector('.acts'); holder.querySelector('.abody').innerHTML = draw(); bind(); }
    modal('<div class="abody"></div>', async function () { if (!st.name.trim()) throw new Error('Give the automation a name.'); if (a) await api('automations/' + a.id, 'PATCH', st); else await api('automations', 'POST', st); toast('Automation saved.'); route(); });
    dlg.classList.add('wide');
    dlg.addEventListener('close', function () { dlg.classList.remove('wide'); }, { once: true });
    dlg.querySelector('.abody').innerHTML = draw(); bind();
  }

  V.integrations = async function () {
    var keys = await api('apikeys'), hooks = ADMIN ? await api('webhooks') : null, leads = ADMIN ? await api('leadhooks') : null;
    var html = top('Integrations', 'Connect Delegance to Claude, Zapier, Make, n8n, GoHighLevel and any form', '');
    html += '<div class="grid g2" style="margin-bottom:16px"><div class="card intro claude"><span class="eyebrow">Claude connector (MCP)</span><h2 style="margin:6px 0 8px">Talk to your CRM in Claude</h2><p class="sub">Ask Claude things like "who are my hottest deals?", "log a call with Grace and set a follow-up for Friday" or "email every new lead from this week". Claude uses 17 Delegance tools with your permissions.</p>' + (function () {
      var ck = keys.items.filter(function (k) { return k.mine && !k.revoked && /claude/i.test(k.name); })[0];
      if (!ck) return '<button class="btn btn-acc" id="mcpKey">Connect Claude</button>';
      return '<p class="status-ok' + (ck.last_used ? '' : ' wait') + '" role="status"><i aria-hidden="true"></i>' + (ck.last_used ? 'Connected · Claude last used it ' + esc(ago(ck.last_used)) : 'Address created ' + esc(ago(ck.created_at)) + ' · waiting for Claude\'s first call') + '</p><div class="inline" style="flex-wrap:wrap"><button class="btn btn-sm" id="mcpKey">New connector address</button><button class="btn btn-sm btn-danger rk" data-id="' + esc(ck.id) + '">Disconnect Claude</button></div>';
    })() + '</div>';
    html += '<div class="card intro"><span class="eyebrow">Automation platforms</span><h2 style="margin:6px 0 8px">Zapier, Make, n8n, GoHighLevel</h2><p class="sub">Send Delegance events out with webhooks, bring leads in with a lead-capture link, and read or write anything with an API key.</p><div class="logos"><span>Zapier</span><span>Make</span><span>n8n</span><span>GoHighLevel</span><span>Any form</span></div></div></div>';
    html += '<div class="card" style="margin-bottom:16px"><h2>API keys <button class="btn btn-sm" id="newKey">New key</button></h2>' + (keys.items.length ? '<ul class="list">' + keys.items.map(function (k) { return '<li><div class="t"><b>' + esc(k.name) + ' <span class="pill' + (k.scope === 'read' ? '' : ' gold') + '">' + (k.scope === 'read' ? 'Read only' : 'Read and write') + '</span>' + (k.revoked ? ' <span class="pill lost">Revoked</span>' : '') + '</b><span><code>' + esc(k.prefix) + '…</code>' + (k.owner ? ' · ' + esc(k.owner) : '') + ' · ' + (k.last_used ? 'used ' + esc(ago(k.last_used)) : 'never used') + '</span></div>' + (k.revoked ? '' : '<button class="btn btn-sm btn-danger rk" data-id="' + esc(k.id) + '">Revoke</button>') + '</li>'; }).join('') + '</ul>' : empty('No keys yet. A key lets Claude or an automation tool act as you.')) + '</div>';
    if (ADMIN) {
      html += '<div class="grid g2" style="margin-bottom:16px"><div class="card"><h2>Lead-capture links <button class="btn btn-sm" id="newLead">New link</button></h2><p class="sub" style="margin:-6px 0 12px">Paste a link into Facebook Lead Ads (via Zapier or Make), GoHighLevel, Typeform, WordPress or any form. Each submission becomes a contact and a deal.</p>' + (leads.items.length ? '<ul class="list">' + leads.items.map(function (h) { return '<li><div class="t"><b>' + esc(h.name) + (h.revoked_at ? ' <span class="pill lost">Off</span>' : '') + '</b><span><code>' + esc(h.prefix) + '…</code> · ' + h.count + ' leads' + (h.last_used ? ' · last ' + esc(ago(h.last_used)) : '') + '</span></div>' + (h.revoked_at ? '' : '<button class="btn btn-sm rl" data-id="' + esc(h.id) + '">Turn off</button>') + '</li>'; }).join('') + '</ul>' : empty('No links yet.')) + '</div>';
      html += '<div class="card"><h2>Webhooks <button class="btn btn-sm" id="newHook">New webhook</button></h2><p class="sub" style="margin:-6px 0 12px">Delegance sends events (new lead, deal won, booking…) to Zapier "Catch Hook", Make "Custom webhook", n8n "Webhook" or a GoHighLevel inbound webhook.</p>' + (hooks.items.length ? '<ul class="list">' + hooks.items.map(function (h) { var host = ''; try { host = new URL(h.url).hostname; } catch (e) {} return '<li><div class="t"><b>' + esc(h.name || host) + (h.active ? '' : ' <span class="pill lost">Paused</span>') + '</b><span>' + esc(h.events.indexOf('*') >= 0 ? 'All events' : h.events.join(', ')) + (h.last_at ? ' · last ' + (h.last_status && h.last_status < 400 ? 'OK ' : 'failed ') + esc(ago(h.last_at)) : '') + '</span></div><div class="inline"><button class="btn btn-sm th" data-id="' + esc(h.id) + '">Test</button><button class="btn btn-sm btn-danger dh" data-id="' + esc(h.id) + '">Delete</button></div></li>'; }).join('') + '</ul>' : empty('No webhooks yet.')) + '</div></div>';
    }
    html += '<details class="card guide"><summary><b>Step-by-step: connect each tool</b></summary><div class="gcols">' +
      '<div><h3>Claude (claude.ai or Claude Desktop)</h3><ol><li>Click <b>Connect Claude</b> above and copy the connector address.</li><li>In Claude open <b>Settings → Connectors → Add custom connector</b>.</li><li>Name it <b>Delegance</b>, paste the address, click <b>Add</b>.</li><li>In a chat, turn on the Delegance connector and ask about your pipeline.</li></ol></div>' +
      '<div><h3>Zapier</h3><ol><li>Events out: trigger <b>Webhooks by Zapier → Catch Hook</b>, copy its URL into <b>New webhook</b> here.</li><li>Leads in: action <b>Webhooks by Zapier → POST</b> to a lead-capture link (payload type JSON).</li><li>Anything else: <b>Webhooks → Custom Request</b> to <code>https://delegance.app/api/…</code> with header <code>Authorization: Bearer &lt;key&gt;</code>.</li></ol></div>' +
      '<div><h3>Make</h3><ol><li>Events out: <b>Webhooks → Custom webhook</b>, copy the address into <b>New webhook</b>.</li><li>Leads in / API: <b>HTTP → Make a request</b> to a lead-capture link or the API with your key.</li></ol></div>' +
      '<div><h3>n8n</h3><ol><li>Events out: add a <b>Webhook</b> node (POST), use its production URL in <b>New webhook</b>.</li><li>API: <b>HTTP Request</b> node, Authentication → Generic → Header Auth, name <code>Authorization</code>, value <code>Bearer &lt;key&gt;</code>.</li></ol></div>' +
      '<div><h3>GoHighLevel</h3><ol><li>Leads from GHL: in a GHL workflow add <b>Webhook</b> action → paste a lead-capture link.</li><li>Delegance → GHL: create an <b>Inbound Webhook</b> trigger in GHL and paste its URL into <b>New webhook</b>.</li></ol></div>' +
      '<div><h3>API cheat sheet</h3><ol class="mono"><li>GET /api/contacts?q=…</li><li>POST /api/contacts</li><li>GET /api/deals · POST /api/deals</li><li>PATCH /api/deals/&lt;id&gt; {"stage":"won"}</li><li>POST /api/activities · POST /api/tasks</li><li>GET /api/reports?days=90</li></ol></div>' +
      '</div><p class="fine">Webhooks are signed: check the <code>X-Delegance-Signature</code> header (HMAC-SHA256 of the body with your signing secret).</p></details>';
    setTimeout(function () {
      var makeKey = function (title, scopeDefault, forClaude) {
        modal('<h2>' + esc(title) + '</h2><label class="fld"><span>Name</span><input name="name" value="' + (forClaude ? 'Claude' : '') + '" maxlength="60" required placeholder="e.g. Zapier"></label><label class="fld"><span>Access</span><select name="scope">' + opts([['write', 'Read and write'], ['read', 'Read only']], scopeDefault) + '</select><small>The key acts as you (' + esc(ROLE_NAME[ROLE]) + '). Revoke it any time.</small></label>', async function (f) {
          var r = await api('apikeys', 'POST', f);
          dlg.innerHTML = '<h2>' + (forClaude ? 'Your Claude connector' : 'Your new API key') + '</h2><p class="lead">Copy it now: we only show it once and store it scrambled.</p>' + (forClaude ? '<label class="fld"><span>Connector address (paste into Claude → Settings → Connectors → Add custom connector)</span><div class="copy"><input readonly value="' + esc(r.mcp_url) + '"><button class="btn btn-acc" data-cp="' + esc(r.mcp_url) + '">Copy</button></div></label><label class="fld"><span>Claude Desktop / Claude Code config (optional)</span><textarea readonly style="min-height:120px;font:12px ui-monospace,Menlo,monospace">' + esc(JSON.stringify({ mcpServers: { delegance: { type: 'http', url: 'https://delegance.app/api/mcp', headers: { Authorization: 'Bearer ' + r.key } } } }, null, 2)) + '</textarea></label>' : '<div class="copy"><input readonly value="' + esc(r.key) + '"><button class="btn btn-acc" data-cp="' + esc(r.key) + '">Copy</button></div><p class="fine">Use it as <code>Authorization: Bearer ' + esc(r.key.slice(0, 10)) + '…</code></p>') + '<div class="acts"><button class="btn" id="cl">Done</button></div>';
          dlg.querySelectorAll('[data-cp]').forEach(function (b) { b.onclick = function () { navigator.clipboard.writeText(b.dataset.cp).then(function () { toast('Copied.'); }); }; });
          dlg.querySelector('#cl').onclick = function () { dlg.close(); route(); };
          return true;
        });
      };
      document.getElementById('mcpKey').onclick = function () { makeKey('Connect Claude', 'write', true); };
      document.getElementById('newKey').onclick = function () { makeKey('New API key', 'write', false); };
      document.querySelectorAll('.rk').forEach(function (b) { b.onclick = async function () { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Click again'; return; } await api('apikeys/' + b.dataset.id, 'DELETE'); toast('Key revoked.'); route(); }; });
      var nl = document.getElementById('newLead'); if (nl) nl.onclick = function () { modal('<h2>New lead-capture link</h2><label class="fld"><span>Name</span><input name="name" required maxlength="60" placeholder="Facebook Lead Ads"></label><label class="fld"><span>Lead source shown in the CRM</span><input name="source" maxlength="60" placeholder="Facebook"></label><label class="chk"><input type="checkbox" name="make_deal" checked> <span>Also create a deal for each new lead</span></label>', async function (f) { f.make_deal = !!f.make_deal; var r = await api('leadhooks', 'POST', f); showLink('Lead-capture link ready', r.url, 'POST JSON or form fields: name (or first_name + last_name), email, phone, company, message, tags, value. We only show this link once.'); setTimeout(route, 50); return true; }); };
      document.querySelectorAll('.rl').forEach(function (b) { b.onclick = async function () { await api('leadhooks/' + b.dataset.id, 'DELETE'); route(); }; });
      var nh = document.getElementById('newHook'); if (nh) nh.onclick = function () { modal('<h2>New webhook</h2><label class="fld"><span>Name</span><input name="name" maxlength="80" placeholder="Zapier: new leads to Google Sheets"></label><label class="fld"><span>Webhook address</span><input name="url" required placeholder="https://hooks.zapier.com/hooks/catch/…"></label><div class="fld"><span>Send these events</span><div class="evs">' + Object.keys(hooks.events).map(function (k) { return '<label class="chk" style="margin:0"><input type="checkbox" name="ev" value="' + esc(k) + '"> <span>' + esc(hooks.events[k]) + '</span></label>'; }).join('') + '</div><small>Leave all unticked to send every event.</small></div>', async function (f, form) { var evs = [].slice.call(form.querySelectorAll('[name=ev]:checked')).map(function (x) { return x.value; }); var r = await api('webhooks', 'POST', { name: f.name, url: f.url, events: evs }); showLink('Webhook added', r.secret, 'Signing secret (optional to use): we put an HMAC-SHA256 signature of each body in the X-Delegance-Signature header.'); setTimeout(route, 50); return true; }); };
      document.querySelectorAll('.th').forEach(function (b) { b.onclick = async function () { try { var r = await api('webhooks/' + b.dataset.id + '/test', 'POST', {}); toast(r.ok ? 'Delivered (' + r.status + ').' : 'Failed: ' + r.status, !r.ok); route(); } catch (x) { toast(x.message, true); } }; });
      document.querySelectorAll('.dh').forEach(function (b) { b.onclick = async function () { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Click again'; return; } await api('webhooks/' + b.dataset.id, 'DELETE'); route(); }; });
    });
    return html;
  };

  // ---------- v4: Social (posts, comments, auto-replies) ----------
  var NET = { facebook: 'FB', instagram: 'IG', linkedin: 'IN', tiktok: 'TT', youtube: 'YT' };
  var net = function (n) { return '<span class="net ' + esc(n) + '" title="' + esc(n) + '">' + esc(NET[n] || n) + '</span>'; };
  V.social = async function () {
    var d = await api('social'), tab = sessionStorage.getItem('stab') || 'posts';
    var A = Object.fromEntries(d.accounts.map(function (a) { return [a.id, a]; }));
    var unread = d.comments.filter(function (c) { return c.unread; }).length;
    var html = top('Social', d.accounts.length + ' connected accounts · comments sync every 15 minutes' + (d.last_comment_sync ? ' (last ' + ago(d.last_comment_sync) + ')' : ''), '<button class="btn btn-acc" id="newPost">New post</button>');
    if (!d.bridge) html += '<div class="card" style="margin-bottom:16px;border-color:rgba(226,194,122,.4)"><b>Posting from here is being switched on.</b><p class="sub">You can see everything now; posting and replying start working as soon as the link to Desk is live.</p></div>';
    html += '<div class="seg" style="max-width:560px">' + [['posts', 'Posts'], ['comments', 'Comments' + (unread ? ' (' + unread + ')' : '')], ['auto', 'Auto-replies'], ['accounts', 'Accounts']].map(function (s) { return '<button data-t="' + s[0] + '" aria-selected="' + (s[0] === tab) + '">' + esc(s[1]) + '</button>'; }).join('') + '</div>';
    if (tab === 'posts') {
      var label = { scheduled: 'Scheduled', review: 'Waiting for approval', publishing: 'Posting…', failed: 'Failed', partial: 'Partly posted', draft: 'Draft', published: 'Posted' };
      html += d.posts.length ? '<div class="grid">' + d.posts.map(function (p) {
        var when = p.status === 'published' ? 'Posted ' + ago(p.published_at) : p.scheduled_at ? new Date(p.scheduled_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Not scheduled';
        return '<div class="card"><div class="fhead" style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div>' + pill(p.status === 'published' ? 'won' : p.status === 'failed' ? 'lost' : p.status === 'review' ? 'pending' : 'call', label[p.status] || p.status) + ' <span class="sub" style="display:inline">' + esc(when) + '</span></div><div class="inline">' + p.targets.map(function (t) { var a = A[t.account_id] || {}; return t.permalink ? '<a href="' + esc(t.permalink) + '" target="_blank" rel="noopener" title="' + esc(a.name || '') + '">' + net(a.network) + '</a>' : '<span title="' + esc((a.name || '') + (t.error ? ': ' + t.error : '')) + '">' + net(a.network) + '</span>'; }).join('') + '</div></div>' + (p.media ? '<img src="' + esc(p.media) + '" alt="" style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin:10px 0">' : '') + '<p style="white-space:pre-wrap;margin:8px 0 0">' + esc(String(p.body || '').slice(0, 400)) + '</p>' + (p.review_note ? '<p class="fine">Note: ' + esc(p.review_note) + '</p>' : '') + (p.targets.some(function (t) { return t.error; }) ? '<p class="err" style="margin-top:8px">' + esc(p.targets.filter(function (t) { return t.error; }).map(function (t) { return (A[t.account_id] || {}).name + ': ' + t.error; }).join(' · ')) + '</p>' : '') + '</div>';
      }).join('') + '</div><p class="fine" style="margin-top:12px">Edit, reschedule or retry posts in <a href="https://desk.delegance.app/#/calendar" target="_blank" rel="noopener">Delegance Desk</a>.</p>' : '<div class="card">' + empty('No posts yet. Click New post to write one.') + '</div>';
    } else if (tab === 'comments') {
      html += d.comments.length ? '<div class="card"><ul class="list">' + d.comments.map(function (c) { var a = A[c.account_id] || {}; return '<li class="click" data-c="' + esc(c.id) + '" style="cursor:pointer">' + net(c.channel) + '<div class="t"><b>' + esc(c.contact_name || 'Someone') + (c.unread ? ' <span class="pill gold">New</span>' : '') + '</b><span>' + esc(c.last_preview || '') + '</span><span>' + esc((a.name || '') + ' · ' + ago(c.last_message_at)) + '</span></div></li>'; }).join('') + '</ul></div>' : '<div class="card">' + empty('No comments yet. New comments on your Facebook, Instagram and YouTube posts show up here.') + '</div>';
    } else if (tab === 'auto') {
      html += '<div class="card" style="margin-bottom:16px"><h2>Comment auto-replies <button class="btn btn-sm" id="newRule">New rule</button></h2><p class="sub" style="margin:-6px 0 12px">When someone comments on your Facebook, Instagram or YouTube posts, Delegance replies for you. Keyword rules win over catch-all rules. Only new comments get a reply, once, and never comments you already answered. Facebook, Instagram and YouTube allow this; LinkedIn and TikTok do not let apps reply yet.</p>' + (d.rules.length ? '<ul class="list">' + d.rules.map(function (r) { return '<li><div class="t"><b>' + esc(r.name) + '</b><span>' + (r.keywords.length ? 'When a comment mentions: ' + esc(r.keywords.join(', ')) : 'Every new comment') + ' · on ' + esc(r.account_ids.map(function (id) { return (A[id] || {}).name || 'an account'; }).join(', ')) + '</span><span>' + r.runs + ' replies sent' + (r.last_run ? ' · last ' + esc(ago(r.last_run)) : '') + '</span></div><div class="inline">' + (r.mine ? '<label class="switch" title="On / off"><input type="checkbox" class="ron" data-id="' + esc(r.id) + '"' + (r.active ? ' checked' : '') + ' aria-label="Rule on"><i></i></label><button class="btn btn-sm redit" data-id="' + esc(r.id) + '">Edit</button>' : '<span class="sub">Shared</span>') + '</div></li>'; }).join('') + '</ul>' : empty('No rules yet. Try one: reply "Thanks {{first_name}}! We sent you a message" to every comment that says "info".')) + '</div>';
    } else {
      html += d.accounts.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Account</th><th class="hide-sm">Client</th><th>Who sees it</th></tr></thead><tbody>' + d.accounts.map(function (a) { return '<tr><td><div class="acct">' + net(a.network) + '<div><b>' + esc(a.name) + '</b>' + (a.status !== 'ok' ? '<span class="sub" style="color:#fca5a5">' + esc(a.status_note || 'Needs reconnecting in Desk') + '</span>' : '') + '<span class="sub">' + (a.mine ? 'Connected by you' : 'Connected by ' + esc(a.connected_by || 'the team')) + '</span></div></div></td><td class="hide-sm">' + (ADMIN ? '<input class="aclient" data-id="' + esc(a.id) + '" value="' + esc(a.client || '') + '" placeholder="e.g. REALM" maxlength="60" style="max-width:180px">' : esc(a.client || '—')) + '</td><td>' + (a.mine || SUPER ? '<select class="apriv" data-id="' + esc(a.id) + '" style="width:auto">' + opts([['0', 'Whole team'], ['1', 'Only me']], a.private ? '1' : '0') + '</select>' : esc(a.private ? 'Only its owner' : 'Whole team')) + '</td></tr>'; }).join('') + '</tbody></table></div><p class="fine" style="margin-top:12px">Connect or reconnect pages in <a href="https://desk.delegance.app/#/accounts" target="_blank" rel="noopener">Delegance Desk → Accounts</a>. "Only me" hides the page, its posts and comments from everyone else in this dashboard.</p>' : '<div class="card">' + empty('No accounts yet. Connect your pages in Delegance Desk → Accounts.') + '</div>';
    }
    setTimeout(function () {
      document.querySelectorAll('.seg button[data-t]').forEach(function (b) { b.onclick = function () { sessionStorage.setItem('stab', b.dataset.t); route(); }; });
      document.getElementById('newPost').onclick = function () { newPost(d); };
      document.querySelectorAll('[data-c]').forEach(function (li) { li.onclick = function () { openComment(li.dataset.c); }; });
      var nr = document.getElementById('newRule'); if (nr) nr.onclick = function () { editRule(d, null); };
      document.querySelectorAll('.redit').forEach(function (b) { b.onclick = function () { editRule(d, d.rules.find(function (r) { return r.id === b.dataset.id; })); }; });
      document.querySelectorAll('.ron').forEach(function (c) { c.onchange = async function () { try { await api('social/autoreplies/' + c.dataset.id, 'PATCH', { active: c.checked }); toast(c.checked ? 'Rule on.' : 'Rule paused.'); } catch (x) { toast(x.message, true); } }; });
      document.querySelectorAll('.apriv').forEach(function (s) { s.onchange = async function () { try { await api('social/accounts/' + s.dataset.id, 'PATCH', { private: s.value === '1' }); toast(s.value === '1' ? 'Now only you see this account.' : 'Shared with the team.'); } catch (x) { toast(x.message, true); route(); } }; });
      document.querySelectorAll('.aclient').forEach(function (i) { i.onchange = async function () { try { await api('social/accounts/' + i.dataset.id, 'PATCH', { client: i.value }); toast('Client label saved.'); } catch (x) { toast(x.message, true); } }; });
    });
    return html;
  };
  function accountPicks(d, chosen) {
    var byClient = {};
    d.accounts.filter(function (a) { return a.status === 'ok'; }).forEach(function (a) { (byClient[a.client || ''] = byClient[a.client || ''] || []).push(a); });
    return Object.keys(byClient).sort().map(function (k) { return (k ? '<p class="fine" style="margin:8px 0 4px">' + esc(k) + '</p>' : '') + '<div class="picks">' + byClient[k].map(function (a) { return '<label><input type="checkbox" name="acc" value="' + esc(a.id) + '"' + (chosen.indexOf(a.id) >= 0 ? ' checked' : '') + '> ' + net(a.network) + ' ' + esc(a.name) + '</label>'; }).join('') + '</div>'; }).join('');
  }
  function newPost(d) {
    var soon = new Date(Date.now() + 3600000); soon.setMinutes(0, 0, 0);
    var local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    modal('<h2>New post</h2><label class="fld"><span>Post</span><textarea name="body" maxlength="5000" style="min-height:140px" placeholder="What do you want to share?"></textarea><small>Desk adapts it for each network (length, hashtags, links) when it posts.</small></label><label class="fld"><span>Link (optional)</span><input name="link_url" placeholder="https://delegance.app/book"></label><div class="fld"><span>Photo (needed for Instagram and TikTok)</span>' + (d.media.length ? '<div class="mlib"><label><input type="radio" name="media_id" value="" checked><img alt="No photo" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 1 1%27%3E%3Crect width=%271%27 height=%271%27 fill=%27%23222%27/%3E%3C/svg%3E"></label>' + d.media.map(function (m) { return '<label><input type="radio" name="media_id" value="' + esc(m.id) + '"><img src="' + esc(m.url) + '" alt="' + esc(m.name || 'Photo') + '" loading="lazy"></label>'; }).join('') + '</div>' : '') + '<small>Upload new photos or videos in <a href="https://desk.delegance.app/#/compose" target="_blank" rel="noopener">Desk → Compose</a>; they appear here.</small></div><div class="fld"><span>Post to</span>' + accountPicks(d, []) + '</div><div class="row2"><label class="fld"><span>When</span><select name="when">' + opts([['schedule', 'Schedule'], ['now', 'Post now'], ['draft', 'Save as draft']], 'schedule') + '</select></label><label class="fld"><span>Date and time</span><input type="datetime-local" name="at" value="' + local + '"></label></div><label class="fld"><span>First comment (optional)</span><input name="first_comment" maxlength="500" placeholder="Book a free call: https://delegance.app/book"></label>' + (ADMIN ? '' : '<p class="fine">Your posts go to an admin for approval before they publish.</p>'), async function (f, form) {
      var acc = [].slice.call(form.querySelectorAll('[name=acc]:checked')).map(function (x) { return x.value; });
      if (f.when !== 'draft' && !acc.length) throw new Error('Tick at least one account.');
      var r = await api('social/posts', 'POST', { body: f.body, link_url: f.link_url, media_id: f.media_id || null, first_comment: f.first_comment, account_ids: acc, publish_now: f.when === 'now', scheduled_at: f.when === 'schedule' && f.at ? new Date(f.at).toISOString() : null });
      toast(r.status === 'review' ? 'Sent for approval.' : f.when === 'now' ? 'Posting now. Check back in a minute.' : f.when === 'draft' ? 'Draft saved.' : 'Scheduled.');
      sessionStorage.setItem('stab', 'posts'); route();
    });
    document.getElementById('dlgOk').textContent = 'Save post';
  }
  async function openComment(id) {
    var d = await api('social/comments/' + encodeURIComponent(id)), c = d.conversation;
    modal('<h2>' + esc(c.contact_name || 'Comment') + ' ' + net(c.channel) + '</h2>' + (c.subject ? '<p class="fine">On: ' + esc(c.subject) + (c.permalink ? ' · <a href="' + esc(c.permalink) + '" target="_blank" rel="noopener">Open post</a>' : '') + '</p>' : '') + '<div class="thread">' + d.messages.map(function (m) { return '<div class="b ' + (m.direction === 'out' ? 'out' : '') + '">' + esc(m.body) + '<small>' + esc((m.direction === 'out' ? (m.is_ai ? 'Auto-reply' : (m.author || 'You')) : (m.author || 'Them')) + ' · ' + ago(m.created_at)) + '</small></div>'; }).join('') + '</div><label class="fld"><span>Reply publicly</span><textarea name="body" required maxlength="4000" placeholder="Thanks for your comment!"></textarea></label>', async function (f) { await api('social/comments/' + c.id + '/reply', 'POST', { body: f.body }); toast('Reply posted.'); route(); });
    document.getElementById('dlgOk').textContent = 'Post reply';
  }
  function editRule(d, r) {
    modal('<h2>' + (r ? 'Edit auto-reply' : 'New auto-reply') + '</h2><label class="fld"><span>Name</span><input name="name" required maxlength="80" value="' + esc(r ? r.name : '') + '" placeholder="Price questions"></label><label class="fld"><span>Only when a comment mentions (optional)</span><input name="keywords" value="' + esc(r ? r.keywords.join(', ') : '') + '" placeholder="price, how much, info"><small>Separate with commas. Leave empty to reply to every new comment.</small></label><label class="fld"><span>Reply</span><textarea name="replies" required maxlength="3000" style="min-height:110px" placeholder="Thanks {{first_name}}! We just sent you the details.">' + esc(r ? r.replies.join('\n---\n') : '') + '</textarea><small>Use {{first_name}}. Want variety? Write several replies separated by a line with --- and Delegance picks one at random, so it never looks like a bot.</small></label><div class="fld"><span>Reply on</span>' + accountPicks({ accounts: d.accounts.filter(function (a) { return ['facebook', 'instagram', 'youtube'].indexOf(a.network) >= 0; }) }, r ? r.account_ids : []) + '</div>' + (r ? '<p><button type="button" class="btn btn-sm btn-danger" id="rDel">Delete rule</button></p>' : ''), async function (f, form) {
      var acc = [].slice.call(form.querySelectorAll('[name=acc]:checked')).map(function (x) { return x.value; });
      if (!acc.length) throw new Error('Tick at least one account.');
      var b = { name: f.name, keywords: f.keywords, replies: f.replies, account_ids: acc };
      if (r) await api('social/autoreplies/' + r.id, 'PATCH', b); else await api('social/autoreplies', 'POST', b);
      toast(r ? 'Rule saved.' : 'Rule on. New comments get a reply within 15 minutes.'); route();
    });
    var del = document.getElementById('rDel'); if (del) del.onclick = async function () { if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Click again to delete'; return; } await api('social/autoreplies/' + r.id, 'DELETE'); dlg.close(); route(); };
  }

  // ---------- v4: LinkedIn outreach queue ----------
  var OUTREACH_MSG = 'Hi {{first_name}}, thanks for connecting! I run Delegance: we give busy founders trained virtual assistants for admin, inbox, social and support. If extra hands at {{company}} would help, I would be glad to share how it works. No pressure at all. {{my_name}}';
  V.outreach = async function () {
    var d = await api('outreach'), q = d.items.filter(function (o) { return o.status === 'queued'; }), done = d.items.filter(function (o) { return o.status !== 'queued'; });
    var html = top('LinkedIn outreach', q.length + ' messages ready · ' + done.filter(function (o) { return o.status === 'sent' || o.status === 'replied'; }).length + ' sent in the last 30 days', '<a class="btn btn-acc" href="#contacts">Add people</a>');
    html += '<div class="card" style="margin-bottom:16px"><p class="sub" style="margin:0">Delegance writes a personal message for each person. Click <b>Copy and open LinkedIn</b>, paste it into the chat, send, then come back and it is marked as sent and logged on the contact. LinkedIn does not allow apps to send messages, so this keeps your account safe. To add people: Contacts → tick them → <b>Add to LinkedIn queue</b>.</p></div>';
    html += q.length ? '<div class="grid">' + q.map(function (o) { var link = o.linkedin || 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent([o.name, o.company].filter(Boolean).join(' ')); return '<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><a href="#contact/' + esc(o.contact_id) + '"><b>' + esc(o.name) + '</b></a><span class="sub">' + esc(o.company || '') + (o.linkedin ? '' : ' · no LinkedIn link yet, we will search for them') + '</span></div><button class="btn btn-sm oskip" data-id="' + esc(o.id) + '">Skip</button></div><p class="oq">' + esc(o.message) + '</p><div class="inline" style="margin-top:10px;flex-wrap:wrap"><button class="btn btn-sm btn-acc osend" data-id="' + esc(o.id) + '" data-link="' + esc(link) + '">Copy and open LinkedIn</button><button class="btn btn-sm odone" data-id="' + esc(o.id) + '">Mark as sent</button></div></div>'; }).join('') + '</div>' : '<div class="card">' + empty('Your queue is empty. Go to Contacts, tick the people to reach, and choose Add to LinkedIn queue.') + '</div>';
    if (done.length) html += '<div class="card" style="margin-top:16px"><h2>Recent</h2><ul class="list">' + done.map(function (o) { return '<li><div class="t"><b>' + esc(o.name) + '</b><span>' + esc(o.company || '') + '</span></div>' + (o.status === 'sent' ? '<button class="btn btn-sm oreplied" data-id="' + esc(o.id) + '">They replied</button>' : '') + pill(o.status === 'replied' ? 'won' : o.status === 'sent' ? 'done' : 'closed', { sent: 'Sent', replied: 'Replied', skipped: 'Skipped' }[o.status]) + '</li>'; }).join('') + '</ul></div>';
    setTimeout(function () {
      var set = async function (id, st, msg) { try { await api('outreach/' + id, 'PATCH', { status: st }); toast(msg); route(); } catch (x) { toast(x.message, true); } };
      document.querySelectorAll('.osend').forEach(function (b) { b.onclick = function () { var o = q.find(function (x) { return x.id === b.dataset.id; }); var go = function () { window.open(b.dataset.link, '_blank', 'noopener'); b.textContent = 'Copied. Sent it?'; b.classList.remove('osend'); b.onclick = function () { set(o.id, 'sent', 'Marked as sent and logged.'); }; }; (navigator.clipboard ? navigator.clipboard.writeText(o.message) : Promise.reject()).then(go, go); }; });
      document.querySelectorAll('.odone').forEach(function (b) { b.onclick = function () { set(b.dataset.id, 'sent', 'Marked as sent and logged.'); }; });
      document.querySelectorAll('.oskip').forEach(function (b) { b.onclick = function () { set(b.dataset.id, 'skipped', 'Skipped.'); }; });
      document.querySelectorAll('.oreplied').forEach(function (b) { b.onclick = function () { set(b.dataset.id, 'replied', 'Nice! Logged on the contact.'); }; });
    });
    return html;
  };
  function queueOutreach(ids) {
    modal('<h2>Add ' + ids.length + ' to your LinkedIn queue</h2><label class="fld"><span>Message</span><textarea name="message" required maxlength="1900" style="min-height:150px">' + esc(OUTREACH_MSG) + '</textarea><small>Merge fields: {{first_name}}, {{name}}, {{company}}, {{my_name}}. Keep it short and personal: greeting, why you are reaching out, a soft question.</small></label>', async function (f) { var r = await api('outreach', 'POST', { contact_ids: ids, message: f.message }); toast(r.added + ' added to your queue.'); location.hash = '#outreach'; });
    document.getElementById('dlgOk').textContent = 'Add to queue';
  }

  // ---------- v4: Contracts (unlock contact details) ----------
  V.contracts = async function () {
    var d = await api('contracts');
    var html = top('Agreements', 'Client and VA sign online. Contact details unlock for both only when both have signed.', '<button class="btn btn-acc" id="newK">New agreement</button>');
    html += d.items.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Agreement</th><th class="hide-sm">Client</th><th class="hide-sm">VA</th><th>Status</th><th></th></tr></thead><tbody>' + d.items.map(function (k) { return '<tr><td><b>' + esc(k.title) + '</b><span class="sub">' + esc([k.rate, k.hours, k.start_date ? 'Starts ' + day(k.start_date) : ''].filter(Boolean).join(' · ')) + '</span></td><td class="hide-sm">' + esc(k.client_name) + (k.client_company ? '<span class="sub">' + esc(k.client_company) + '</span>' : '') + '<span class="sig">' + (k.client_signed_at ? '<b>Signed</b> ' + esc(day(k.client_signed_at)) : 'Not signed yet') + '</span></td><td class="hide-sm">' + esc(k.va_name) + '<span class="sig">' + (k.va_signed_at ? '<b>Signed</b> ' + esc(day(k.va_signed_at)) : 'Not signed yet') + '</span></td><td>' + pill(k.status === 'active' ? 'won' : k.status === 'ended' ? 'closed' : 'pending', { active: 'Active', ended: 'Ended', sent: 'Waiting for signatures' }[k.status]) + '</td><td>' + (k.status !== 'ended' ? '<button class="btn btn-sm kend" data-id="' + esc(k.id) + '">End</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="card">' + empty('No agreements yet. When a client wants to hire a VA, create one here: both get a link to sign.') + '</div>';
    setTimeout(function () {
      document.getElementById('newK').onclick = function () {
        if (!d.candidates.length) return toast('There are no VA profiles live yet.', true);
        modal('<h2>New agreement</h2><div class="row2"><label class="fld"><span>Virtual assistant</span><select name="candidate_id" required>' + opts(d.candidates.map(function (c) { return [c.id, c.name + (c.headline ? ' · ' + c.headline : '')]; }), '', 'Pick a VA') + '</select></label><label class="fld"><span>From this chat (optional)</span><select name="conversation_id" id="kChat">' + opts(d.chats.map(function (c) { return [c.id, (c.channel === 'hire' ? 'Hire request: ' : 'Chat: ') + (c.contact_name || '') + ' · ' + ago(c.last_message_at)]; }), '', 'None') + '</select></label></div><div class="row2"><label class="fld"><span>Client name</span><input name="client_name" id="kName" required maxlength="100"></label><label class="fld"><span>Client email</span><input name="client_email" id="kEmail" type="email" required></label></div><div class="row2"><label class="fld"><span>Client company</span><input name="client_company" maxlength="120"></label><label class="fld"><span>Client phone (optional)</span><input name="client_phone" maxlength="40"></label></div><label class="fld"><span>Role</span><input name="title" required maxlength="120" placeholder="Executive assistant, 20 hrs/week"></label><div class="row2"><label class="fld"><span>Rate</span><input name="rate" maxlength="60" placeholder="US$8/hour"></label><label class="fld"><span>Hours</span><input name="hours" maxlength="60" placeholder="20 hrs/week, Mon–Fri"></label></div><label class="fld"><span>Start date</span><input type="date" name="start_date"></label><label class="fld"><span>Terms</span><textarea name="terms" style="min-height:170px">' + esc(d.terms) + '</textarea><small>Plain-language starter terms. Have a lawyer check them before relying on them.</small></label>', async function (f) {
          var r = await api('contracts', 'POST', f);
          dlg.innerHTML = '<h2>Agreement sent</h2><p class="lead">' + (r.emailed_client ? 'We emailed the client their signing link. ' : 'We could not email the client; send them their link below. ') + (r.emailed_va ? 'We emailed the VA too.' : 'We could not email the VA; send them their link below.') + '</p><label class="fld"><span>Client link</span><div class="copy"><input readonly value="' + esc(r.client_link) + '"><button class="btn btn-acc" data-cp="' + esc(r.client_link) + '">Copy</button></div></label><label class="fld"><span>VA link</span><div class="copy"><input readonly value="' + esc(r.va_link) + '"><button class="btn btn-acc" data-cp="' + esc(r.va_link) + '">Copy</button></div></label><div class="acts"><button class="btn" id="cl">Done</button></div>';
          dlg.querySelectorAll('[data-cp]').forEach(function (b) { b.onclick = function () { navigator.clipboard.writeText(b.dataset.cp).then(function () { toast('Copied.'); }); }; });
          dlg.querySelector('#cl').onclick = function () { dlg.close(); route(); };
          return true;
        });
        dlg.classList.add('wide'); dlg.addEventListener('close', function () { dlg.classList.remove('wide'); }, { once: true });
        document.getElementById('kChat').onchange = function (e) { var c = d.chats.find(function (x) { return x.id === e.target.value; }); if (!c) return; var n = document.getElementById('kName'), m = document.getElementById('kEmail'); if (!n.value) n.value = String(c.contact_name || '').split(' · ')[0]; if (!m.value) m.value = c.contact_email || ''; };
        document.getElementById('dlgOk').textContent = 'Send for signing';
      };
      document.querySelectorAll('.kend').forEach(function (b) { b.onclick = async function () { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Click again'; return; } await api('contracts/' + b.dataset.id + '/cancel', 'POST', {}); toast('Agreement ended.'); route(); }; });
    });
    return html;
  };

  // ---------- v4: avatars, profile, chat, updates, roadmap ----------
  var ACCENT = { gold: ['Gold', '#e2c27a'], silver: ['Silver', '#d6d8de'], sapphire: ['Sapphire', '#7aa7ff'], emerald: ['Emerald', '#5fd3a0'], rose: ['Rose', '#f0a3b8'], violet: ['Violet', '#b79cff'] };
  function avatar(u, size) {
    var s = size || 36, st = 'width:' + s + 'px;height:' + s + 'px;min-width:' + s + 'px;font-size:' + Math.round(s * 0.38) + 'px' + (u && u.accent && ACCENT[u.accent] ? ';background:' + ACCENT[u.accent][1] : '');
    return u && u.avatar ? '<img class="av img" src="' + esc(u.avatar) + '" alt="" style="' + st + '">' : '<span class="av" style="' + st + '">' + initials(u && u.name) + '</span>';
  }
  function applyAccent() { var a = ME && ME.accent && ACCENT[ME.accent], b = document.body.style; if (a && document.documentElement.dataset.theme !== 'light') { b.setProperty('--acc', a[1]); b.setProperty('--accbg', a[1] + '1f'); } else { b.removeProperty('--acc'); b.removeProperty('--accbg'); } }
  function shrinkPhoto(file) {
    return new Promise(function (ok, no) {
      if (!/^image\//.test(file.type)) return no(new Error('Pick a photo (JPG, PNG or WebP).'));
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () { var s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 320; c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 320, 320); URL.revokeObjectURL(url); var d = c.toDataURL('image/webp', 0.85); if (d.indexOf('data:image/webp') !== 0) d = c.toDataURL('image/jpeg', 0.85); ok(d); };
      img.onerror = function () { no(new Error('That photo could not be read. Try another one.')); };
      img.src = url;
    });
  }
  V.profile = async function () {
    var u = ME, draft = { avatar: u.avatar || null, accent: u.accent || 'gold' };
    var html = top('My profile', 'How you appear to your team, VAs and clients across Delegance');
    html += '<div class="split"><div><form class="card" id="pf"><div class="pfhead"><div id="pfAv">' + avatar(u, 96) + '</div><div class="inline" style="flex-wrap:wrap"><label class="btn btn-sm" style="cursor:pointer">Upload photo<input type="file" id="pfFile" accept="image/*" hidden></label><button type="button" class="btn btn-sm" id="pfRm"' + (u.avatar ? '' : ' hidden') + '>Remove photo</button></div></div>' +
      '<div class="row2"><label class="fld"><span>Name</span><input name="name" required maxlength="80" value="' + esc(u.name) + '"></label><label class="fld"><span>Job title</span><input name="title" maxlength="80" value="' + esc(u.title || '') + '" placeholder="Founder"></label></div>' +
      '<label class="fld"><span>About you</span><textarea name="bio" maxlength="400" placeholder="A line or two your team and clients will see.">' + esc(u.bio || '') + '</textarea></label>' +
      '<div class="row2"><label class="fld"><span>Phone (shown to your team only)</span><input name="phone" maxlength="40" value="' + esc(u.phone || '') + '"></label><label class="fld"><span>Location</span><input name="location" maxlength="80" value="' + esc(u.location || '') + '" placeholder="Manila, Philippines"></label></div>' +
      '<div class="fld"><span>Your accent color</span><div class="swatches">' + Object.keys(ACCENT).map(function (k) { return '<label title="' + ACCENT[k][0] + '"><input type="radio" name="accent" value="' + k + '"' + (draft.accent === k ? ' checked' : '') + '><i style="background:' + ACCENT[k][1] + '"></i><span>' + ACCENT[k][0] + '</span></label>'; }).join('') + '</div><small>Used for your buttons, highlights and your avatar ring.</small></div>' +
      '<div class="inline" style="justify-content:flex-end"><button class="btn btn-acc">Save profile</button></div></form></div>';
    html += '<div><div class="card pfcard"><span class="eyebrow">Preview</span><div id="pfPrev"></div></div><div class="card" style="margin-top:16px"><h2>Account</h2><p class="sub">Password, 2-step sign-in, devices and email settings.</p><a class="btn btn-sm" href="#account" style="margin-top:10px">Open account settings</a></div></div></div>';
    setTimeout(function () {
      var f = document.getElementById('pf');
      var prev = function () { var x = Object.fromEntries(new FormData(f)); var p = { name: x.name || u.name, avatar: draft.avatar, accent: x.accent }; document.getElementById('pfAv').innerHTML = avatar(p, 96); document.getElementById('pfPrev').innerHTML = '<div class="pfmini" style="--ring:' + ACCENT[x.accent || 'gold'][1] + '">' + avatar(p, 64) + '<div><b>' + esc(p.name) + '</b><span>' + esc([x.title, ROLE_NAME[ROLE]].filter(Boolean).join(' · ')) + '</span>' + (x.location ? '<span>' + esc(x.location) + '</span>' : '') + '</div></div>' + (x.bio ? '<p class="sub" style="margin-top:12px;white-space:pre-wrap">' + esc(x.bio) + '</p>' : ''); };
      f.addEventListener('input', prev); prev();
      document.getElementById('pfFile').onchange = async function (e) { var file = e.target.files[0]; if (!file) return; try { draft.avatar = await shrinkPhoto(file); document.getElementById('pfRm').hidden = false; prev(); toast('Photo ready. Click Save profile.'); } catch (x) { toast(x.message, true); } };
      document.getElementById('pfRm').onclick = function () { draft.avatar = null; this.hidden = true; prev(); };
      f.onsubmit = async function (e) { e.preventDefault(); var x = Object.fromEntries(new FormData(f)); x.avatar = draft.avatar || ''; var b = f.querySelector('.btn-acc'); b.disabled = true; try { await api('auth/profile', 'POST', x); await boot(); toast('Profile saved.'); route(); } catch (err) { toast(err.message, true); b.disabled = false; } };
    });
    return html;
  };

  var chatTimer = null;
  V.chat = async function (cid) {
    var d = await api('chat'), list = d.channels;
    if (!cid && list.length && window.innerWidth > 760) cid = list[0].id;
    var cur = list.find(function (c) { return c.id === cid; });
    var label = function (c) { return c.kind === 'team' ? '# team' : c.kind === 'client' ? c.name : c.name; };
    var icon = function (c) { return c.kind === 'team' ? '<span class="chico">#</span>' : c.kind === 'client' ? '<span class="chico cl">' + initials(c.name) + '</span>' : c.people && c.people.length === 1 ? avatar(c.people[0], 30) : '<span class="chico gr">' + (c.people ? c.people.length + 1 : '') + '</span>'; };
    var html = top('Chat', 'Your team, your clients and their VAs, in one place', '<button class="btn btn-acc" id="newChat">New message</button>');
    html += '<div class="tchat' + (cur ? ' open' : '') + '"><aside class="chls" aria-label="Conversations">' + (list.length ? list.map(function (c) { return '<a href="#chat/' + esc(c.id) + '" class="chl' + (c.id === cid ? ' on' : '') + '">' + icon(c) + '<div class="t"><b>' + esc(label(c)) + '</b><span>' + esc(c.last ? (c.last.name.split(' ')[0] + ': ' + c.last.body) : c.kind === 'client' ? 'Client group' : 'No messages yet') + '</span></div>' + (c.unread ? '<i class="unread">' + c.unread + '</i>' : '') + '</a>'; }).join('') : '<p class="empty" style="padding:16px">No conversations yet.</p>') + '</aside>';
    html += '<section class="chpane">' + (cur ? '<header class="chhd"><a href="#chat" class="btn btn-sm chback" aria-label="Back to conversations">←</a><div><b>' + esc(label(cur)) + '</b><span class="sub" id="chMem">' + esc(cur.topic || '') + '</span></div>' + (cur.kind === 'dm' || cur.kind === 'group' ? '<button class="btn btn-sm" id="chLeave">Leave</button>' : '') + '</header><div class="chmsgs" id="chMsgs" aria-live="polite"><div class="skel"><i></i><i></i></div></div><form class="chform" id="chF"><textarea id="chIn" rows="1" maxlength="4000" placeholder="Message ' + esc(label(cur)) + '" aria-label="Message"></textarea><button class="btn btn-acc">Send</button></form>' + (cur.kind !== 'dm' ? '<p class="fine" style="padding:0 14px 10px">Type @ and a first name to notify someone' + (TEAM ? ', or @everyone' : '') + '.</p>' : '') : '<div class="chempty"><p class="empty">Pick a conversation, or start a new message.</p></div>') + '</section></div>';
    setTimeout(function () {
      if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
      document.getElementById('newChat').onclick = newChat;
      if (!cur) return;
      var box = document.getElementById('chMsgs'), last = null, me = ME.id;
      var paint = function (msgs, append) {
        if (!append) box.innerHTML = msgs.length ? '' : '<p class="empty" style="margin:auto">Say hello 👋</p>';
        msgs.forEach(function (m) { if (!append && box.querySelector('.empty')) box.innerHTML = ''; var el = document.createElement('div'); el.className = 'cmsg' + (m.mine ? ' mine' : ''); el.innerHTML = avatar(m.from, 32) + '<div class="cb"><div class="cm"><b>' + esc(m.mine ? 'You' : m.from.name) + '</b><span>' + esc(new Date(m.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</span></div><p>' + esc(m.body).replace(/(^|\s)@([\w.-]+)/g, '$1<mark>@$2</mark>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>') + '</p></div>'; box.appendChild(el); last = m.at; });
        box.scrollTop = box.scrollHeight;
      };
      api('chat/' + cid).then(function (r) { paint(r.messages); if (r.members) document.getElementById('chMem').textContent = (cur.topic ? cur.topic + ' · ' : '') + r.members.length + ' people: ' + r.members.slice(0, 6).map(function (u) { return u.name.split(' ')[0]; }).join(', ') + (r.members.length > 6 ? '…' : ''); loadChatBadge(); });
      chatTimer = setInterval(function () { if (location.hash.indexOf('#chat/' + cid) !== 0 && !(location.hash === '#chat' && cid)) { clearInterval(chatTimer); chatTimer = null; return; } if (document.visibilityState !== 'visible' || !last) return; api('chat/' + cid + '?after=' + encodeURIComponent(last)).then(function (r) { if (r.messages.length) paint(r.messages, true); }).catch(function () {}); }, 4000);
      var f = document.getElementById('chF'), inp = document.getElementById('chIn');
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } });
      inp.addEventListener('input', function () { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 160) + 'px'; });
      f.onsubmit = async function (e) { e.preventDefault(); var t = inp.value.trim(); if (!t) return; inp.value = ''; inp.style.height = 'auto'; try { var r = await api('chat/' + cid, 'POST', { body: t }); paint([{ id: r.id, body: t, at: r.at, mine: true, from: ME }], true); } catch (x) { inp.value = t; toast(x.message, true); } };
      inp.focus();
      var lv = document.getElementById('chLeave'); if (lv) lv.onclick = async function () { if (lv.dataset.sure !== '1') { lv.dataset.sure = '1'; lv.textContent = 'Click again to leave'; return; } await api('chat/' + cid + '/leave', 'POST', {}); location.hash = '#chat'; };
    });
    return html;
  };
  async function newChat() {
    var d = await api('people');
    if (!d.items.length) return toast('There is nobody else to message yet.', true);
    modal('<h2>New message</h2><p class="lead">Pick one person for a direct message, or several for a group.</p><input type="search" id="pplQ" placeholder="Search people" aria-label="Search people" style="margin-bottom:10px"><div class="pplist">' + d.items.map(function (u) { return '<label class="ppl" data-n="' + esc(u.name.toLowerCase()) + '"><input type="checkbox" name="u" value="' + esc(u.id) + '">' + avatar(u, 32) + '<span><b>' + esc(u.name) + '</b><small>' + esc([u.title, ROLE_NAME[u.role]].filter(Boolean).join(' · ')) + '</small></span></label>'; }).join('') + '</div><label class="fld" style="margin-top:12px"><span>Group name (optional)</span><input name="name" maxlength="60" placeholder="Launch team"></label>', async function (f, form) {
      var ids = [].slice.call(form.querySelectorAll('[name=u]:checked')).map(function (x) { return x.value; });
      if (!ids.length) throw new Error('Pick at least one person.');
      var r = await api('chat/new', 'POST', { user_ids: ids, name: f.name }); location.hash = '#chat/' + r.id;
    });
    document.getElementById('dlgOk').textContent = 'Start chat';
    document.getElementById('pplQ').oninput = function (e) { var q = e.target.value.toLowerCase(); document.querySelectorAll('.ppl').forEach(function (l) { l.hidden = q && l.dataset.n.indexOf(q) < 0; }); };
  }
  function loadChatBadge() {
    if (!(TEAM || ROLE === 'va' || ROLE === 'client')) return;
    api('chat/unread').then(function (r) { var a = document.querySelector('#nav a[href="#chat"]'); if (!a) return; var b = a.querySelector('.nbadge'); if (!r.unread) { if (b) b.remove(); return; } if (!b) { b = document.createElement('i'); b.className = 'nbadge'; a.appendChild(b); } b.textContent = r.unread > 99 ? '99+' : r.unread; }).catch(function () {});
  }

  V.updates = async function () {
    var d = await api('updates');
    var html = top('What\'s new', 'Every Delegance release, newest first', d.can_edit ? '<button class="btn btn-acc" id="addUp">Add update</button>' : '');
    html += '<ol class="ulog">' + d.items.map(function (u) { return '<li><span class="udot" aria-hidden="true"></span><div class="card"><div class="uhead"><b>' + esc(u.title) + '</b>' + (u.version ? '<span class="pill gold">' + esc(u.version) + '</span>' : '') + '<span class="sub">' + esc(day(u.released_at)) + '</span>' + (d.can_edit ? '<button class="btn btn-sm uedit" data-id="' + esc(u.id) + '" style="margin-left:auto">Edit</button>' : '') + '</div><p class="sub" style="margin-top:6px;white-space:pre-wrap">' + esc(u.body) + '</p></div></li>'; }).join('') + '</ol>';
    setTimeout(function () {
      var edit = function (u) { modal('<h2>' + (u ? 'Edit update' : 'Add update') + '</h2><div class="row2"><label class="fld"><span>Title</span><input name="title" required maxlength="120" value="' + esc(u ? u.title : '') + '"></label><label class="fld"><span>Version (optional)</span><input name="version" maxlength="30" value="' + esc(u ? u.version || '' : '') + '"></label></div><label class="fld"><span>Released</span><input type="date" name="released_at" value="' + esc(u ? u.released_at : today()) + '"></label><label class="fld"><span>What changed</span><textarea name="body" required maxlength="3000" style="min-height:120px">' + esc(u ? u.body : '') + '</textarea></label>' + (u ? '<p><button type="button" class="btn btn-sm btn-danger" id="uDel">Delete</button></p>' : ''), async function (f) { if (u) await api('updates/' + u.id, 'PATCH', f); else await api('updates', 'POST', f); toast('Saved.'); route(); }); var del = document.getElementById('uDel'); if (del) del.onclick = async function () { if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Click again'; return; } await api('updates/' + u.id, 'DELETE'); dlg.close(); route(); }; };
      var a = document.getElementById('addUp'); if (a) a.onclick = function () { edit(null); };
      document.querySelectorAll('.uedit').forEach(function (b) { b.onclick = function () { edit(d.items.find(function (x) { return x.id === b.dataset.id; })); }; });
    });
    return html;
  };
  V.roadmap = async function () {
    var d = await api('roadmap'), cols = [['planned', 'Planned'], ['in_progress', 'In progress'], ['done', 'Done']];
    var html = top('Roadmap', 'What we are building next for Delegance', d.can_edit ? '<button class="btn btn-acc" id="addRm">Add item</button>' : '');
    html += '<div class="rmap">' + cols.map(function (c) { var items = d.items.filter(function (x) { return x.status === c[0]; }); return '<section class="rcol ' + c[0] + '"><h2>' + esc(c[1]) + ' <span class="sub">' + items.length + '</span></h2>' + (items.length ? items.map(function (x) { return '<div class="card ritem"' + (d.can_edit ? ' data-id="' + esc(x.id) + '" tabindex="0" role="button"' : '') + '>' + (x.area ? '<span class="eyebrow">' + esc(x.area) + '</span>' : '') + '<b>' + esc(x.title) + '</b>' + (x.body ? '<p class="sub">' + esc(x.body) + '</p>' : '') + '</div>'; }).join('') : empty('Nothing here yet.')) + '</section>'; }).join('') + '</div>';
    setTimeout(function () {
      var edit = function (x) { modal('<h2>' + (x ? 'Edit roadmap item' : 'Add roadmap item') + '</h2><label class="fld"><span>Title</span><input name="title" required maxlength="120" value="' + esc(x ? x.title : '') + '"></label><label class="fld"><span>Details</span><textarea name="body" maxlength="1000">' + esc(x ? x.body || '' : '') + '</textarea></label><div class="row2"><label class="fld"><span>Status</span><select name="status">' + opts(cols, x ? x.status : 'planned') + '</select></label><label class="fld"><span>Area</span><input name="area" maxlength="40" value="' + esc(x ? x.area || '' : '') + '" placeholder="Social, CRM, App…"></label></div><label class="fld"><span>Order (lower shows first)</span><input type="number" name="sort" value="' + esc(x ? x.sort : 50) + '"></label>' + (x ? '<p><button type="button" class="btn btn-sm btn-danger" id="rmDel">Delete</button></p>' : ''), async function (f) { if (x) await api('roadmap/' + x.id, 'PATCH', f); else await api('roadmap', 'POST', f); toast('Saved.'); route(); }); var del = document.getElementById('rmDel'); if (del) del.onclick = async function () { if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Click again'; return; } await api('roadmap/' + x.id, 'DELETE'); dlg.close(); route(); }; };
      var a = document.getElementById('addRm'); if (a) a.onclick = function () { edit(null); };
      document.querySelectorAll('.ritem[data-id]').forEach(function (el) { var go = function () { edit(d.items.find(function (x) { return x.id === el.dataset.id; })); }; el.onclick = go; el.onkeydown = function (e) { if (e.key === 'Enter') go(); }; });
    });
    return html;
  };

  V.calendar = async function () {
    var d = await api('bookings'), cfg = d.settings, upcoming = d.items.filter(function (b) { return b.status === 'booked' && b.end_at > new Date().toISOString(); });
    var html = top('Calendar', upcoming.length + ' upcoming calls', '<a class="btn" href="/book" target="_blank" rel="noopener">Open booking page</a>' + (ADMIN ? '<button class="btn btn-acc" id="bset">Booking settings</button>' : ''));
    html += '<div class="card" style="margin-bottom:16px"><div class="inline" style="justify-content:space-between;flex-wrap:wrap"><div><b>' + esc(cfg.title) + '</b> · ' + cfg.minutes + ' minutes · ' + (cfg.enabled ? '<span class="goldtxt">Open for booking</span>' : 'Closed') + '<div class="sub">Share <a href="/book" target="_blank" rel="noopener">delegance.app/book</a> anywhere. Bookings create the contact, a deal, a task and a calendar invite.</div></div><button class="btn btn-sm" id="cpBook">Copy link</button></div></div>';
    var groups = {}; upcoming.forEach(function (b) { var k = new Date(b.start_at).toDateString(); (groups[k] = groups[k] || []).push(b); });
    html += Object.keys(groups).length ? Object.keys(groups).map(function (k) { return '<div class="card" style="margin-bottom:12px"><h2>' + esc(new Date(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })) + '</h2><ul class="list">' + groups[k].map(function (b) { return '<li><span class="when">' + esc(new Date(b.start_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + '</span><a class="row" href="#contact/' + esc(b.contact_id) + '"><div class="t"><b>' + esc(b.name) + (b.company ? ' · ' + esc(b.company) : '') + '</b><span>' + esc([b.email, b.host_name ? 'with ' + b.host_name : '', b.notes].filter(Boolean).join(' · ')) + '</span></div></a></li>'; }).join('') + '</ul></div>'; }).join('') : '<div class="card">' + empty('No upcoming calls yet.') + '</div>';
    setTimeout(function () {
      document.getElementById('cpBook').onclick = function () { navigator.clipboard.writeText('https://delegance.app/book').then(function () { toast('Link copied.'); }); };
      var bs = document.getElementById('bset'); if (bs) bs.onclick = function () {
        var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        modal('<h2>Booking settings</h2><label class="chk"><input type="checkbox" name="enabled"' + (cfg.enabled ? ' checked' : '') + '> <span>Booking page is open</span></label><div class="row2"><label class="fld"><span>Call name</span><input name="title" value="' + esc(cfg.title) + '"></label><label class="fld"><span>Length</span><select name="minutes">' + opts([[15, '15 minutes'], [20, '20 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '60 minutes']], cfg.minutes) + '</select></label></div><label class="fld"><span>Short description</span><input name="intro" maxlength="400" value="' + esc(cfg.intro || '') + '"></label><div class="row2"><label class="fld"><span>Your time zone</span><input name="tz" value="' + esc(cfg.tz) + '" placeholder="Asia/Manila"></label><label class="fld"><span>Meeting link (Google Meet, Zoom…)</span><input name="link" value="' + esc(cfg.link || '') + '" placeholder="https://meet.google.com/…"></label></div><div class="fld"><span>Available hours (in your time zone)</span><div class="hrs">' + days.map(function (n, i) { var h = cfg.hours[i] || cfg.hours[String(i)]; return '<label class="hrow"><input type="checkbox" name="d' + i + '"' + (h ? ' checked' : '') + '> <b>' + n + '</b><input type="number" name="s' + i + '" min="0" max="23.5" step="0.5" value="' + (h ? h[0] : 9) + '" aria-label="' + n + ' start"> to <input type="number" name="e' + i + '" min="0.5" max="24" step="0.5" value="' + (h ? h[1] : 17) + '" aria-label="' + n + ' end"></label>'; }).join('') + '</div></div><div class="row2"><label class="fld"><span>Minimum notice (hours)</span><input type="number" name="notice_hours" min="0" value="' + cfg.notice_hours + '"></label><label class="fld"><span>Book up to (days ahead)</span><input type="number" name="days_ahead" min="1" max="60" value="' + cfg.days_ahead + '"></label></div><label class="fld"><span>Break between calls (minutes)</span><input type="number" name="buffer" min="0" max="60" value="' + cfg.buffer + '"></label>', async function (f) {
          var hours = {}; for (var i = 0; i < 7; i++) if (f['d' + i]) hours[i] = [+f['s' + i], +f['e' + i]];
          await api('booking/settings', 'POST', { enabled: !!f.enabled, title: f.title, minutes: +f.minutes, intro: f.intro, tz: f.tz, link: f.link, hours: hours, notice_hours: +f.notice_hours, days_ahead: +f.days_ahead, buffer: +f.buffer }); toast('Booking settings saved.'); route();
        });
      };
    });
    return html;
  };

  // ---------- 2-step sign-in ----------
  function loadQr() { return window.qrcode ? Promise.resolve() : new Promise(function (ok, no) { var sc = document.createElement('script'); sc.src = '/assets/qr.js?v=1'; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); }); }
  async function mfaSetup(box, done) {
    var r = await api('auth/totp/start', 'POST', {});
    var qr = '';
    try { await loadQr(); var q = window.qrcode(0, 'M'); q.addData(r.uri); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) {}
    box.innerHTML = '<ol class="steps"><li>Install a free authenticator app on your phone: <b>Google Authenticator</b>, <b>Microsoft Authenticator</b> or <b>1Password</b>.</li><li>In the app, tap <b>+</b> and scan this QR code.' + (qr ? '<div style="margin-top:12px"><span class="qr">' + qr + '</span></div>' : '') + '<span style="display:block;margin-top:10px;font-size:13px">Can\'t scan? Choose "Enter a setup key" and type:</span><code class="secret">' + esc(r.secret.replace(/(.{4})/g, '$1 ').trim()) + '</code></li><li>Type the 6-digit code the app shows for Delegance:<form id="mfaF" style="margin-top:10px;max-width:280px"><input name="code" class="code-in" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required aria-label="6-digit code"><p class="err" role="alert"></p><button class="btn btn-acc wide">Turn on 2-step sign-in</button></form></li></ol>';
    if (window.DLGMotion) { var o = DLGMotion.otp(box.querySelector('#mfaF [name=code]'), function () { box.querySelector('#mfaF').requestSubmit(); }); box._otp = o; }
    box.querySelector('#mfaF').onsubmit = async function (e) {
      e.preventDefault(); var b = e.target.querySelector('button'), er = e.target.querySelector('.err'); b.disabled = true; er.textContent = '';
      try { var c = await api('auth/totp/confirm', 'POST', { code: e.target.code.value }); showCodes(box, c.recovery, done); } catch (x) { er.textContent = x.message; b.disabled = false; if (box._otp) { box._otp.shake(); box._otp.clear(); } }
    };
  }
  function showCodes(box, codes, done) {
    box.innerHTML = '<h2 style="font-size:18px;margin-bottom:8px">Save your recovery codes</h2><p style="color:var(--muted)">If you lose your phone, each of these codes lets you sign in once. Keep them somewhere safe, like a password manager. You will not see them again.</p><div class="codes">' + codes.map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + '</div><div class="inline" style="flex-wrap:wrap"><button class="btn" id="cpC">Copy</button><button class="btn" id="dlC">Download .txt</button><button class="btn btn-acc" id="okC">I saved them</button></div>';
    var txt = 'Delegance recovery codes for ' + ME.email + '\n\n' + codes.join('\n') + '\n\nEach code works once.';
    box.querySelector('#cpC').onclick = function () { navigator.clipboard.writeText(txt).then(function () { toast('Codes copied.'); }); };
    box.querySelector('#dlC').onclick = function () { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = 'delegance-recovery-codes.txt'; a.click(); };
    box.querySelector('#okC').onclick = done;
  }
  function gate() {
    document.getElementById('nav').innerHTML = '';
    main.innerHTML = '<div class="gate"><div class="hero"><span class="eyebrow">' + esc(SPACES[ROLE][0]) + '</span><h1>One more step, ' + esc(ME.name.split(' ')[0]) + '.</h1><p>Team accounts can see client details, so Delegance asks for a 6-digit code from your phone when you sign in. It takes about a minute to set up.</p></div><div class="card" id="mfaBox"><p class="loading">Preparing…</p></div><p class="fine" style="text-align:center"><button class="linkbtn" id="gateOut">Sign out</button></p></div>';
    document.getElementById('gateOut').onclick = signOut;
    mfaSetup(document.getElementById('mfaBox'), function () { location.reload(); }).catch(function (x) { document.getElementById('mfaBox').innerHTML = '<p class="err">' + esc(x.message) + '</p>'; });
  }

  // ---------- router ----------
  async function route() {
    document.body.classList.remove('nav-open');
    var parts = (location.hash.slice(1) || 'home').split('/'), name = parts[0], fn = V[name];
    var allowed = navFor(ROLE).some(function (n) { return n[0] === name; }) || ((name === 'contact' || name === 'deal') && TEAM) || name === 'profile';
    if (!fn || !allowed) { location.replace('#home'); return; }
    drawNav();
    var fresh = name + '/' + (parts[1] || '') !== route.last; route.last = name + '/' + (parts[1] || '');
    if (fresh) { main.classList.add('enter'); main.innerHTML = '<div class="skel" aria-label="Loading"><i style="--h:56px"></i><i style="--h:140px"></i><i style="--h:220px"></i></div>'; } else main.classList.remove('enter');
    try { main.innerHTML = await fn(decodeURIComponent(parts[1] || '')); if (window.DLGMotion) DLGMotion.scan(main); if (window.DLGTheme) DLGTheme.scan(); }
    catch (x) { main.innerHTML = top('Something went wrong') + '<div class="card"><p class="err">' + esc(x.message) + '</p><button class="btn" onclick="location.reload()">Try again</button></div>'; }
    var mb = document.getElementById('menuBtn'); if (mb) mb.onclick = function () { document.body.classList.toggle('nav-open'); };
    var sb = document.getElementById('srchBtn'); if (sb) sb.onclick = openSearch;
    var bl = document.getElementById('bell'); if (bl) { bl.onclick = openBell; loadBell(); }
    document.title = (main.querySelector('h1') ? main.querySelector('h1').textContent + ' · ' : '') + SPACES[ROLE][0] + ' · Delegance';
  }
  async function boot() {
    var r = await api('auth/me'); ME = r.user; ROLE = ME.role; EMAIL = !!r.email;
    SUPER = ROLE === 'super_admin'; ADMIN = SUPER || ROLE === 'admin'; TEAM = ADMIN || ROLE === 'staff';
    document.body.dataset.role = ROLE;
    document.body.classList.toggle('topbar', !TEAM);
    var sp = document.getElementById('space'); sp.querySelector('b').textContent = SPACES[ROLE][0]; sp.querySelector('span').textContent = SPACES[ROLE][1];
    document.getElementById('meBox').innerHTML = '<a href="#profile" class="melink" title="My profile">' + avatar(ME, 36) + '<div class="who"><b>' + esc(ME.name) + '</b><span>' + esc(ME.title || ROLE_NAME[ROLE]) + '</span></div></a><button class="btn btn-sm" id="soSide" aria-label="Sign out" title="Sign out" style="margin-left:auto;padding:0 10px">' + I.out + '</button>';
    document.getElementById('soSide').onclick = signOut;
    window.DLG_SIGNED_IN = true;
    if (ME.theme && window.DLGTheme && ME.theme !== DLGTheme.get()) DLGTheme.set(ME.theme, false);
    window.DLG_SIGNED_IN = true;
    if (ME.theme && window.DLGTheme && ME.theme !== DLGTheme.get()) DLGTheme.set(ME.theme, false);
    applyAccent(); loadChatBadge();
    document.querySelector('#soSide svg').setAttribute('width', '16');
  }
  document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && TEAM && !(ME && ME.mfa_required && !ME.mfa)) { e.preventDefault(); if (!dlg.open) openSearch(); } });
  setInterval(function () { if (document.visibilityState === 'visible' && ME) { loadBell(); loadChatBadge(); } }, 30000);
  window.addEventListener('hashchange', function () { if (ME && ME.mfa_required && !ME.mfa) return; route(); });
  document.addEventListener('click', function (e) { if (document.body.classList.contains('nav-open') && !e.target.closest('.side') && !e.target.closest('#menuBtn')) document.body.classList.remove('nav-open'); });
  boot().then(function () { if (ME.mfa_required && !ME.mfa) return gate(); return route(); }).catch(function (x) { if (!/sign in/i.test(x.message)) main.innerHTML = '<p class="err">' + esc(x.message) + '</p>'; });
  // Installable app: offline shell + install prompt (shown on the Account page).
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  document.addEventListener('dlg-theme', function () { if (ME) applyAccent(); });
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.DLG_INSTALL = e; });
})();
