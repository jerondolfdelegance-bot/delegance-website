/* Delegance dashboards: one app, six role spaces. */
(function () {
  'use strict';
  var main = document.getElementById('main'), dlg = document.getElementById('dlg');
  var ME = null, ROLE = null, TEAM = false, ADMIN = false, SUPER = false;
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
  function top(title, sub, actions) { return '<div class="top"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div><div class="inline">' + (actions || '') + '<button class="menu" id="menuBtn" aria-label="Open menu">' + I.menu + '</button></div></div>'; }
  function opts(list, sel, blank) { return (blank != null ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(sel == null ? '' : sel) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function modal(html, onSubmit) {
    dlg.innerHTML = '<form method="dialog" novalidate>' + html + '<p class="err" role="alert"></p><div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn btn-acc" value="ok" id="dlgOk">Save</button></div></form>';
    var f = dlg.querySelector('form');
    f.addEventListener('submit', async function (e) {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      var b = f.querySelector('#dlgOk'); b.disabled = true; f.querySelector('.err').textContent = '';
      try { var keep = await onSubmit(Object.fromEntries(new FormData(f)), f); if (!keep) dlg.close(); } catch (x) { f.querySelector('.err').textContent = x.message; }
      b.disabled = false;
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
    if (TEAM) n.push(['pipeline', 'Pipeline', 'pipe'], ['contacts', 'Contacts', 'book'], ['tasks', 'Tasks', 'task'], ['requests', 'Requests', 'inbox']);
    if (ADMIN) n.push(['people', 'People', 'people'], ['vas', 'VA applications', 'va'], ['hours', 'Hours', 'clock'], ['news', 'Announcements', 'mega']);
    if (SUPER) n.push(['audit', 'Security log', 'shield']);
    if (r === 'va') n.push(['clients', 'My clients', 'people'], ['tasks', 'Tasks', 'task'], ['hours', 'Timesheet', 'clock'], ['news', 'Updates', 'mega']);
    if (r === 'client') n.push(['requests', 'Requests', 'inbox'], ['messages', 'Messages', 'chat'], ['team', 'My team', 'star'], ['news', 'Updates', 'mega']);
    if (r === 'member') n.push(['requests', 'My requests', 'inbox'], ['messages', 'Messages', 'chat'], ['guides', 'Guides', 'book'], ['news', 'Updates', 'mega']);
    n.push(['account', 'Account', 'gear']);
    return n;
  }
  function drawNav() {
    var cur = (location.hash.slice(1) || 'home').split('/')[0];
    if (cur === 'contact') cur = 'contacts';
    document.getElementById('nav').innerHTML = navFor(ROLE).map(function (x) { return '<a href="#' + x[0] + '"' + (x[0] === cur ? ' aria-current="page"' : '') + '>' + I[x[2]] + '<span>' + esc(x[1]) + '</span></a>'; }).join('');
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
    var hero = SUPER
      ? '<div class="hero"><span class="eyebrow">Command Center</span><h1>Good to see you, ' + first + '.</h1><p>The whole of Delegance at a glance: people, pipeline, requests and security.</p><div class="actions"><a class="btn btn-acc" href="#people">Invite someone</a><a class="btn" href="#audit">Security log</a><a class="btn" href="https://desk.delegance.app/" target="_blank" rel="noopener">Open Desk</a></div></div>'
      : ADMIN ? '<div class="hero photo"><div class="txt"><span class="eyebrow">Control Room</span><h1>Hi ' + first + ', here is today.</h1><p>Requests waiting, VA applications to review, and where every lead stands.</p><div class="actions"><a class="btn btn-acc" href="#requests">Open requests</a><a class="btn" href="#vas">Review VAs</a></div></div><img src="/img/meeting.webp" alt=""></div>'
      : '<div class="hero"><span class="eyebrow">Workspace</span><h1>Let\'s move things forward, ' + first + '.</h1><p>Your tasks first, then fresh requests and leads.</p><div class="actions"><a class="btn btn-acc" href="#tasks">My tasks</a><a class="btn" href="#contacts">Add a contact</a></div></div>';
    var kpis = [['Contacts', c.contacts, c.new_this_week + ' new this week'], ['Open requests', c.open_requests, 'New or in progress', c.open_requests > 0], ['My open tasks', c.my_tasks, c.overdue ? c.overdue + ' overdue across the team' : 'Nothing overdue', c.overdue > 0], ['Website chats', c.chats_week, 'Last 7 days']];
    if (ADMIN) kpis[3] = ['VA applications', d.pending_vas, 'Waiting for review', d.pending_vas > 0];
    var html = hero + '<div class="grid g4" style="margin-bottom:16px">' + kpis.map(function (k) { return '<div class="card kpi' + (k[3] ? ' hot' : '') + '"><span>' + esc(k[0]) + '</span><b>' + esc(k[1] || 0) + '</b><small>' + esc(k[2]) + '</small></div>'; }).join('') + '</div>';
    var pipe = STAGES.map(function (s) { var r = (d.pipeline || []).find(function (x) { return x.stage === s[0]; }) || { n: 0, v: 0 }; return [s[1], r.n, r.v]; });
    var mx = Math.max.apply(null, pipe.map(function (p) { return p[1]; }).concat([1]));
    html += '<div class="grid g21" style="margin-bottom:16px"><div class="card"><h2>Pipeline <a href="#pipeline">Board</a></h2><ul class="list stagebars">' + pipe.map(function (p) { return '<li><span>' + esc(p[0]) + '</span><div class="bar"><i style="width:' + (p[1] / mx * 100) + '%"></i></div><b>' + p[1] + '</b></li>'; }).join('') + '</ul></div>';
    html += '<div class="card"><h2>My tasks <a href="#tasks">All</a></h2>' + (d.my_tasks.length ? '<ul class="list">' + d.my_tasks.map(function (t) { return '<li><div class="t"><b>' + esc(t.title) + '</b><span>' + esc([t.contact_name, t.due ? 'Due ' + day(t.due) : ''].filter(Boolean).join(' · ')) + '</span></div>' + pill(t.status) + '</li>'; }).join('') + '</ul>' : empty('No open tasks. Nice.')) + '</div></div>';
    html += '<div class="grid g3"><div class="card"><h2>New requests <a href="#requests">All</a></h2>' + (d.requests.length ? '<ul class="list">' + d.requests.map(function (r) { return '<li><a class="row" href="#contact/' + esc(r.contact_id) + '"><div class="t"><b>' + esc(r.title) + '</b><span>' + esc(r.contact_name) + ' · ' + esc(ago(r.created_at)) + '</span></div></a>' + pill(r.status) + '</li>'; }).join('') + '</ul>' : empty('No open requests.')) + '</div>';
    html += '<div class="card"><h2>Recently active <a href="#contacts">Contacts</a></h2>' + (d.recent.length ? '<ul class="list">' + d.recent.map(function (r) { return '<li><a class="row" href="#contact/' + esc(r.id) + '"><span class="av">' + initials(r.name) + '</span><div class="t"><b>' + esc(r.name) + '</b><span>' + esc(r.company || '') + '</span></div></a>' + pill(r.stage, STAGE[r.stage]) + '</li>'; }).join('') + '</ul>' : empty('No contacts yet. Website requests land here automatically.')) + '</div>';
    if (SUPER) html += '<div class="card"><h2>Security <a href="#audit">Log</a></h2><div class="grid g2" style="margin-bottom:12px"><div><span class="sub" style="color:var(--dim);font-size:12px">Active sessions</span><b style="display:block;font:600 22px Montserrat">' + d.sessions + '</b></div><div><span style="color:var(--dim);font-size:12px">Failed sign-ins (7d)</span><b style="display:block;font:600 22px Montserrat;color:' + (d.failed_logins > 10 ? 'var(--bad)' : 'inherit') + '">' + d.failed_logins + '</b></div></div><ul class="list feed">' + d.audit.slice(0, 5).map(function (a) { return '<li><div class="t"><b>' + esc(a.action) + '</b><span>' + esc(a.actor) + ' · ' + esc(ago(a.created_at)) + '</span></div></li>'; }).join('') + '</ul></div>';
    else if (ADMIN) html += '<div class="card"><h2>People <a href="#people">Manage</a></h2><ul class="list">' + ['admin', 'staff', 'va', 'client', 'member'].map(function (r) { var n = (d.people || []).filter(function (p) { return p.role === r; }).reduce(function (a, p) { return a + p.n; }, 0); return '<li><div class="t"><b>' + esc(ROLE_NAME[r]) + 's</b></div><b>' + n + '</b></li>'; }).join('') + '<li><div class="t"><b>VA hours this week</b></div><b>' + hrs(d.hours_week) + '</b></li></ul></div>';
    else html += announceCard(d.announcements);
    return top('Home', SPACES[ROLE][1]) + html;
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
  function homeClient(d) {
    var first = esc(ME.name.split(' ')[0]), isClient = ROLE === 'client';
    var html = isClient
      ? '<div class="hero photo"><div class="txt"><span class="eyebrow">Client Suite</span><h1>Welcome back, ' + first + '.</h1><p>' + esc(d.company && d.company.company ? d.company.company + ' with Delegance.' : 'Your work with Delegance.') + ' See progress, message the team and send new requests.</p><div class="actions"><button class="btn btn-acc" id="newReq">New request</button><a class="btn" href="#messages">Message us' + (d.unread ? ' (' + d.unread + ')' : '') + '</a></div></div><img src="/img/loft.webp" alt=""></div>'
      : '<div class="hero"><span class="eyebrow">Member Lounge</span><h1>Hi ' + first + ', welcome in.</h1><p>Guides for working with a VA, updates from the team, and a direct line when you are ready to start.</p><div class="actions"><button class="btn btn-acc" id="newReq">Start a request</button><a class="btn" href="/guides">Read the guides</a></div></div>';
    if (isClient) {
      html += '<div class="grid g4" style="margin-bottom:16px">' + [['Open requests', d.requests.filter(function (r) { return r.status === 'new' || r.status === 'in_progress'; }).length], ['Tasks in progress', d.tasks.filter(function (t) { return t.status !== 'done'; }).length], ['Your team', d.team.length], ['Hours this month', hrs(d.hours_month)]].map(function (k) { return '<div class="card kpi"><span>' + k[0] + '</span><b>' + esc(k[1]) + '</b></div>'; }).join('') + '</div>';
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

  V.pipeline = async function () {
    var d = await api('contacts');
    var html = top('Pipeline', 'Drag a card to move it to the next stage.', '<button class="btn btn-acc" id="addC">Add contact</button>') + '<div class="board">' + STAGES.map(function (s) {
      var items = d.items.filter(function (c) { return c.stage === s[0]; }), sum = items.reduce(function (a, c) { return a + (c.value_usd || 0); }, 0);
      return '<section class="col" data-stage="' + s[0] + '" aria-label="' + esc(s[1]) + '"><h3><span>' + esc(s[1]) + '</span><span>' + items.length + (sum ? ' · ' + money(sum) : '') + '</span></h3>' + items.map(function (c) { return '<a class="deal" draggable="true" data-id="' + esc(c.id) + '" href="#contact/' + esc(c.id) + '"><b>' + esc(c.name) + '</b><span>' + esc([c.company, c.source].filter(Boolean).join(' · ')) + '</span>' + (c.value_usd ? '<div class="v">' + money(c.value_usd) + '</div>' : '') + '</a>'; }).join('') + '</section>';
    }).join('') + '</div>';
    setTimeout(function () {
      document.getElementById('addC').onclick = addContact;
      document.querySelectorAll('.deal').forEach(function (el) { el.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', el.dataset.id); }); });
      document.querySelectorAll('.col').forEach(function (col) {
        col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('over'); });
        col.addEventListener('dragleave', function () { col.classList.remove('over'); });
        col.addEventListener('drop', async function (e) { e.preventDefault(); col.classList.remove('over'); var id = e.dataTransfer.getData('text/plain'); try { await api('contacts/' + id, 'PATCH', { stage: col.dataset.stage }); route(); } catch (x) { toast(x.message, true); } });
      });
    });
    return html;
  };
  function addContact() {
    modal('<h2>Add contact</h2><div class="row2"><label class="fld"><span>Name</span><input name="name" required maxlength="120"></label><label class="fld"><span>Company</span><input name="company" maxlength="120"></label></div><div class="row2"><label class="fld"><span>Email</span><input name="email" type="email"></label><label class="fld"><span>Phone</span><input name="phone" maxlength="40"></label></div><div class="row2"><label class="fld"><span>Country</span><input name="country" maxlength="60"></label><label class="fld"><span>Source</span><input name="source" maxlength="60" placeholder="Referral, LinkedIn…"></label></div><div class="row2"><label class="fld"><span>Stage</span><select name="stage">' + opts(STAGES, 'new') + '</select></label><label class="fld"><span>Deal value (USD, private)</span><input name="value_usd" type="number" min="0" step="1"></label></div>', async function (f) { var r = await api('contacts', 'POST', f); location.hash = '#contact/' + r.id; });
  }

  V.contacts = async function () {
    var q = sessionStorage.getItem('dq') || '';
    var d = await api('contacts' + (q ? '?q=' + encodeURIComponent(q) : ''));
    var html = top('Contacts', d.items.length + ' people and companies', '<button class="btn btn-acc" id="addC">Add contact</button>') + '<div class="tools"><input type="search" id="q" placeholder="Search name, company or email" value="' + esc(q) + '" aria-label="Search contacts"></div>';
    html += d.items.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Name</th><th class="hide-sm">Source</th><th>Stage</th><th class="hide-sm">Owner</th><th class="hide-sm">Updated</th></tr></thead><tbody>' + d.items.map(function (c) { return '<tr class="click" data-href="#contact/' + esc(c.id) + '"><td><a href="#contact/' + esc(c.id) + '" style="text-decoration:none"><b>' + esc(c.name) + '</b></a><span class="sub">' + esc([c.company, c.email].filter(Boolean).join(' · ')) + '</span></td><td class="hide-sm">' + esc(c.source || '') + '</td><td>' + pill(c.stage, STAGE[c.stage]) + '</td><td class="hide-sm">' + esc(c.owner_name || '') + '</td><td class="hide-sm">' + esc(ago(c.updated_at)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="card">' + empty(q ? 'Nothing matches that search.' : 'No contacts yet. Requests from the website "Start a request" form appear here automatically.') + '</div>';
    setTimeout(function () {
      document.getElementById('addC').onclick = addContact;
      var t; document.getElementById('q').addEventListener('input', function (e) { clearTimeout(t); t = setTimeout(function () { sessionStorage.setItem('dq', e.target.value); route().then(function () { var i = document.getElementById('q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); });
      document.querySelectorAll('tr.click').forEach(function (tr) { tr.onclick = function (e) { if (e.target.tagName !== 'A') location.hash = tr.dataset.href; }; });
    });
    return html;
  };

  V.contact = async function (id) {
    var d = await api('contacts/' + encodeURIComponent(id)), c = d.contact;
    var html = top(c.name, [c.company, c.kind === 'client' ? 'Client' : c.kind === 'partner' ? 'Partner' : 'Lead'].filter(Boolean).join(' · '), '<a class="btn" href="#contacts">Back</a>');
    html += '<div class="split"><div>';
    html += '<div class="card" style="margin-bottom:16px"><h2>Add a note</h2><form id="noteF"><textarea name="body" maxlength="3000" required placeholder="Call notes, next steps, anything the team should know."></textarea><div class="inline" style="justify-content:space-between;margin-top:10px;flex-wrap:wrap"><label class="chk" style="margin:0"><input type="checkbox" name="client"> <span>Send to the client\'s Messages' + (d.portal.length ? '' : ' (no client sign-in yet)') + '</span></label><button class="btn btn-acc btn-sm">Save note</button></div></form></div>';
    html += '<div class="card" style="margin-bottom:16px"><h2>Tasks <button class="btn btn-sm" id="addT">Add task</button></h2>' + (d.tasks.length ? '<ul class="list">' + d.tasks.map(taskRow).join('') + '</ul>' : empty('No tasks for this contact.')) + '</div>';
    html += '<div class="card" style="margin-bottom:16px"><h2>Requests</h2>' + (d.requests.length ? '<ul class="list">' + d.requests.map(function (r) { return '<li><div class="t"><b>' + esc(r.title) + '</b><span style="white-space:pre-wrap">' + esc(r.details || '') + '</span><span>' + esc(ago(r.created_at)) + '</span></div><select class="reqSt" data-id="' + esc(r.id) + '" aria-label="Request status" style="width:auto">' + opts([['new', 'New'], ['in_progress', 'In progress'], ['done', 'Done'], ['closed', 'Closed']], r.status) + '</select></li>'; }).join('') + '</ul>' : empty('No requests.')) + '</div>';
    html += '<div class="card"><h2>Timeline</h2>' + (d.notes.length ? '<ul class="timeline">' + d.notes.map(function (n) { return '<li class="' + (n.visibility === 'client' ? 'client' : '') + '"><div class="meta">' + esc(n.author_name || 'Client') + ' · ' + esc(ago(n.created_at)) + (n.visibility === 'client' ? ' · shared with client' : '') + '</div><p>' + esc(n.body) + '</p></li>'; }).join('') + '</ul>' : empty('Notes and stage changes appear here.')) + '</div>';
    html += '</div><div>';
    html += '<div class="card" style="margin-bottom:16px"><h2>Details <button class="btn btn-sm" id="editC">Edit</button></h2><dl class="kv"><dt>Stage</dt><dd><select id="stageSel" aria-label="Stage">' + opts(STAGES, c.stage) + '</select></dd><dt>Email</dt><dd>' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '—') + '</dd><dt>Phone</dt><dd>' + esc(c.phone || '—') + '</dd><dt>Country</dt><dd>' + esc(c.country || '—') + '</dd><dt>Source</dt><dd>' + esc(c.source || '—') + '</dd><dt>Value</dt><dd>' + esc(money(c.value_usd) || '—') + '</dd><dt>Owner</dt><dd><select id="ownerSel" aria-label="Owner">' + opts(d.team.filter(function (t) { return t.role !== 'va'; }).map(function (t) { return [t.id, t.name]; }), c.owner_id, 'Nobody') + '</select></dd><dt>Added</dt><dd>' + esc(day(c.created_at)) + '</dd></dl></div>';
    html += '<div class="card" style="margin-bottom:16px"><h2>Virtual assistants</h2>' + (d.vas.length ? '<ul class="list">' + d.vas.map(function (v) { return '<li><span class="av">' + initials(v.name) + '</span><div class="t"><b>' + esc(v.name) + '</b></div><button class="btn btn-sm unassign" data-va="' + esc(v.id) + '">Remove</button></li>'; }).join('') + '</ul>' : empty('No VA assigned.')) + (d.all_vas.length ? '<div class="inline" style="margin-top:10px"><select id="vaSel" aria-label="Virtual assistant">' + opts(d.all_vas.filter(function (v) { return !d.vas.some(function (x) { return x.id === v.id; }); }).map(function (v) { return [v.id, v.name]; }), '', 'Pick a VA') + '</select><button class="btn btn-sm" id="assign">Assign</button></div>' : '<p class="fine">Invite VAs from People to assign them.</p>') + '</div>';
    html += '<div class="card"><h2>Client sign-in</h2>' + (d.portal.length ? '<ul class="list">' + d.portal.map(function (u) { return '<li><div class="t"><b>' + esc(u.name) + '</b><span>' + esc(u.email) + '</span></div>' + pill(u.status) + '</li>'; }).join('') + '</ul>' : empty('This contact has no dashboard yet.') + (ADMIN && c.email ? '<button class="btn btn-sm" id="invClient">Invite to Client Suite</button>' : '')) + (ADMIN ? '<p style="margin-top:14px"><button class="btn btn-sm btn-danger" id="delC">Delete contact</button></p>' : '') + '</div>';
    html += '</div></div>';
    setTimeout(function () {
      var reload = function () { route(); };
      document.getElementById('noteF').onsubmit = async function (e) { e.preventDefault(); var f = Object.fromEntries(new FormData(e.target)); try { await api('contacts/' + c.id + '/notes', 'POST', { body: f.body, visibility: f.client ? 'client' : 'internal' }); reload(); } catch (x) { toast(x.message, true); } };
      document.getElementById('stageSel').onchange = async function (e) { try { await api('contacts/' + c.id, 'PATCH', { stage: e.target.value }); reload(); } catch (x) { toast(x.message, true); } };
      document.getElementById('ownerSel').onchange = async function (e) { try { await api('contacts/' + c.id, 'PATCH', { owner_id: e.target.value }); toast('Owner updated.'); } catch (x) { toast(x.message, true); } };
      document.querySelectorAll('.reqSt').forEach(function (s) { s.onchange = async function () { try { await api('requests/' + s.dataset.id, 'PATCH', { status: s.value }); toast('Request updated.'); } catch (x) { toast(x.message, true); } }; });
      document.getElementById('addT').onclick = function () { addTask(d.team, c.id); };
      document.getElementById('editC').onclick = function () {
        modal('<h2>Edit contact</h2><div class="row2"><label class="fld"><span>Name</span><input name="name" required value="' + esc(c.name) + '"></label><label class="fld"><span>Company</span><input name="company" value="' + esc(c.company || '') + '"></label></div><div class="row2"><label class="fld"><span>Email</span><input name="email" type="email" value="' + esc(c.email || '') + '"></label><label class="fld"><span>Phone</span><input name="phone" value="' + esc(c.phone || '') + '"></label></div><div class="row2"><label class="fld"><span>Country</span><input name="country" value="' + esc(c.country || '') + '"></label><label class="fld"><span>Source</span><input name="source" value="' + esc(c.source || '') + '"></label></div><div class="row2"><label class="fld"><span>Type</span><select name="kind">' + opts([['lead', 'Lead'], ['client', 'Client'], ['partner', 'Partner']], c.kind) + '</select></label><label class="fld"><span>Deal value (USD, private)</span><input name="value_usd" type="number" min="0" value="' + esc(c.value_usd == null ? '' : c.value_usd) + '"></label></div>', async function (f) { await api('contacts/' + c.id, 'PATCH', f); reload(); });
      };
      var a = document.getElementById('assign'); if (a) a.onclick = async function () { var v = document.getElementById('vaSel').value; if (!v) return toast('Pick a VA first.', true); try { await api('contacts/' + c.id + '/assign', 'POST', { va_id: v }); reload(); } catch (x) { toast(x.message, true); } };
      document.querySelectorAll('.unassign').forEach(function (b) { b.onclick = async function () { try { await api('contacts/' + c.id + '/assign', 'POST', { va_id: b.dataset.va, on: false }); reload(); } catch (x) { toast(x.message, true); } }; });
      var inv = document.getElementById('invClient'); if (inv) inv.onclick = async function () { try { var r = await api('users', 'POST', { name: c.name, email: c.email, role: 'client', contact_id: c.id }); showLink('Client invite ready', r.link, 'Send this link to ' + c.name + '. It works once and expires in 7 days.'); } catch (x) { toast(x.message, true); } };
      var del = document.getElementById('delC'); if (del) del.onclick = function () { modal('<h2>Delete ' + esc(c.name) + '?</h2><p class="lead">This removes the contact, its notes, requests and VA assignments. Tasks stay, without the contact.</p>', async function () { await api('contacts/' + c.id, 'DELETE'); location.hash = '#contacts'; }); document.getElementById('dlgOk').textContent = 'Delete'; };
      bindTasks(reload);
    });
    return html;
  };
  function taskRow(t) {
    return '<li><input type="checkbox" class="tdone" data-id="' + esc(t.id) + '"' + (t.status === 'done' ? ' checked' : '') + ' aria-label="Done" style="width:18px;height:18px;accent-color:var(--acc)"><div class="t"><b' + (t.status === 'done' ? ' style="text-decoration:line-through;color:var(--dim)"' : '') + '>' + esc(t.title) + '</b><span>' + esc([t.contact_name, t.assignee_name, t.due ? 'Due ' + day(t.due) : '', t.client_visible ? 'Client can see' : ''].filter(Boolean).join(' · ')) + '</span></div><select class="tst" data-id="' + esc(t.id) + '" aria-label="Task status" style="width:auto">' + opts([['open', 'To do'], ['doing', 'Doing'], ['done', 'Done']], t.status) + '</select></li>';
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
    if (TEAM) html += '<label class="chk"><input type="checkbox" name="client_visible"> <span>Show this task to the client</span></label>';
    modal(html, async function (f) { if (contactId) f.contact_id = contactId; f.client_visible = !!f.client_visible; await api('tasks', 'POST', f); route(); });
  }

  V.tasks = async function () {
    var mine = TEAM ? (sessionStorage.getItem('tmine') !== '0') : true;
    var d = await api('tasks' + (TEAM && mine ? '?mine=1' : ''));
    var open = d.items.filter(function (t) { return t.status !== 'done'; }), done = d.items.filter(function (t) { return t.status === 'done'; });
    var team = null, cons = null;
    if (TEAM) { try { var c = await api('contacts'); cons = c.items; } catch (e) {} }
    if (ROLE === 'va') { try { cons = (await api('va/clients')).items; } catch (e) {} }
    var html = top('Tasks', open.length + ' open', '<button class="btn btn-acc" id="addT">Add task</button>');
    if (TEAM) html += '<div class="seg" style="max-width:320px"><button data-m="1" aria-selected="' + mine + '">Mine</button><button data-m="0" aria-selected="' + !mine + '">Everyone</button></div>';
    html += '<div class="card" style="margin-bottom:16px"><h2>Open</h2>' + (open.length ? '<ul class="list">' + open.map(taskRow).join('') + '</ul>' : empty('All clear.')) + '</div>';
    if (done.length) html += '<div class="card"><h2>Done</h2><ul class="list">' + done.slice(0, 30).map(taskRow).join('') + '</ul></div>';
    setTimeout(function () {
      bindTasks(route);
      document.querySelectorAll('.seg button[data-m]').forEach(function (b) { b.onclick = function () { sessionStorage.setItem('tmine', b.dataset.m); route(); }; });
      document.getElementById('addT').onclick = async function () {
        if (TEAM && !team) { try { team = (await api('team')).items; } catch (e) { team = [{ id: ME.id, name: ME.name }]; } }
        addTask(team, null, cons || []);
      };
    });
    return html;
  };

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
      return '<tr><td><b>' + esc(u.name) + '</b>' + (u.id === ME.id ? ' <span class="pill">You</span>' : '') + '<span class="sub">' + esc(u.email) + (u.title ? ' · ' + esc(u.title) : '') + '</span></td><td>' + esc(u.role_name) + '</td><td>' + pill(u.status) + '</td><td class="hide-sm">' + esc(u.last_login ? ago(u.last_login) : 'Never') + '</td><td>' + (u.id !== ME.id && (SUPER || ['staff', 'va', 'client', 'member'].includes(u.role)) ? '<button class="btn btn-sm editU" data-id="' + esc(u.id) + '">Manage</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="fine">Invite links and password reset links work once. Send them to the person yourself, by email or chat.</p>';
    setTimeout(function () {
      document.getElementById('inv').onclick = function () {
        modal('<h2>Invite someone</h2><div class="row2"><label class="fld"><span>Name</span><input name="name" required maxlength="80"></label><label class="fld"><span>Email</span><input name="email" type="email" required></label></div><div class="row2"><label class="fld"><span>Role</span><select name="role" id="invRole">' + opts(roles, 'staff') + '</select></label><label class="fld"><span>Job title (optional)</span><input name="title" maxlength="80"></label></div><label class="fld" id="invVa" hidden><span>Link VA profile</span><select name="candidate_id">' + opts(d.candidates.map(function (c) { return [c.id, c.name]; }), '', 'Not yet') + '</select></label><label class="fld" id="invCl" hidden><span>Client record</span><select name="contact_id">' + opts(d.contacts.map(function (c) { return [c.id, c.company ? c.company + ' (' + c.name + ')' : c.name]; }), '', 'Create a new one') + '</select></label>', async function (f) { var r = await api('users', 'POST', f); showLink('Invite ready', r.link, 'Send this link to ' + f.name + '. It works once and expires in 7 days.'); setTimeout(route, 50); return true; });
        var rs = document.getElementById('invRole'), sync = function () { document.getElementById('invVa').hidden = rs.value !== 'va'; document.getElementById('invCl').hidden = rs.value !== 'client'; }; rs.onchange = sync; sync();
      };
      document.querySelectorAll('.editU').forEach(function (b) {
        b.onclick = function () {
          var u = d.items.find(function (x) { return x.id === b.dataset.id; });
          modal('<h2>' + esc(u.name) + '</h2><p class="lead">' + esc(u.email) + '</p><div class="row2"><label class="fld"><span>Name</span><input name="name" value="' + esc(u.name) + '"></label><label class="fld"><span>Job title</span><input name="title" value="' + esc(u.title || '') + '"></label></div><div class="row2"><label class="fld"><span>Role</span><select name="role">' + opts(roles.some(function (r) { return r[0] === u.role; }) ? roles : roles.concat([[u.role, ROLE_NAME[u.role]]]), u.role) + '</select></label><label class="fld"><span>Status</span><select name="status">' + opts([['active', 'Active'], ['disabled', 'Off (cannot sign in)']].concat(u.status === 'invited' ? [['invited', 'Invited']] : []), u.status) + '</select></label></div><label class="fld"><span>VA profile</span><select name="candidate_id">' + opts(d.candidates.map(function (c) { return [c.id, c.name]; }), u.candidate_id, 'None') + '</select></label><label class="fld"><span>Client record</span><select name="contact_id">' + opts(d.contacts.map(function (c) { return [c.id, c.company ? c.company + ' (' + c.name + ')' : c.name]; }), u.contact_id, 'None') + '</select></label><div class="inline" style="flex-wrap:wrap;margin:6px 0 10px"><button type="button" class="btn btn-sm" id="uLink">' + (u.status === 'invited' ? 'New invite link' : 'Password reset link') + '</button><button type="button" class="btn btn-sm" id="uOut">Sign out everywhere</button>' + (SUPER ? '<button type="button" class="btn btn-sm btn-danger" id="uDel">Delete account</button>' : '') + '</div>', async function (f) { await api('users/' + u.id, 'PATCH', f); toast('Saved.'); route(); });
          document.getElementById('uLink').onclick = async function () { try { var r = await api('users/' + u.id + '/link', 'POST', {}); showLink(u.status === 'invited' ? 'New invite link' : 'Password reset link', r.link, 'Send this to ' + u.name + '. It works once and expires in ' + (u.status === 'invited' ? '7 days.' : '24 hours.')); } catch (x) { toast(x.message, true); } };
          document.getElementById('uOut').onclick = async function () { try { await api('users/' + u.id + '/sessions', 'DELETE'); toast(u.name + ' is signed out everywhere.'); } catch (x) { toast(x.message, true); } };
          var del = document.getElementById('uDel'); if (del) del.onclick = async function () { if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Click again to delete'; return; } try { await api('users/' + u.id, 'DELETE'); dlg.close(); toast('Account deleted.'); route(); } catch (x) { toast(x.message, true); } };
        };
      });
    });
    return html;
  };

  V.vas = async function () {
    var st = sessionStorage.getItem('vst') || 'pending', d = await api('candidates?status=' + st);
    var html = top('VA applications', 'Approve profiles to show them on delegance.app/candidates') + '<div class="seg" style="max-width:420px">' + [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(function (s) { return '<button data-s="' + s[0] + '" aria-selected="' + (s[0] === st) + '">' + s[1] + '</button>'; }).join('') + '</div>';
    html += d.items.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Candidate</th><th class="hide-sm">Experience</th><th class="hide-sm">Updated</th><th></th></tr></thead><tbody>' + d.items.map(function (c) { return '<tr><td><b>' + esc(c.name) + '</b><span class="sub">' + esc([c.headline, c.location].filter(Boolean).join(' · ')) + '</span></td><td class="hide-sm">' + esc([c.years ? c.years + ' yrs' : '', c.availability].filter(Boolean).join(' · ')) + '</td><td class="hide-sm">' + esc(ago(c.updated_at)) + '</td><td><div class="inline" style="flex-wrap:wrap">' + (st === 'approved' ? '<a class="btn btn-sm" href="/va/' + esc(c.slug) + '" target="_blank" rel="noopener">View</a>' : '<a class="btn btn-sm" href="https://desk.delegance.app/#/candidates" target="_blank" rel="noopener">Full profile</a>') + (st !== 'approved' ? '<button class="btn btn-sm btn-acc cand" data-id="' + esc(c.id) + '" data-s="approved">Approve</button>' : '') + (st !== 'rejected' ? '<button class="btn btn-sm cand" data-id="' + esc(c.id) + '" data-s="rejected">' + (st === 'approved' ? 'Unpublish' : 'Reject') + '</button>' : '') + '</div></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="card">' + empty('Nothing here.') + '</div>';
    setTimeout(function () {
      document.querySelectorAll('.seg button[data-s]').forEach(function (b) { b.onclick = function () { sessionStorage.setItem('vst', b.dataset.s); route(); }; });
      document.querySelectorAll('.cand').forEach(function (b) { b.onclick = function () { var ap = b.dataset.s === 'approved'; modal('<h2>' + (ap ? 'Approve this profile?' : 'Send back or reject?') + '</h2><label class="fld"><span>Note to the candidate (optional)</span><textarea name="note" maxlength="500" placeholder="' + (ap ? 'Welcome aboard!' : 'What to fix before we can publish it.') + '"></textarea></label>', async function (f) { await api('candidates/' + b.dataset.id, 'POST', { status: b.dataset.s, note: f.note }); toast(ap ? 'Approved. The profile is live.' : 'Updated.'); route(); }); document.getElementById('dlgOk').textContent = ap ? 'Approve' : 'Confirm'; }; });
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

  V.account = async function () {
    var html = top('Account', ROLE_NAME[ROLE] + ' · ' + ME.email);
    html += '<div class="grid g2"><div class="card"><h2>Profile</h2><form id="profF"><label class="fld"><span>Name</span><input name="name" required maxlength="80" value="' + esc(ME.name) + '"></label><label class="fld"><span>Job title (optional)</span><input name="title" maxlength="80" value="' + esc(ME.title || '') + '"></label><button class="btn btn-acc">Save</button></form></div>';
    html += '<div class="card"><h2>Password</h2><form id="pwF"><label class="fld"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label><label class="fld"><span>New password</span><input type="password" name="password" autocomplete="new-password" minlength="10" required><small>At least 10 characters. Changing it signs out your other devices.</small></label><button class="btn btn-acc">Change password</button></form></div></div>';
    html += '<div class="card" style="margin-top:16px"><h2>Sign out</h2><div class="inline" style="flex-wrap:wrap"><button class="btn" id="so">Sign out</button><button class="btn btn-danger" id="soAll">Sign out on every device</button></div></div>';
    setTimeout(function () {
      document.getElementById('profF').onsubmit = async function (e) { e.preventDefault(); try { await api('auth/profile', 'POST', Object.fromEntries(new FormData(e.target))); toast('Saved.'); boot(); } catch (x) { toast(x.message, true); } };
      document.getElementById('pwF').onsubmit = async function (e) { e.preventDefault(); try { await api('auth/password', 'POST', Object.fromEntries(new FormData(e.target))); e.target.reset(); toast('Password changed.'); } catch (x) { toast(x.message, true); } };
      document.getElementById('so').onclick = signOut;
      document.getElementById('soAll').onclick = async function () { try { await api('auth/logout-all', 'POST', {}); } catch (x) {} location.replace('/login'); };
    });
    return html;
  };
  async function signOut() { try { await api('auth/logout', 'POST', {}); } catch (x) {} location.replace('/login'); }

  // ---------- router ----------
  async function route() {
    document.body.classList.remove('nav-open');
    var parts = (location.hash.slice(1) || 'home').split('/'), name = parts[0], fn = V[name];
    var allowed = navFor(ROLE).some(function (n) { return n[0] === name; }) || (name === 'contact' && TEAM);
    if (!fn || !allowed) { location.replace('#home'); return; }
    drawNav();
    try { main.innerHTML = await fn(decodeURIComponent(parts[1] || '')); }
    catch (x) { main.innerHTML = top('Something went wrong') + '<div class="card"><p class="err">' + esc(x.message) + '</p><button class="btn" onclick="location.reload()">Try again</button></div>'; }
    var mb = document.getElementById('menuBtn'); if (mb) mb.onclick = function () { document.body.classList.toggle('nav-open'); };
    document.title = (main.querySelector('h1') ? main.querySelector('h1').textContent + ' · ' : '') + SPACES[ROLE][0] + ' · Delegance';
  }
  async function boot() {
    var r = await api('auth/me'); ME = r.user; ROLE = ME.role;
    SUPER = ROLE === 'super_admin'; ADMIN = SUPER || ROLE === 'admin'; TEAM = ADMIN || ROLE === 'staff';
    document.body.dataset.role = ROLE;
    document.body.classList.toggle('topbar', !TEAM);
    var sp = document.getElementById('space'); sp.querySelector('b').textContent = SPACES[ROLE][0]; sp.querySelector('span').textContent = SPACES[ROLE][1];
    document.getElementById('meBox').innerHTML = '<span class="av">' + initials(ME.name) + '</span><div class="who"><b>' + esc(ME.name) + '</b><span>' + esc(ROLE_NAME[ROLE]) + '</span></div><button class="btn btn-sm" id="soSide" aria-label="Sign out" title="Sign out" style="margin-left:auto;padding:0 10px">' + I.out + '</button>';
    document.getElementById('soSide').onclick = signOut;
    document.querySelector('#soSide svg').setAttribute('width', '16');
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('click', function (e) { if (document.body.classList.contains('nav-open') && !e.target.closest('.side') && !e.target.closest('#menuBtn')) document.body.classList.remove('nav-open'); });
  boot().then(route).catch(function (x) { if (!/sign in/i.test(x.message)) main.innerHTML = '<p class="err">' + esc(x.message) + '</p>'; });
})();
