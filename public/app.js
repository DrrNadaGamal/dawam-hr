import { T, V } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LT = ['annual', 'casual', 'sick', 'unpaid'];
let lang = localStorage.getItem('dw_lang') || ((navigator.language || '').startsWith('ar') ? 'ar' : 'en');
const ql = new URLSearchParams(location.search).get('lang'); if (ql === 'ar' || ql === 'en') lang = ql;
let as = localStorage.getItem('dw_as') || 'e2';
const qa = new URLSearchParams(location.search).get('as'); if (qa) as = qa;
let S = null, offline = false, month = null, calMonth = null, selEmp = null, payMonth = null;
const t = (k) => T[lang][k] ?? T.en[k] ?? k;
const v = (s) => (lang === 'ar' && V[s]) || s;
const loc = () => (lang === 'ar' ? 'ar-EG' : 'en-US');
const nf = (n, o) => new Intl.NumberFormat(loc(), o).format(n);
const money = (n) => new Intl.NumberFormat(loc(), { style: 'currency', currency: S?.settings?.currency || 'EGP', maximumFractionDigits: 0 }).format(n || 0);
const dg = (s) => (lang === 'ar' ? String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]) : String(s));
const fdate = (s, o = { day: 'numeric', month: 'short' }) => (s ? new Intl.DateTimeFormat(loc(), { ...o, timeZone: 'UTC' }).format(new Date(s + 'T00:00:00Z')) : '');
const fmonth = (ym) => new Intl.DateTimeFormat(loc(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ym + '-01T00:00:00Z'));
const wday = (s, w = 'short') => new Intl.DateTimeFormat(loc(), { weekday: w, timeZone: 'UTC' }).format(new Date(s + 'T00:00:00Z'));
const tm = (s) => (s ? dg(s) : '-');
const hm = (m) => (m > 0 ? `${nf(Math.floor(m / 60))}${t('h')} ${nf(m % 60)}${t('m')}` : '-');
const hh = (m) => nf(Math.round((m / 60) * 10) / 10);
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const diff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const tz = () => S?.settings?.tz || 'Africa/Cairo';
function nowParts(ms = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const emp = (id) => S.employees.find((e) => e.id === id);
const nm = (e) => (e ? (lang === 'ar' && e.nameAr ? e.nameAr : e.name) : '?');
const me = () => emp(S.me.id);
const role = () => S.me.role;
const initials = (n) => n.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const hue = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
const avatar = (e, sz = '') => `<span class="av ${sz}" style="--h:${hue(e.id + e.name)}" aria-hidden="true">${esc(initials(lang === 'ar' && e.nameAr ? e.nameAr : e.name))}</span>`;
const shift = (id) => S.shifts.find((s) => s.id === id);
const shiftName = (s) => (lang === 'ar' && s.nameAr ? s.nameAr : s.name);

// ---------- network, offline queue ----------
const Q_KEY = 'dw_queue';
const getQ = () => { try { return JSON.parse(localStorage.getItem(Q_KEY) || '[]'); } catch { return []; } };
const setQ = (q) => localStorage.setItem(Q_KEY, JSON.stringify(q));
const url = () => `/api/data?as=${encodeURIComponent(as)}${month ? '&month=' + month : ''}`;
async function call(body) {
  const r = await fetch(body ? `/api/data` : url(), body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as, month, ...body }) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'error'); e.http = true; throw e; }
  return j;
}
function adopt(j) { S = j; offline = false; month = j.month; localStorage.setItem('dw_cache_' + as, JSON.stringify(j)); }
async function load() {
  try { adopt(await call()); }
  catch (e) {
    if (e.http) { toast(errMsg(e), true); }
    const c = localStorage.getItem('dw_cache_' + as); if (c && !S) { S = JSON.parse(c); month = S.month; }
    offline = true;
  }
  if (!S) { $('#view').innerHTML = `<div class="card pad"><h3>${esc(t('noConn'))}</h3><p class="muted">${esc(t('noConnText'))}</p><button class="btn primary" data-act="retry">${esc(t('retry'))}</button></div>`; return false; }
  return true;
}
const errMsg = (e) => { const k = 'e:' + e.message; return T[lang][k] || e.message || t('error'); };
async function op(o, ok) {
  try { adopt(await call({ op: o })); if (ok) toast(ok); render(); return true; }
  catch (e) { if (e.http) toast(errMsg(e), true); else { offline = true; toast(t('offline'), true); render(); } return false; }
}
// Check-in and check-out keep working without a connection: the moment is saved on this device and sent later.
async function punch(type) {
  const at = Date.now();
  try { adopt(await call({ op: { type } })); toast(t(type === 'att.in' ? 'checkedIn' : 'checkedOut')); render(); }
  catch (e) {
    if (e.http) { toast(errMsg(e), true); return; }
    setQ([...getQ(), { as, type, at }]); offline = true; toast(t('savedLocal')); render();
  }
}
let flushing = false;
async function flush() {
  if (flushing || !getQ().length) return; flushing = true;
  try {
    for (;;) {
      const q = getQ(); if (!q.length) break; const it = q[0];
      const prev = as;
      try { const r = await fetch('/api/data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: it.as, op: { type: it.type, at: it.at } }) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); toast(`${t('syncSkipped')}: ${errMsg({ message: j.error })}`, true); }
        setQ(getQ().slice(1)); }
      catch { break; }
      as = prev;
    }
  } finally { flushing = false; }
  if (!getQ().length && S) { if (await load()) { toast(t('synced')); render(); } }
}
window.addEventListener('online', flush); setInterval(flush, 20000);

let tt;
function toast(msg, bad) { const el = $('#toast'); el.textContent = msg; el.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(tt); tt = setTimeout(() => (el.className = 'toast'), 3000); }

// ---------- icons ----------
const ICON = {
  dashboard: 'M3 12l9-8 9 8v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  attendance: 'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  leave: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4 M9 15l2 2 4-4',
  approvals: 'M5 13l4 4L19 7',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  people: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0z M4 21a8 8 0 0 1 16 0',
  payroll: 'M3 7h18v10H3z M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M6 10v0 M18 14v0',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1z',
  plus: 'M12 5v14 M5 12h14', menu: 'M4 7h16 M4 12h16 M4 17h16', x: 'M6 6l12 12 M18 6L6 18', edit: 'M4 20h4L19 9l-4-4L4 16z', trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  login: 'M10 17l5-5-5-5 M15 12H3 M14 4h6v16h-6', logout: 'M14 17l-5-5 5-5 M9 12h12 M10 4H4v16h6', wifi: 'M2 9a15 15 0 0 1 20 0 M5.5 12.5a10 10 0 0 1 13 0 M9 16a5 5 0 0 1 6 0 M12 19.5v0', download: 'M12 4v11 M7 11l5 5 5-5 M4 20h16', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6',
};
const ic = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[n]}"/></svg>`;
const NAVS = { admin: ['dashboard', 'attendance', 'leave', 'approvals', 'calendar', 'people', 'payroll', 'settings'], manager: ['dashboard', 'attendance', 'leave', 'approvals', 'calendar'], employee: ['dashboard', 'attendance', 'leave', 'calendar'] };
const route = () => (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
const badge = (s, label) => `<span class="badge ${s}">${esc(label || t('st_' + s))}</span>`;
const stLabel = (i) => (i.s === 'leave' ? `${t('st_leave')} (${t(i.leaveType)})` : t('st_' + i.s));

// ---------- chrome ----------
function chrome(r) {
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  const navs = NAVS[role()]; const page = navs.includes(r[0]) ? r[0] : 'dashboard';
  document.title = `${t('app')} - ${t(page)}`;
  const pend = S.pendingCount;
  $('#side').innerHTML = `<div class="brand"><span class="logo"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg></span><div><b>${esc(t('app'))}</b><small>${esc(t('tag'))}</small></div></div>
  <nav aria-label="${esc(t('menu'))}">${navs.map((n) => `<a href="#/${n === 'dashboard' ? '' : n}" class="${page === n ? 'on' : ''}" ${page === n ? 'aria-current="page"' : ''}>${ic(n)}<span>${esc(t(n))}</span>${n === 'approvals' && pend ? `<em class="cnt">${nf(pend)}</em>` : ''}</a>`).join('')}</nav>
  <div class="side-foot"><span class="pill">${esc(t('demoBadge'))}</span><span>${esc(t('demoNote'))}</span><span>${esc(S.settings.company)}</span></div>`;
  const q = getQ().filter((x) => x.as === as).length;
  $('#top').innerHTML = `<button class="icon-btn burger" id="burger" aria-label="${esc(t('menu'))}">${ic('menu')}</button><h1 class="top-title">${esc(t(page))}</h1>
  <label class="asel"><span class="muted">${esc(t('viewAs'))}</span><select id="as" aria-label="${esc(t('viewAs'))}">${['admin', 'manager', 'employee'].map((rl) => `<optgroup label="${esc(t('role_' + rl))}">${S.employees.filter((e) => e.active && e.role === rl).map((e) => `<option value="${e.id}" ${e.id === as ? 'selected' : ''}>${esc(nm(e))}</option>`).join('')}</optgroup>`).join('')}</select></label>
  <button class="btn ghost" data-act="lang" aria-label="${esc(t('language'))}">${lang === 'ar' ? 'EN' : 'عربي'}</button>`;
  $('#banner').innerHTML = offline || q ? `<div class="offline">${ic('wifi')}<span>${esc(offline ? t('offlineBanner') : t('pendingSync'))}${q ? ` ${esc(t('queued'))}: ${nf(q)}` : ''}</span>${q ? `<button class="btn" data-act="sync">${esc(t('syncNow'))}</button>` : ''}</div>` : '';
  $('#as').onchange = async (e) => { as = e.target.value; localStorage.setItem('dw_as', as); S = null; selEmp = null; if (await load()) { if (!NAVS[role()].includes(route()[0]) && route()[0]) location.hash = '#/'; render(); } };
  $('#burger').onclick = () => document.body.classList.toggle('nav-open');
  return page;
}

function render() {
  if (!S) return; const r = route(); const page = chrome(r);
  const fn = { dashboard, attendance, leave, approvals, calendar, people, payroll, settings }[page];
  $('#view').innerHTML = fn(); document.body.classList.remove('nav-open'); after(page);
}

// ---------- shared pieces ----------
const kpi = (label, val, sub = '', cls = '') => `<div class="kpi ${cls}"><small>${esc(label)}</small><b>${val}</b><span>${sub}</span></div>`;
const bar = (label, val, max, c = '') => `<div class="hbar"><span>${esc(label)}</span><div><i class="${c}" style="width:${max ? Math.min(100, (val / max) * 100) : 0}%"></i></div><b>${nf(val)}</b></div>`;
const person = (e, sub) => `<span class="lt">${avatar(e)}<span><b>${esc(nm(e))}</b><small>${esc(sub ?? v(e.title))}</small></span></span>`;
const dayStr = (l) => (l.from === l.to ? fdate(l.from) : `${fdate(l.from)} - ${fdate(l.to)}`);
const lstat = (s) => `<span class="badge ls-${s}">${esc(t('ls_' + s))}</span>`;

function myDay() {
  const e = me(); const sh = shift(e.shiftId); const np = nowParts(); const rec = S.todayList.find((x) => x.empId === e.id);
  const q = getQ().filter((x) => x.as === as && nowParts(x.at).date === np.date);
  const pin = q.find((x) => x.type === 'att.in'), pout = q.find((x) => x.type === 'att.out');
  const inT = rec?.in || (pin && nowParts(pin.at).time); const outT = rec?.out || (pout && nowParts(pout.at).time);
  const synced = !pin && !pout;
  let status, btn = '';
  if (rec?.s === 'leave') status = `<span class="badge leave">${esc(t('onLeaveToday'))}</span>`;
  else if (inT && outT) status = `<span class="badge present">${esc(t('dayDone'))}</span>`;
  else if (inT) { status = `<span class="badge present">${esc(t('working'))}</span>`; btn = `<button class="btn big out" data-act="punch" data-type="att.out">${ic('logout')}<span>${esc(t('checkOut'))}</span></button>`; }
  else if (rec && ['weekend', 'holiday'].includes(rec.s)) { status = `<span class="badge ${rec.s}">${esc(t('st_' + rec.s))}</span>`; btn = `<button class="btn big" data-act="punch" data-type="att.in">${ic('login')}<span>${esc(t('checkIn'))}</span></button>`; }
  else { status = `<span class="badge notIn">${esc(t('notCheckedIn'))}</span>`; btn = `<button class="btn big primary" data-act="punch" data-type="att.in">${ic('login')}<span>${esc(t('checkIn'))}</span></button>`; }
  let worked = '';
  if (inT) { const m = Math.max(0, (outT ? hmToMin(outT) : hmToMin(np.time)) - hmToMin(inT)); worked = `<div class="wk"><small>${esc(t(outT ? 'workedToday' : 'workedSoFar'))}</small><b>${hm(m)}</b></div>`; }
  return `<section class="card myday" aria-label="${esc(t('myDay'))}"><div class="md-l"><small class="muted">${esc(wday(np.date, 'long'))}, ${esc(fdate(np.date, { day: 'numeric', month: 'long' }))}</small>
  <h2>${esc(t('hello'))} ${esc(nm(e).split(' ')[0])}</h2><p class="muted">${esc(shiftName(sh))} ${tm(sh.start)} - ${tm(sh.end)} (${esc(t('grace'))} ${nf(sh.grace)} ${esc(t('min'))})</p>${status}</div>
  <div class="md-t"><div class="times"><div><small>${esc(t('in'))}</small><b>${tm(inT)}</b></div><div><small>${esc(t('out'))}</small><b>${tm(outT)}</b></div>${worked}</div>
  ${btn}${synced ? '' : `<p class="muted warn">${ic('wifi')} ${esc(t('notSynced'))}</p>`}</div></section>`;
}
const hmToMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

// ---------- pages ----------
function dashboard() {
  const st = S.stats; const np = nowParts(); const lead = role() !== 'employee';
  const bal = S.balances[S.me.id];
  const mydays = S.days[S.me.id] || [];
  const mLate = mydays.filter((d) => d.s === 'late').length, mMin = mydays.reduce((a, d) => a + d.w, 0);
  const kp = lead
    ? [kpi(t('presentNow'), `${nf(st.present)}<small>/${nf(st.headcount)}</small>`, `${nf(st.waiting)} ${t('notYetIn')}`, 'good'), kpi(t('lateToday'), nf(st.late), '', st.late ? 'warn' : ''), kpi(t('onLeaveToday'), nf(st.onLeave), '', 'info'), kpi(t('pendingApprovals'), nf(S.pendingCount), `<a href="#/approvals">${esc(t('review'))}</a>`, S.pendingCount ? 'warn' : '')]
    : [kpi(t('annual'), nf(bal.annual.available), `${t('daysLeft')}`, 'good'), kpi(t('casual'), nf(bal.casual.available), t('daysLeft'), 'info'), kpi(t('lateMonth'), nf(mLate), fmonth(S.month), mLate ? 'warn' : ''), kpi(t('hoursMonth'), hh(mMin), fmonth(S.month))];
  const out = whoIsOut(np.date, 14);
  let left;
  if (lead && S.trend.length) {
    const max = Math.max(1, ...S.trend.map((d) => d.present + d.late + d.absent + d.leave));
    left = `<section class="card"><h3>${esc(t('last7'))}</h3><div class="chart" role="img" aria-label="${esc(t('last7'))}">${S.trend.map((d) => { const tot = d.present + d.late + d.absent + d.leave; return `<div class="col"><div class="stack" style="height:${(tot / max) * 100}%"><i class="present" style="flex:${d.present}" title="${esc(t('st_present'))} ${d.present}"></i><i class="late" style="flex:${d.late}" title="${esc(t('st_late'))} ${d.late}"></i><i class="leave" style="flex:${d.leave}" title="${esc(t('st_leave'))} ${d.leave}"></i><i class="absent" style="flex:${d.absent}" title="${esc(t('st_absent'))} ${d.absent}"></i></div><small>${esc(wday(d.date))}<br>${dg(d.date.slice(8))}</small></div>`; }).join('')}</div>
    <div class="legend">${['present', 'late', 'leave', 'absent'].map((s) => `<span><i class="dot ${s}"></i>${esc(t('st_' + s))}</span>`).join('')}</div></section>`;
  } else {
    left = `<section class="card"><h3>${esc(t('myBalances'))} ${dg(np.date.slice(0, 4))}</h3>${['annual', 'casual', 'sick'].map((k) => bar(t(k), bal[k].used, bal[k].ent, k)).join('')}<p class="muted">${esc(t('balanceNote'))}</p></section>`;
  }
  const pendList = S.leaves.filter((l) => l.status === 'pending' && canDecide(emp(l.empId)));
  const right = `<section class="card"><h3>${esc(t('whoIsOut'))}</h3>${out.length ? `<ul class="feed">${out.map((o) => `<li>${avatar(emp(o.empId))}<span class="grow"><b>${esc(nm(emp(o.empId)))}</b><br><small class="muted">${esc(dayStr(o))}</small></span>${o.from <= np.date ? `<span class="badge leave">${esc(t('today'))}</span>` : ''}</li>`).join('')}</ul>` : `<p class="muted">${esc(t('nobodyOut'))}</p>`}</section>`;
  const pend = lead ? `<section class="card"><h3>${esc(t('waitingYou'))} ${pendList.length ? `<em class="cnt">${nf(pendList.length)}</em>` : ''}</h3>${pendList.length ? pendList.slice(0, 4).map((l) => `<div class="pq"><span class="grow">${person(emp(l.empId), `${t(l.type)} · ${dayStr(l)} · ${nf(l.days)} ${t('days')}`)}</span><button class="btn good" data-act="approve" data-id="${l.id}" aria-label="${esc(t('approve'))} ${esc(nm(emp(l.empId)))}">${ic('approvals')}</button><button class="btn danger" data-act="reject" data-id="${l.id}" aria-label="${esc(t('reject'))} ${esc(nm(emp(l.empId)))}">${ic('x')}</button></div>`).join('') : `<p class="muted">${esc(t('allClear'))}</p>`}</section>` : '';
  const act = role() === 'admin' ? `<section class="card"><h3>${esc(t('activity'))}</h3><ul class="feed">${S.log.slice(0, 7).map((x) => `<li><span class="grow">${esc(logText(x))}</span><small>${esc(relTime(x.ts))}</small></li>`).join('')}</ul></section>` : '';
  return `${myDay()}<div class="kpis">${kp.join('')}</div><div class="grid2">${left}<div class="stack-col">${right}</div></div>${pend || act ? `<div class="grid2 b">${pend}${act}</div>` : ''}`;
}
const canDecide = (e) => e && e.id !== S.me.id && (role() === 'admin' || e.managerId === S.me.id);
function whoIsOut(from, days) {
  const to = addDays(from, days);
  return S.outCal.filter((o) => o.to >= from && o.from <= to && emp(o.empId)?.active).sort((a, b) => a.from.localeCompare(b.from));
}
function relTime(ts) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000)); if (m < 2) return t('now');
  const [n, u] = m < 60 ? [m, 'mAgo'] : m < 1440 ? [Math.round(m / 60), 'hAgo'] : [Math.round(m / 1440), 'dAgo'];
  return lang === 'ar' ? `${t('ago')} ${nf(n)}${t(u)}` : `${n}${t(u)} ${t('ago')}`;
}
function logText(x) {
  const n = nm(emp(x.emp) || emp(x.actor)); const a = nm(emp(x.actor));
  const k = { in: 'lg_in', out: 'lg_out', request: 'lg_request', approved: 'lg_approved', rejected: 'lg_rejected', cancel: 'lg_cancel', fix: 'lg_fix', clear: 'lg_clear', empAdd: 'lg_empAdd', empEdit: 'lg_empEdit', empOff: 'lg_empOff', shift: 'lg_shift', holiday: 'lg_holiday' }[x.kind] || 'lg_other';
  return t(k).replace('{a}', a).replace('{n}', n).replace('{time}', dg(x.time || '')).replace('{type}', x.type ? t(x.type) : '').replace('{days}', nf(x.days || 0));
}

function attendance() {
  const ids = [S.me.id, ...S.teamIds]; const sel = ids.includes(selEmp) ? selEmp : S.me.id; const e = emp(sel); const rows = S.days[sel] || [];
  const np = nowParts();
  const tot = rows.reduce((a, d) => ({ w: a.w + d.w, late: a.late + (d.s === 'late' ? 1 : 0), abs: a.abs + (d.s === 'absent' ? 1 : 0), ot: a.ot + d.ot, pres: a.pres + (d.s === 'present' || d.s === 'late' ? 1 : 0), lv: a.lv + (d.s === 'leave' ? 1 : 0) }), { w: 0, late: 0, abs: 0, ot: 0, pres: 0, lv: 0 });
  const board = role() !== 'employee' ? `<section class="card sect"><h3>${esc(t('todayBoard'))} <small class="muted">${esc(fdate(np.date, { day: 'numeric', month: 'long' }))}</small></h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('employee'))}</th><th>${esc(t('shift'))}</th><th>${esc(t('status'))}</th><th>${esc(t('in'))}</th><th>${esc(t('out'))}</th><th></th></tr></thead><tbody>${S.todayList.map((x) => { const p = emp(x.empId); return `<tr><td>${person(p)}</td><td>${esc(shiftName(shift(p.shiftId)))}</td><td>${badge(x.s, stLabel(x))}${x.src === 'offline' ? ` <span class="tag">${esc(t('src_offline'))}</span>` : ''}</td><td class="num">${tm(x.in)}</td><td class="num">${tm(x.out)}</td><td>${x.empId !== S.me.id ? `<button class="btn ghost sm" data-act="fix" data-emp="${x.empId}" data-date="${np.date}">${esc(t('fix'))}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></section>` : '';
  const tools = `<div class="toolbar"><label class="inl"><span class="muted">${esc(t('month'))}</span><input type="month" id="month" value="${month}" max="${np.date.slice(0, 7)}"></label>${ids.length > 1 ? `<label class="inl"><span class="muted">${esc(t('employee'))}</span><select id="selemp">${ids.map((i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(nm(emp(i)))}${i === S.me.id ? ` (${esc(t('you'))})` : ''}</option>`).join('')}</select></label>` : ''}</div>`;
  const sums = `<div class="kpis">${kpi(t('daysPresent'), nf(tot.pres), `${nf(tot.lv)} ${t('daysLeave')}`, 'good')}${kpi(t('lateDays'), nf(tot.late), '', tot.late ? 'warn' : '')}${kpi(t('absentDays'), nf(tot.abs), '', tot.abs ? 'bad' : '')}${kpi(t('hoursWorked'), hh(tot.w), `${t('overtime')}: ${hh(tot.ot)} ${t('h')}`, 'info')}</div>`;
  const ts = `<section class="card sect"><h3>${esc(t('timesheet'))}: ${esc(nm(e))} <small class="muted">${esc(fmonth(month))}</small></h3><div class="tbl-wrap"><table class="tbl ts"><thead><tr><th>${esc(t('date'))}</th><th>${esc(t('status'))}</th><th>${esc(t('in'))}</th><th>${esc(t('out'))}</th><th>${esc(t('worked'))}</th><th>${esc(t('late'))}</th><th>${esc(t('overtime'))}</th></tr></thead><tbody>${rows.filter((d) => d.s !== 'na' && d.s !== 'upcoming').reverse().map((d) => `<tr class="${['weekend', 'holiday'].includes(d.s) && !d.in ? 'dim' : ''}"><td data-l="${esc(t('date'))}"><b>${esc(wday(d.date))}</b> ${esc(fdate(d.date))}</td><td data-l="${esc(t('status'))}">${badge(d.s, stLabel(d))}${d.open ? ` <span class="tag warnt">${esc(t('missingOut'))}</span>` : ''}${d.extra && d.in ? ` <span class="tag">${esc(t('extraDay'))}</span>` : ''}${d.src === 'manual' ? ` <span class="tag">${esc(t('src_manual'))}</span>` : d.src === 'offline' ? ` <span class="tag">${esc(t('src_offline'))}</span>` : ''}</td><td class="num" data-l="${esc(t('in'))}">${tm(d.in)}</td><td class="num" data-l="${esc(t('out'))}">${tm(d.out)}</td><td class="num" data-l="${esc(t('worked'))}">${hm(d.w)}</td><td class="num ${d.late ? 'neg' : ''}" data-l="${esc(t('late'))}">${d.late ? hm(d.late) : '-'}</td><td class="num" data-l="${esc(t('overtime'))}">${hm(d.ot)}</td></tr>`).join('') || `<tr><td colspan="7" class="muted">${esc(t('noRecords'))}</td></tr>`}</tbody></table></div></section>`;
  return `${board}${tools}${sums}${ts}`;
}

function leave() {
  const b = S.balances[S.me.id]; const mine = S.leaves.filter((l) => l.empId === S.me.id);
  const unpaid = mine.filter((l) => l.type === 'unpaid' && l.status === 'approved').reduce((a, l) => a + l.days, 0);
  const cards = `<div class="kpis">${['annual', 'casual', 'sick'].map((k) => `<div class="kpi ${k === 'annual' ? 'good' : k === 'casual' ? 'info' : ''}"><small>${esc(t(k))}</small><b>${nf(b[k].available)}<small>/${nf(b[k].ent)}</small></b><span>${nf(b[k].used)} ${t('used')}${b[k].pending ? ` · ${nf(b[k].pending)} ${t('pendingShort')}` : ''}</span></div>`).join('')}${kpi(t('unpaid'), nf(unpaid), t('daysTaken'))}</div>`;
  const tbl = `<section class="card sect"><h3>${esc(t('myRequests'))}<span class="grow"></span><button class="btn primary" data-act="newleave">${ic('plus')}<span>${esc(t('requestLeave'))}</span></button></h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('type'))}</th><th>${esc(t('dates'))}</th><th>${esc(t('days'))}</th><th>${esc(t('status'))}</th><th>${esc(t('details'))}</th><th></th></tr></thead><tbody>${mine.map((l) => `<tr><td data-l="${esc(t('type'))}"><b>${esc(t(l.type))}</b></td><td data-l="${esc(t('dates'))}">${esc(dayStr(l))}</td><td class="num" data-l="${esc(t('days'))}">${nf(l.days)}</td><td data-l="${esc(t('status'))}">${lstat(l.status)}</td><td class="muted" data-l="${esc(t('details'))}">${esc(l.status === 'rejected' || l.note ? `${nm(emp(l.decidedBy))}: ${l.note}` : l.reason)}</td><td>${l.status === 'pending' || (l.status === 'approved' && l.from > nowParts().date) ? `<button class="btn ghost sm" data-act="cancel" data-id="${l.id}">${esc(t('cancelReq'))}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">${esc(t('noRequests'))}</td></tr>`}</tbody></table></div><p class="muted hint">${esc(t('balanceNote'))}</p></section>`;
  const team = role() !== 'employee' ? `<section class="card sect"><h3>${esc(t('teamBalances'))}</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('employee'))}</th>${['annual', 'casual', 'sick'].map((k) => `<th>${esc(t(k))}</th>`).join('')}</tr></thead><tbody>${S.teamIds.map((i) => `<tr><td>${person(emp(i))}</td>${['annual', 'casual', 'sick'].map((k) => `<td class="num">${nf(S.balances[i][k].available)} <small class="muted">/ ${nf(S.balances[i][k].ent)}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div></section>` : '';
  return cards + tbl + team;
}

function approvals() {
  const pend = S.leaves.filter((l) => l.status === 'pending' && canDecide(emp(l.empId)));
  const hist = S.leaves.filter((l) => l.status !== 'pending' && l.empId !== S.me.id).slice(0, 12);
  const card = (l) => { const e = emp(l.empId); const bal = S.balances[l.empId]?.[l.type]; const clash = S.outCal.filter((o) => o.empId !== l.empId && o.from <= l.to && l.from <= o.to).map((o) => nm(emp(o.empId)));
    const sameTeam = S.leaves.filter((x) => x.id !== l.id && x.status === 'pending' && x.empId !== l.empId && x.from <= l.to && l.from <= x.to).map((x) => nm(emp(x.empId)));
    return `<article class="card req"><div class="grow">${person(e)}<dl class="facts"><div><dt>${esc(t('type'))}</dt><dd>${esc(t(l.type))}</dd></div><div><dt>${esc(t('dates'))}</dt><dd>${esc(dayStr(l))}</dd></div><div><dt>${esc(t('days'))}</dt><dd>${nf(l.days)}</dd></div><div><dt>${esc(t('balanceAfter'))}</dt><dd>${bal ? nf(bal.available + 0) + ` / ${nf(bal.ent)}` : t('noLimit')}</dd></div>${l.reason ? `<div class="wide"><dt>${esc(t('reason'))}</dt><dd>${esc(l.reason)}</dd></div>` : ''}</dl>${clash.length || sameTeam.length ? `<p class="warnline">${esc(t('alsoOut'))}: ${esc([...new Set([...clash, ...sameTeam])].join(', '))}</p>` : ''}</div><div class="req-a"><button class="btn good" data-act="approve" data-id="${l.id}">${ic('approvals')}<span>${esc(t('approve'))}</span></button><button class="btn danger" data-act="reject" data-id="${l.id}">${ic('x')}<span>${esc(t('reject'))}</span></button></div></article>`; };
  return `<section class="sect"><h3>${esc(t('pendingApprovals'))} ${pend.length ? `<em class="cnt">${nf(pend.length)}</em>` : ''}</h3>${pend.length ? `<div class="reqs">${pend.map(card).join('')}</div>` : `<div class="card pad empty">${esc(t('allClear'))}</div>`}</section>
  <section class="card sect"><h3>${esc(t('history'))}</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('employee'))}</th><th>${esc(t('type'))}</th><th>${esc(t('dates'))}</th><th>${esc(t('status'))}</th><th>${esc(t('decidedBy'))}</th></tr></thead><tbody>${hist.map((l) => `<tr><td>${person(emp(l.empId), '')}</td><td>${esc(t(l.type))}</td><td>${esc(dayStr(l))} <small class="muted">(${nf(l.days)})</small></td><td>${lstat(l.status)}</td><td class="muted">${esc(nm(emp(l.decidedBy)))}${l.note ? `: ${esc(l.note)}` : ''}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">${esc(t('noRequests'))}</td></tr>`}</tbody></table></div></section>`;
}

function calendar() {
  const np = nowParts(); const cm = calMonth || np.date.slice(0, 7); calMonth = cm;
  const first = cm + '-01'; const dim = new Date(Date.UTC(+cm.slice(0, 4), +cm.slice(5), 0)).getUTCDate(); const lead = new Date(first + 'T00:00:00Z').getUTCDay();
  const cells = []; for (let i = 0; i < lead; i++) cells.push(null); for (let d = 1; d <= dim; d++) cells.push(cm + '-' + String(d).padStart(2, '0'));
  while (cells.length % 7) cells.push(null);
  const wk = S.settings.weekend; const hol = (d) => S.settings.holidays.find((h) => h.date === d);
  const names = [...Array(7)].map((_, i) => wday(addDays('2026-11-22', i)));
  const out = (d) => S.outCal.filter((o) => o.from <= d && d <= o.to && !wk.includes(new Date(d + 'T00:00:00Z').getUTCDay()) && !hol(d) && emp(o.empId)?.active);
  return `<section class="card"><div class="calhead"><button class="icon-btn" data-act="cal" data-d="-1" aria-label="${esc(t('prev'))}">${ic(lang === 'ar' ? 'right' : 'left')}</button><h3>${esc(fmonth(cm))}</h3><button class="icon-btn" data-act="cal" data-d="1" aria-label="${esc(t('next'))}">${ic(lang === 'ar' ? 'left' : 'right')}</button><span class="grow"></span><button class="btn ghost sm" data-act="cal" data-d="0">${esc(t('today'))}</button></div>
  <div class="cal" role="grid"><div class="cal-h">${names.map((n, i) => `<span class="${wk.includes(i) ? 'we' : ''}">${esc(n)}</span>`).join('')}</div><div class="cal-g">${cells.map((d, i) => { if (!d) return '<div class="cc void"></div>'; const o = out(d); const h = hol(d); const isWe = wk.includes(i % 7);
    return `<div class="cc ${isWe ? 'we' : ''} ${h ? 'hol' : ''} ${d === np.date ? 'now' : ''}" role="gridcell"><b>${dg(+d.slice(8))}</b>${h ? `<small class="hn">${esc(lang === 'ar' && h.nameAr ? h.nameAr : h.name)}</small>` : ''}<div class="chips2">${o.slice(0, 3).map((x) => `<span class="ch ${x.type || 'x'}" title="${esc(nm(emp(x.empId)))}${x.type ? ' (' + esc(t(x.type)) + ')' : ''}">${esc(nm(emp(x.empId)).split(' ')[0])}</span>`).join('')}${o.length > 3 ? `<span class="ch more">+${nf(o.length - 3)}</span>` : ''}</div></div>`; }).join('')}</div></div>
  <div class="legend">${LT.map((k) => `<span><i class="dot ${k}"></i>${esc(t(k))}</span>`).join('')}<span><i class="dot hol"></i>${esc(t('holiday'))}</span></div><p class="muted hint">${esc(role() === 'employee' ? t('calNoteEmp') : t('calNote'))}</p></section>`;
}

function people() {
  return `<div class="toolbar"><span class="grow muted">${nf(S.employees.filter((e) => e.active).length)} ${esc(t('activeStaff'))}</span><button class="btn primary" data-act="newemp">${ic('plus')}<span>${esc(t('addEmployee'))}</span></button></div>
  <section class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('employee'))}</th><th>${esc(t('dept'))}</th><th>${esc(t('role'))}</th><th>${esc(t('manager'))}</th><th>${esc(t('shift'))}</th><th>${esc(t('salary'))}</th><th>${esc(t('annual'))}</th><th></th></tr></thead><tbody>${S.employees.filter((e) => e.active).map((e) => { const b = S.balances[e.id]?.annual; return `<tr><td>${person(e)}</td><td>${esc(v(e.dept))}</td><td><span class="badge role-${e.role}">${esc(t('role_' + e.role))}</span></td><td>${esc(e.managerId ? nm(emp(e.managerId)) : '-')}</td><td>${esc(shiftName(shift(e.shiftId)))}</td><td class="num">${money(e.salary)}</td><td class="num">${b ? nf(b.available) + ` / ${nf(b.ent)}` : '-'}</td><td class="acts"><button class="icon-btn" data-act="editemp" data-id="${e.id}" aria-label="${esc(t('edit'))} ${esc(nm(e))}">${ic('edit')}</button>${e.id !== S.me.id ? `<button class="icon-btn" data-act="offemp" data-id="${e.id}" aria-label="${esc(t('deactivate'))} ${esc(nm(e))}">${ic('trash')}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></section>`;
}

function payroll() {
  const p = S.payroll; const np = nowParts();
  const hdr = ['employee', 'baseSalary', 'daysPresent', 'absentDays', 'unpaidDays', 'lateMin', 'overtime', 'dedTotal', 'otPay', 'net'];
  return `<div class="toolbar"><label class="inl"><span class="muted">${esc(t('month'))}</span><input type="month" id="month" value="${p.month}" max="${np.date.slice(0, 7)}"></label><span class="grow"></span><button class="btn" data-act="csv">${ic('download')}<span>${esc(t('exportCsv'))}</span></button></div>
  ${p.partial ? `<p class="warnline">${esc(t('partialMonth'))}</p>` : ''}
  <div class="kpis">${kpi(t('baseSalary'), money(p.totals.base))}${kpi(t('dedTotal'), money(p.totals.dAbsent + p.totals.dUnpaid + p.totals.dLate), `${t('absentDays')} ${money(p.totals.dAbsent)}`, 'warn')}${kpi(t('otPay'), money(p.totals.otPay), '', 'info')}${kpi(t('netTotal'), money(p.totals.net), `${nf(p.rows.length)} ${t('staff')}`, 'good')}</div>
  <section class="card"><div class="tbl-wrap"><table class="tbl pay"><thead><tr>${hdr.map((h) => `<th>${esc(t(h))}</th>`).join('')}</tr></thead><tbody>${p.rows.map((r) => { const e = emp(r.empId); return `<tr><td>${person(e)}</td><td class="num">${money(r.base)}</td><td class="num">${nf(r.present)} <small class="muted">/ ${nf(r.scheduled)}</small></td><td class="num ${r.absent ? 'neg' : ''}">${nf(r.absent)}</td><td class="num">${nf(r.unpaidLeave)}</td><td class="num">${nf(r.lateMin)}</td><td class="num">${hh(r.otMin)}</td><td class="num neg">${r.dAbsent + r.dUnpaid + r.dLate ? '-' + money(r.dAbsent + r.dUnpaid + r.dLate) : '-'}</td><td class="num pos">${r.otPay ? '+' + money(r.otPay) : '-'}</td><td class="num"><b>${money(r.net)}</b></td></tr>`; }).join('')}</tbody><tfoot><tr><td>${esc(t('total'))}</td><td class="num">${money(p.totals.base)}</td><td colspan="5"></td><td class="num neg">-${money(p.totals.dAbsent + p.totals.dUnpaid + p.totals.dLate)}</td><td class="num pos">+${money(p.totals.otPay)}</td><td class="num"><b>${money(p.totals.net)}</b></td></tr></tfoot></table></div></section>
  <section class="card sect"><h3>${esc(t('howCalc'))}</h3><ul class="notes"><li>${esc(t('calc1'))}</li><li>${esc(t('calc2'))}</li><li>${esc(t('calc3'))}</li><li>${esc(t('calc4'))}</li></ul><p class="warnline">${esc(t('payLimit'))}</p></section>`;
}

function settings() {
  return `<div class="grid2 b"><section class="card"><h3>${esc(t('shifts'))}<span class="grow"></span><button class="btn sm" data-act="newshift">${ic('plus')}<span>${esc(t('add'))}</span></button></h3><table class="tbl"><thead><tr><th>${esc(t('shift'))}</th><th>${esc(t('hours'))}</th><th>${esc(t('grace'))}</th><th>${esc(t('staff'))}</th><th></th></tr></thead><tbody>${S.shifts.map((s) => `<tr><td><b>${esc(shiftName(s))}</b></td><td class="num">${tm(s.start)} - ${tm(s.end)}</td><td class="num">${nf(s.grace)} ${esc(t('min'))}</td><td class="num">${nf(S.employees.filter((e) => e.active && e.shiftId === s.id).length)}</td><td><button class="icon-btn" data-act="editshift" data-id="${s.id}" aria-label="${esc(t('edit'))}">${ic('edit')}</button></td></tr>`).join('')}</tbody></table><p class="muted hint">${esc(t('shiftNote'))}</p></section>
  <section class="card"><h3>${esc(t('holidays'))}</h3><ul class="feed">${S.settings.holidays.map((h) => `<li><span class="grow"><b>${esc(lang === 'ar' && h.nameAr ? h.nameAr : h.name)}</b><br><small class="muted">${esc(fdate(h.date, { day: 'numeric', month: 'long', year: 'numeric' }))}</small></span><button class="icon-btn" data-act="delhol" data-date="${h.date}" aria-label="${esc(t('delete'))}">${ic('trash')}</button></li>`).join('')}</ul>
  <form id="hform" class="inline h"><input type="date" name="date" required aria-label="${esc(t('date'))}"><input name="name" placeholder="${esc(t('holidayName'))}" required maxlength="60" aria-label="${esc(t('holidayName'))}"><button class="btn primary">${esc(t('add'))}</button></form><p class="muted hint">${esc(t('weekendNote'))}</p></section></div>
  <section class="card sect"><h3>${esc(t('aboutDemo'))}</h3><p>${esc(t('demoLimits'))}</p><button class="btn danger" data-act="reset">${esc(t('resetDemo'))}</button></section>`;
}

// ---------- modals ----------
function modal(title, body, onSubmit, okLabel) {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-act="close" aria-label="${esc(t('cancel'))}">${ic('x')}</button></header>${body}<p class="ferr" role="alert" hidden></p><footer><button type="button" class="btn" data-act="close">${esc(t('cancel'))}</button><button class="btn primary">${esc(okLabel || t('save'))}</button></footer></form>`;
  const f = m.firstElementChild; const first = f.querySelector('input,select,textarea'); if (first) first.focus();
  f.onsubmit = async (ev) => { ev.preventDefault(); const fd = Object.fromEntries(new FormData(f)); const ok = await onSubmit(fd, (msg) => { const er = $('.ferr', f); er.textContent = msg; er.hidden = false; }); if (ok) closeModal(); };
}
const closeModal = () => { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; };
const opts = (arr, sel) => arr.map(([val, label]) => `<option value="${esc(val)}" ${val === sel ? 'selected' : ''}>${esc(label)}</option>`).join('');
async function submitOp(o, ok, fail) { try { adopt(await call({ op: o })); toast(ok); render(); return true; } catch (e) { fail(e.http ? errMsg(e) : t('offline')); return false; } }

function leaveForm() {
  const np = nowParts(); const b = S.balances[S.me.id];
  modal(t('requestLeave'), `<div class="fgrid"><label class="wide">${esc(t('type'))}<select name="leaveType" id="lt">${LT.map((k) => `<option value="${k}">${esc(t(k))}${k !== 'unpaid' ? ` (${nf(b[k].available)} ${esc(t('daysLeft'))})` : ''}</option>`).join('')}</select></label>
  <label>${esc(t('from'))}<input type="date" name="from" id="lf" min="${addDays(np.date, -14)}" value="${np.date}" required></label><label>${esc(t('to'))}<input type="date" name="to" id="lto" value="${np.date}" required></label>
  <p class="wide muted" id="ldays" aria-live="polite"></p><label class="wide">${esc(t('reason'))}<textarea name="reason" rows="3" maxlength="300"></textarea></label></div>`,
  (f, fail) => submitOp({ type: 'leave.request', ...f }, t('requestSent'), fail), t('send'));
  const upd = () => { const a = $('#lf').value, z = $('#lto').value; if (!a || !z || a > z) { $('#ldays').textContent = ''; return; } let n = 0; for (let d = a; d <= z && n < 400; d = addDays(d, 1)) { const wd = new Date(d + 'T00:00:00Z').getUTCDay(); if (!S.settings.weekend.includes(wd) && !S.settings.holidays.some((h) => h.date === d)) n++; } $('#ldays').textContent = `${nf(n)} ${t('workingDays')}`; };
  $('#lf').onchange = () => { if ($('#lto').value < $('#lf').value) $('#lto').value = $('#lf').value; upd(); }; $('#lto').onchange = upd; upd();
}
function rejectForm(id) {
  const l = S.leaves.find((x) => x.id === id);
  modal(`${t('reject')}: ${nm(emp(l.empId))}`, `<label class="wide col1">${esc(t('rejectReason'))}<textarea name="note" rows="3" required minlength="3" maxlength="200"></textarea></label>`, (f, fail) => submitOp({ type: 'leave.decide', id, decision: 'reject', note: f.note }, t('rejected'), fail), t('reject'));
}
function fixForm(empId, date) {
  const e = emp(empId); const d = (S.days[empId] || []).find((x) => x.date === date) || {};
  modal(`${t('fixTitle')}: ${nm(e)}`, `<div class="fgrid"><label class="wide">${esc(t('date'))}<input type="date" name="date" value="${date}" max="${nowParts().date}" required></label><label>${esc(t('in'))}<input type="time" name="in" value="${d.in || ''}"></label><label>${esc(t('out'))}<input type="time" name="out" value="${d.out || ''}"></label><p class="wide muted">${esc(t('fixNote'))}</p></div>`,
    (f, fail) => submitOp({ type: 'att.set', empId, date: f.date, in: f.in, out: f.out }, t('saved'), fail));
}
function empForm(id) {
  const e = id ? emp(id) : { name: '', nameAr: '', title: '', dept: '', email: '', role: 'employee', managerId: S.me.id, shiftId: S.shifts[0].id, salary: 10000, hired: nowParts().date, ent: { annual: 21, casual: 6, sick: 10 } };
  const mgrs = S.employees.filter((x) => x.active && x.role !== 'employee' && x.id !== id);
  modal(id ? t('editEmployee') : t('addEmployee'), `<div class="fgrid"><label>${esc(t('name'))}<input name="name" value="${esc(e.name)}" required maxlength="60"></label><label>${esc(t('nameAr'))}<input name="nameAr" value="${esc(e.nameAr)}" maxlength="60" dir="rtl"></label>
  <label>${esc(t('jobTitle'))}<input name="title" value="${esc(e.title)}" maxlength="60"></label><label>${esc(t('dept'))}<input name="dept" value="${esc(e.dept)}" maxlength="40"></label>
  <label>${esc(t('email'))}<input type="email" name="email" value="${esc(e.email)}" maxlength="100"></label><label>${esc(t('hired'))}<input type="date" name="hired" value="${e.hired}" max="${nowParts().date}" required></label>
  <label>${esc(t('role'))}<select name="role">${opts(['employee', 'manager', 'admin'].map((r) => [r, t('role_' + r)]), e.role)}</select></label><label>${esc(t('manager'))}<select name="managerId"><option value="">-</option>${opts(mgrs.map((m) => [m.id, nm(m)]), e.managerId)}</select></label>
  <label>${esc(t('shift'))}<select name="shiftId">${opts(S.shifts.map((s) => [s.id, `${shiftName(s)} ${s.start}-${s.end}`]), e.shiftId)}</select></label><label>${esc(t('salary'))} (${esc(S.settings.currency)})<input type="number" name="salary" value="${e.salary}" min="0" max="10000000" step="100" required></label>
  ${['annual', 'casual', 'sick'].map((k) => `<label>${esc(t(k))} (${esc(t('days'))})<input type="number" name="ent_${k}" value="${e.ent[k]}" min="0" max="60" required></label>`).join('')}</div>`,
  (f, fail) => submitOp({ type: 'emp.save', emp: { id, name: f.name, nameAr: f.nameAr, title: f.title, dept: f.dept, email: f.email, hired: f.hired, role: f.role, managerId: f.managerId || null, shiftId: f.shiftId, salary: Number(f.salary), ent: { annual: Number(f.ent_annual), casual: Number(f.ent_casual), sick: Number(f.ent_sick) } } }, t('saved'), fail));
}
function shiftForm(id) {
  const s = id ? shift(id) : { name: '', nameAr: '', start: '09:00', end: '17:00', grace: 10 };
  modal(id ? t('editShift') : t('newShift'), `<div class="fgrid"><label>${esc(t('name'))}<input name="name" value="${esc(s.name)}" required maxlength="30"></label><label>${esc(t('nameAr'))}<input name="nameAr" value="${esc(s.nameAr)}" maxlength="30" dir="rtl"></label><label>${esc(t('startTime'))}<input type="time" name="start" value="${s.start}" required></label><label>${esc(t('endTime'))}<input type="time" name="end" value="${s.end}" required></label><label class="wide">${esc(t('grace'))} (${esc(t('min'))})<input type="number" name="grace" value="${s.grace}" min="0" max="60" required></label></div>`,
    (f, fail) => submitOp({ type: 'shift.save', shift: { id, name: f.name, nameAr: f.nameAr, start: f.start, end: f.end, grace: Number(f.grace) } }, t('saved'), fail));
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) { if (e.target.id === 'modal') closeModal(); if (e.target.id === 'scrim') document.body.classList.remove('nav-open'); return; }
  const d = b.dataset; const a = d.act;
  if (a === 'lang') { lang = lang === 'ar' ? 'en' : 'ar'; localStorage.setItem('dw_lang', lang); render(); }
  else if (a === 'retry') { if (await load()) render(); }
  else if (a === 'sync') { flush(); }
  else if (a === 'punch') punch(d.type);
  else if (a === 'close') closeModal();
  else if (a === 'newleave') leaveForm();
  else if (a === 'approve') op({ type: 'leave.decide', id: d.id, decision: 'approve' }, t('approved'));
  else if (a === 'reject') rejectForm(d.id);
  else if (a === 'cancel') { if (confirm(t('confirmCancel'))) op({ type: 'leave.cancel', id: d.id }, t('cancelled')); }
  else if (a === 'fix') fixForm(d.emp, d.date);
  else if (a === 'newemp') empForm();
  else if (a === 'editemp') empForm(d.id);
  else if (a === 'offemp') { if (confirm(t('confirmOff'))) op({ type: 'emp.deactivate', id: d.id }, t('saved')); }
  else if (a === 'newshift') shiftForm();
  else if (a === 'editshift') shiftForm(d.id);
  else if (a === 'delhol') op({ type: 'holiday.remove', date: d.date }, t('saved'));
  else if (a === 'reset') { if (confirm(t('confirmReset'))) op({ type: 'demo.reset' }, t('resetDone')); }
  else if (a === 'cal') { const base = calMonth || nowParts().date.slice(0, 7); const n = Number(d.d); if (!n) calMonth = nowParts().date.slice(0, 7); else { const dt = new Date(Date.UTC(+base.slice(0, 4), +base.slice(5, 7) - 1 + n, 1)); calMonth = dt.toISOString().slice(0, 7); } render(); }
  else if (a === 'csv') csv();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); document.body.classList.remove('nav-open'); } });
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); $('#view').focus({ preventScroll: true }); });

function after() {
  const m = $('#month'); if (m) m.onchange = async (e) => { if (!e.target.value) return; month = e.target.value; if (await load()) render(); };
  const se = $('#selemp'); if (se) se.onchange = (e) => { selEmp = e.target.value; render(); };
  const hf = $('#hform'); if (hf) hf.onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(hf)); await op({ type: 'holiday.add', date: f.date, name: f.name }, t('saved')); };
}
function csv() {
  const p = S.payroll; const cols = ['Employee', 'Base', 'Scheduled days', 'Present days', 'Absent days', 'Unpaid leave days', 'Late minutes', 'Overtime minutes', 'Absence deduction', 'Unpaid leave deduction', 'Late deduction', 'Overtime pay', 'Net'];
  const q = (x) => `"${String(x).replace(/"/g, '""')}"`;
  const lines = [cols.map(q).join(',')].concat(p.rows.map((r) => [emp(r.empId).name, r.base, r.scheduled, r.present, r.absent, r.unpaidLeave, r.lateMin, r.otMin, r.dAbsent, r.dUnpaid, r.dLate, r.otPay, r.net].map(q).join(',')));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv' })); a.download = `payroll-${p.month}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

(async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  await flush();
  if (await load()) { if (!S.employees.some((x) => x.id === as && x.active)) { as = S.me.id; } render(); }
  setInterval(() => { if (document.visibilityState === 'visible' && !$('#modal').children.length && route()[0] === '') { load().then((ok) => ok && render()); } }, 60000);
})();
