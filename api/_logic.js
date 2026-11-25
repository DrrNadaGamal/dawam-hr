// Pure business logic for Dawam (HR, leave and attendance). Shared by the API, the dev server and the tests.
// No I/O here. Dates are 'YYYY-MM-DD' strings, times are 'HH:MM' strings in the company time zone.
export const DAY = 86400000;
export const ROLES = ['admin', 'manager', 'employee'];
export const LEAVE_TYPES = { annual: { days: 21, paid: true }, casual: { days: 6, paid: true }, sick: { days: 10, paid: true }, unpaid: { days: null, paid: false } };
export const ENTITLED = ['annual', 'casual', 'sick'];

export const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (s, n) => ymd(Date.parse(s + 'T00:00:00Z') + n * DAY);
export const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
export const dow = (s) => new Date(s + 'T00:00:00Z').getUTCDay();
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && ymd(Date.parse(s + 'T00:00:00Z')) === s;
export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s));
export const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
export const fromMin = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
function lastDay(ym) { const [y, m] = ym.split('-').map(Number); return ymd(Date.UTC(y, m, 0)); }
export const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s));
const r2 = (n) => Math.round(n * 100) / 100;
export const clampStr = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const rid = (p) => p + Math.random().toString(36).slice(2, 9);

// Wall-clock date and time in the company time zone for a UTC timestamp.
export function localParts(ms, tz = 'Africa/Cairo') {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`; return { date, today: date, time: `${p.hour}:${p.minute}` };
}

// ---------- calendar rules ----------
export const holidayOf = (st, d) => st.settings.holidays.find((h) => h.date === d) || null;
export const isWorkday = (st, d) => !st.settings.weekend.includes(dow(d)) && !holidayOf(st, d);
export function workdaysBetween(st, from, to) {
  let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(st, d)) n++; return n;
}
export const emp = (st, id) => st.employees.find((e) => e.id === id);
export const shiftOf = (st, e) => st.shifts.find((s) => s.id === e.shiftId) || st.shifts[0];
export const canSee = (a, e) => a.role === 'admin' || a.id === e.id || e.managerId === a.id;
export const canDecide = (a, e) => a.id !== e.id && (a.role === 'admin' || e.managerId === a.id);
const overlaps = (a, b) => a.from <= b.to && b.from <= a.to;
const approvedOn = (st, empId, d) => st.leaves.find((l) => l.empId === empId && l.status === 'approved' && l.from <= d && d <= l.to);

// ---------- leave balances ----------
export function balances(st, e, year) {
  const out = {};
  for (const t of ENTITLED) {
    const ent = e.ent[t] ?? LEAVE_TYPES[t].days;
    const mine = st.leaves.filter((l) => l.empId === e.id && l.type === t && l.from.slice(0, 4) === String(year));
    const used = mine.filter((l) => l.status === 'approved').reduce((a, l) => a + l.days, 0);
    const pending = mine.filter((l) => l.status === 'pending').reduce((a, l) => a + l.days, 0);
    out[t] = { ent, used, pending, available: ent - used - pending };
  }
  return out;
}

// ---------- attendance ----------
export function dayInfo(st, e, d, ctx) {
  const sh = shiftOf(st, e); const rec = st.attendance[e.id + '|' + d];
  const work = isWorkday(st, d);
  const base = { date: d, s: 'na', in: null, out: null, w: 0, late: 0, ot: 0, src: null, open: false };
  if (d < e.hired) return base;
  if (rec) {
    const w = rec.out ? toMin(rec.out) - toMin(rec.in) : 0;
    const late = work && toMin(rec.in) > toMin(sh.start) + sh.grace ? toMin(rec.in) - toMin(sh.start) : 0;
    let ot = 0;
    if (rec.out) ot = work ? (toMin(rec.out) - toMin(sh.end) >= st.settings.otAfter ? toMin(rec.out) - toMin(sh.end) : 0) : w;
    return { ...base, s: late ? 'late' : 'present', in: rec.in, out: rec.out || null, w, late, ot, src: rec.src, open: !rec.out && d < ctx.today, extra: !work };
  }
  const lv = approvedOn(st, e.id, d);
  if (lv && work) return { ...base, s: 'leave', leaveType: lv.type };
  if (holidayOf(st, d)) return { ...base, s: 'holiday' };
  if (!work) return { ...base, s: 'weekend' };
  if (d > ctx.today) return { ...base, s: 'upcoming' };
  if (d === ctx.today) return { ...base, s: ctx.time <= fromMin(Math.min(1439, toMin(sh.start) + sh.grace)) ? 'notYet' : 'notIn' };
  return { ...base, s: 'absent' };
}

const stamp = (st, actor, kind, data = {}, ms) => { st.log.unshift({ ts: ms, actor, kind, ...data }); st.log.length = Math.min(st.log.length, 80); };

// A client may send the moment a check-in happened (offline sync). Accept only a believable moment.
function momentOf(op, nowMs) {
  const at = op.at == null ? nowMs : Number(op.at);
  if (!Number.isFinite(at)) throw new Error('bad time');
  if (at > nowMs + 2 * 60000) throw new Error('time in the future');
  if (at < nowMs - 36 * 3600000) throw new Error('too old to sync');
  return at;
}

export function applyOp(st, actorId, op, nowMs = Date.now()) {
  const actor = emp(st, actorId);
  if (!actor || !actor.active) throw new Error('unknown user');
  const ctx = localParts(nowMs, st.settings.tz);
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  switch (op.type) {
    case 'att.in': case 'att.out': {
      const at = momentOf(op, nowMs); const lp = localParts(at, st.settings.tz);
      const key = actor.id + '|' + lp.date; const rec = st.attendance[key];
      const src = op.at == null || nowMs - at < 120000 ? 'web' : 'offline';
      if (op.type === 'att.in') {
        need(!rec, 'already checked in');
        need(!approvedOn(st, actor.id, lp.date) || !isWorkday(st, lp.date), 'on approved leave');
        st.attendance[key] = { in: lp.time, out: null, src };
        stamp(st, actor.id, 'in', { emp: actor.id, time: lp.time, src }, nowMs);
      } else {
        need(rec && !rec.out, 'no open check-in');
        need(toMin(lp.time) > toMin(rec.in), 'check-out must be after check-in');
        rec.out = lp.time; if (src === 'offline') rec.src = 'offline';
        stamp(st, actor.id, 'out', { emp: actor.id, time: lp.time, src }, nowMs);
      }
      return;
    }
    case 'att.set': {
      const e = emp(st, op.empId); need(e, 'unknown employee');
      need(canSee(actor, e) && actor.id !== e.id && actor.role !== 'employee', 'not allowed');
      need(isDate(op.date) && op.date <= ctx.today && op.date >= addDays(ctx.today, -62), 'bad date');
      need(op.date >= e.hired, 'before hire date');
      const key = e.id + '|' + op.date;
      if (!op.in && !op.out) { delete st.attendance[key]; stamp(st, actor.id, 'clear', { emp: e.id, date: op.date }, nowMs); return; }
      need(isTime(op.in), 'bad check-in time'); need(!op.out || isTime(op.out), 'bad check-out time');
      need(!op.out || toMin(op.out) > toMin(op.in), 'check-out must be after check-in');
      st.attendance[key] = { in: op.in, out: op.out || null, src: 'manual' };
      stamp(st, actor.id, 'fix', { emp: e.id, date: op.date }, nowMs); return;
    }
    case 'leave.request': {
      const type = op.leaveType; need(LEAVE_TYPES[type], 'bad leave type');
      need(isDate(op.from) && isDate(op.to), 'bad date'); need(op.from <= op.to, 'end before start');
      need(op.from.slice(0, 4) === op.to.slice(0, 4), 'split requests across years');
      need(diffDays(op.from, op.to) < 60, 'too long (60 days max)');
      need(op.from >= ctx.today || (type === 'sick' && op.from >= addDays(ctx.today, -14)), 'start date is in the past');
      need(op.from >= actor.hired, 'before hire date');
      const days = workdaysBetween(st, op.from, op.to); need(days > 0, 'no working days in this range');
      const rng = { from: op.from, to: op.to };
      need(!st.leaves.some((l) => l.empId === actor.id && ['pending', 'approved'].includes(l.status) && overlaps(l, rng)), 'overlaps another request');
      if (LEAVE_TYPES[type].paid) need(balances(st, actor, op.from.slice(0, 4))[type].available >= days, 'not enough balance');
      const l = { id: rid('lv_'), empId: actor.id, type, from: op.from, to: op.to, days, reason: clampStr(op.reason, 300), status: 'pending', created: nowMs, decidedBy: null, decidedAt: null, note: '' };
      st.leaves.push(l); stamp(st, actor.id, 'request', { emp: actor.id, type, days }, nowMs); return;
    }
    case 'leave.decide': {
      const l = st.leaves.find((x) => x.id === op.id); need(l, 'request not found');
      const e = emp(st, l.empId); need(canDecide(actor, e), 'not allowed to decide this request');
      need(l.status === 'pending', 'already decided');
      if (op.decision === 'approve') {
        need(!st.leaves.some((x) => x !== l && x.empId === l.empId && x.status === 'approved' && overlaps(x, l)), 'overlaps an approved leave');
        l.status = 'approved';
      } else if (op.decision === 'reject') {
        need(clampStr(op.note, 200).length >= 3, 'a reason is required to reject'); l.status = 'rejected';
      } else throw new Error('bad decision');
      l.decidedBy = actor.id; l.decidedAt = nowMs; l.note = clampStr(op.note, 200);
      stamp(st, actor.id, l.status, { emp: e.id, type: l.type, days: l.days }, nowMs); return;
    }
    case 'leave.cancel': {
      const l = st.leaves.find((x) => x.id === op.id); need(l, 'request not found');
      need(l.empId === actor.id || actor.role === 'admin', 'not allowed');
      need(l.status === 'pending' || (l.status === 'approved' && l.from > ctx.today), 'only pending or future leave can be cancelled');
      l.status = 'cancelled'; stamp(st, actor.id, 'cancel', { emp: l.empId, type: l.type, days: l.days }, nowMs); return;
    }
    case 'emp.save': {
      need(actor.role === 'admin', 'admin only');
      const x = op.emp || {}; const name = clampStr(x.name, 60); need(name.length >= 2, 'name required');
      const email = clampStr(x.email, 100); need(!email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'invalid email');
      need(ROLES.includes(x.role), 'bad role'); need(st.shifts.some((s) => s.id === x.shiftId), 'bad shift');
      const salary = Number(x.salary); need(Number.isFinite(salary) && salary >= 0 && salary <= 1e7, 'bad salary');
      const hired = isDate(x.hired) ? x.hired : ctx.today; need(hired <= ctx.today, 'hire date is in the future');
      const old = x.id && emp(st, x.id); need(!x.id || old, 'unknown employee');
      const mid = x.managerId || null; need(!mid || emp(st, mid), 'unknown manager');
      if (old) { need(mid !== old.id, 'a person cannot manage themselves'); for (let c = mid && emp(st, mid); c; c = c.managerId && emp(st, c.managerId)) need(c.id !== old.id, 'manager loop'); }
      if (old && old.role === 'admin' && x.role !== 'admin') need(st.employees.some((q) => q.id !== old.id && q.role === 'admin' && q.active), 'keep at least one admin');
      const ent = {}; for (const t of ENTITLED) { const v = Number(x.ent?.[t] ?? LEAVE_TYPES[t].days); need(Number.isFinite(v) && v >= 0 && v <= 60, 'bad leave entitlement'); ent[t] = v; }
      const rec = { id: old ? old.id : rid('e_'), name, nameAr: clampStr(x.nameAr, 60), title: clampStr(x.title, 60), dept: clampStr(x.dept, 40), email, role: x.role, managerId: mid, shiftId: x.shiftId, salary, hired, ent, active: old ? old.active : true };
      if (old) Object.assign(old, rec); else st.employees.push(rec);
      stamp(st, actor.id, old ? 'empEdit' : 'empAdd', { emp: rec.id }, nowMs); return;
    }
    case 'emp.deactivate': {
      need(actor.role === 'admin', 'admin only'); const e = emp(st, op.id); need(e, 'unknown employee'); need(e.id !== actor.id, 'you cannot deactivate yourself');
      if (e.role === 'admin') need(st.employees.some((q) => q.id !== e.id && q.role === 'admin' && q.active), 'keep at least one admin');
      e.active = false; st.leaves.forEach((l) => { if (l.empId === e.id && l.status === 'pending') l.status = 'cancelled'; });
      st.employees.forEach((q) => { if (q.managerId === e.id) q.managerId = e.managerId || null; });
      stamp(st, actor.id, 'empOff', { emp: e.id }, nowMs); return;
    }
    case 'shift.save': {
      need(actor.role === 'admin', 'admin only'); const s = op.shift || {}; const name = clampStr(s.name, 30); need(name, 'name required');
      need(isTime(s.start) && isTime(s.end) && toMin(s.end) > toMin(s.start), 'end must be after start');
      const grace = Number(s.grace); need(Number.isInteger(grace) && grace >= 0 && grace <= 60, 'grace must be 0 to 60 minutes');
      const old = s.id && st.shifts.find((x) => x.id === s.id); need(!s.id || old, 'unknown shift');
      const rec = { id: old ? old.id : rid('s_'), name, nameAr: clampStr(s.nameAr, 30), start: s.start, end: s.end, grace };
      if (old) Object.assign(old, rec); else st.shifts.push(rec); stamp(st, actor.id, 'shift', {}, nowMs); return;
    }
    case 'holiday.add': {
      need(actor.role === 'admin', 'admin only'); need(isDate(op.date), 'bad date'); const name = clampStr(op.name, 60); need(name, 'name required');
      need(!holidayOf(st, op.date), 'already a holiday');
      st.settings.holidays.push({ date: op.date, name, nameAr: clampStr(op.nameAr, 60) }); st.settings.holidays.sort((a, b) => a.date.localeCompare(b.date));
      stamp(st, actor.id, 'holiday', {}, nowMs); return;
    }
    case 'holiday.remove': {
      need(actor.role === 'admin', 'admin only'); const n = st.settings.holidays.length;
      st.settings.holidays = st.settings.holidays.filter((h) => h.date !== op.date); need(st.settings.holidays.length < n, 'not found'); return;
    }
    case 'demo.reset': Object.assign(st, seed(nowMs)); return;
    default: throw new Error('unknown operation');
  }
}

// ---------- payroll ----------
// Simple, documented estimate. Not a legal payslip: no income tax, no social insurance.
export function payrollFor(st, e, month, ctx) {
  const sh = shiftOf(st, e); const first = month + '-01', last = lastDay(month);
  const from = e.hired > first ? e.hired : first; const to = last;
  const daysInMonth = Number(last.slice(8)); const empDays = from > last ? 0 : diffDays(from, last) + 1;
  const base = r2(e.salary * (empDays / daysInMonth));
  const shiftMin = toMin(sh.end) - toMin(sh.start); const daily = e.salary / 30; const perMin = daily / shiftMin;
  const r = { empId: e.id, base, scheduled: 0, present: 0, lateDays: 0, lateMin: 0, absent: 0, paidLeave: 0, unpaidLeave: 0, otMin: 0, openDays: 0 };
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isWorkday(st, d)) r.scheduled++;
    const i = dayInfo(st, e, d, ctx);
    if (i.s === 'present' || i.s === 'late') { if (!i.extra) r.present++; if (i.s === 'late') { r.lateDays++; r.lateMin += i.late; } r.otMin += i.ot; if (i.open) r.openDays++; }
    else if (i.s === 'absent') r.absent++;
    else if (i.s === 'leave') { if (LEAVE_TYPES[i.leaveType].paid) r.paidLeave++; else r.unpaidLeave++; }
  }
  r.dAbsent = r2(r.absent * daily); r.dUnpaid = r2(r.unpaidLeave * daily); r.dLate = r2(r.lateMin * perMin);
  r.otPay = r2((r.otMin / 60) * (daily / (shiftMin / 60)) * st.settings.otFactor);
  r.net = Math.max(0, r2(base - r.dAbsent - r.dUnpaid - r.dLate + r.otPay));
  return r;
}

export function payroll(st, month, ctx) {
  const rows = st.employees.filter((e) => e.active && e.hired <= lastDay(month)).map((e) => payrollFor(st, e, month, ctx));
  const sum = (k) => r2(rows.reduce((a, r) => a + r[k], 0));
  return { month, partial: month === ctx.today.slice(0, 7), rows, totals: { base: sum('base'), dAbsent: sum('dAbsent'), dUnpaid: sum('dUnpaid'), dLate: sum('dLate'), otPay: sum('otPay'), net: sum('net') } };
}

// ---------- the view each person is allowed to see ----------
export function view(st, actorId, opts = {}, nowMs = Date.now()) {
  const actor = emp(st, actorId) && emp(st, actorId).active ? emp(st, actorId) : st.employees.find((e) => e.active);
  const ctx = localParts(nowMs, st.settings.tz);
  const month = isMonth(opts.month) && opts.month <= ctx.today.slice(0, 7) ? opts.month : ctx.today.slice(0, 7);
  const vis = st.employees.filter((e) => e.active && canSee(actor, e));
  const team = vis.filter((e) => e.id !== actor.id);
  const year = ctx.today.slice(0, 4);
  const pub = (e) => ({ id: e.id, name: e.name, nameAr: e.nameAr, title: e.title, dept: e.dept, role: e.role, managerId: e.managerId, shiftId: e.shiftId, active: e.active, hired: e.hired });
  const employees = st.employees.map((e) => (actor.role === 'admin' || e.id === actor.id ? { ...pub(e), email: e.email, salary: e.salary, ent: e.ent } : pub(e)));
  const todayList = vis.map((e) => ({ empId: e.id, ...dayInfo(st, e, ctx.today, ctx) }));
  const count = (s) => todayList.filter((x) => s.includes(x.s)).length;
  const days = {}; const from = month + '-01'; const to = lastDay(month);
  for (const e of vis) { days[e.id] = []; for (let d = from; d <= to; d = addDays(d, 1)) days[e.id].push(dayInfo(st, e, d, ctx)); }
  const trend = []; if (actor.role !== 'employee') { for (let d = ctx.today, n = 0; n < 7 && d >= addDays(ctx.today, -40); d = addDays(d, -1)) { if (!isWorkday(st, d) || d === ctx.today) continue; n++; const c = { date: d, present: 0, late: 0, absent: 0, leave: 0 }; for (const e of vis) { const i = dayInfo(st, e, d, ctx); if (i.s === 'present') c.present++; else if (i.s === 'late') c.late++; else if (i.s === 'absent') c.absent++; else if (i.s === 'leave') c.leave++; } trend.unshift(c); } }
  const leaves = st.leaves.filter((l) => { const e = emp(st, l.empId); return e && canSee(actor, e); }).sort((a, b) => b.created - a.created);
  const outCal = st.leaves.filter((l) => l.status === 'approved' && l.to >= addDays(ctx.today, -40)).map((l) => { const e = emp(st, l.empId); return { id: l.id, empId: l.empId, from: l.from, to: l.to, type: canSee(actor, e) ? l.type : null }; });
  const pendingForMe = leaves.filter((l) => l.status === 'pending' && canDecide(actor, emp(st, l.empId)));
  return {
    serverNow: { ms: nowMs, date: ctx.today, time: ctx.time }, settings: st.settings, shifts: st.shifts,
    me: { id: actor.id, role: actor.role }, employees, balances: Object.fromEntries(vis.map((e) => [e.id, balances(st, e, year)])),
    leaves, outCal, pendingCount: pendingForMe.length, todayList, month, days, trend,
    stats: { headcount: vis.length, present: count(['present', 'late']), late: count(['late']), onLeave: count(['leave']), missing: count(['notIn', 'absent']), waiting: count(['notYet']) },
    payroll: actor.role === 'admin' ? payroll(st, month, ctx) : null,
    log: actor.role === 'admin' ? st.log.slice(0, 14) : [], resetAt: st.resetAt, teamIds: team.map((e) => e.id),
  };
}

// ---------- seed data (a made-up company, generated relative to "now") ----------
function rng(seedN) { let a = seedN >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function seed(nowMs = Date.now()) {
  const tz = 'Africa/Cairo'; const ctx = localParts(nowMs, tz); const T = ctx.today; const hired = addDays(T, -400);
  const E = (id, name, nameAr, title, dept, role, managerId, shiftId, salary, ent = {}) => ({ id, name, nameAr, title, dept, email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@nileworks.example', role, managerId, shiftId, salary, hired, active: true, ent: { annual: 21, casual: 6, sick: 10, ...ent } });
  const st = {
    resetAt: nowMs,
    settings: { company: 'Nile Works (demo company)', tz, weekend: [5, 6], currency: 'EGP', otFactor: 1.5, otAfter: 30, holidays: [
      { date: '2026-10-06', name: 'Armed Forces Day', nameAr: 'عيد القوات المسلحة' }, { date: '2026-12-03', name: 'Company day (demo)', nameAr: 'يوم الشركة (تجريبي)' },
      { date: '2027-01-07', name: 'Coptic Christmas', nameAr: 'عيد الميلاد المجيد' }, { date: '2027-01-25', name: 'January 25 holiday', nameAr: 'إجازة ٢٥ يناير' } ] },
    shifts: [{ id: 's1', name: 'Day', nameAr: 'نهاري', start: '09:00', end: '17:00', grace: 15 }, { id: 's2', name: 'Evening', nameAr: 'مسائي', start: '14:00', end: '22:00', grace: 10 }, { id: 's3', name: 'Early', nameAr: 'مبكر', start: '08:00', end: '16:00', grace: 15 }],
    employees: [
      E('e1', 'Hossam Fouad', 'حسام فؤاد', 'General Manager', 'Management', 'admin', null, 's1', 60000),
      E('e2', 'Mariam Hassan', 'مريم حسن', 'HR Manager', 'HR', 'admin', 'e1', 's1', 32000),
      E('e3', 'Omar Khaled', 'عمر خالد', 'Engineering Lead', 'Engineering', 'manager', 'e1', 's1', 38000),
      E('e4', 'Salma Adel', 'سلمى عادل', 'Operations Manager', 'Operations', 'manager', 'e1', 's1', 34000),
      E('e5', 'Youssef Nabil', 'يوسف نبيل', 'Frontend Developer', 'Engineering', 'employee', 'e3', 's1', 24000),
      E('e6', 'Nour El-Din', 'نور الدين', 'Backend Developer', 'Engineering', 'employee', 'e3', 's1', 26000),
      E('e7', 'Laila Mostafa', 'ليلى مصطفى', 'QA Engineer', 'Engineering', 'employee', 'e3', 's1', 20000),
      E('e8', 'Karim Samir', 'كريم سمير', 'Support Agent', 'Operations', 'employee', 'e4', 's2', 14000),
      E('e9', 'Hana Tarek', 'هنا طارق', 'Support Agent', 'Operations', 'employee', 'e4', 's2', 14000),
      E('e10', 'Ahmed Fathy', 'أحمد فتحي', 'Warehouse Coordinator', 'Operations', 'employee', 'e4', 's3', 12000),
      E('e11', 'Dina Ashraf', 'دينا أشرف', 'Accountant', 'Finance', 'employee', 'e2', 's1', 18000),
      E('e12', 'Mostafa Ragab', 'مصطفى رجب', 'Recruiter', 'HR', 'employee', 'e2', 's1', 16000),
    ],
    leaves: [], attendance: {}, log: [],
  };
  const L = (empId, type, from, to, status, reason, decidedBy, note = '') => {
    while (!isWorkday(st, from)) from = addDays(from, 1); while (!isWorkday(st, to)) to = addDays(to, -1); if (to < from) to = from;
    const days = workdaysBetween(st, from, to); st.leaves.push({ id: 'lv_s' + st.leaves.length, empId, type, from, to, days, reason, status, created: nowMs - (60 + st.leaves.length * 7) * 3600000, decidedBy: status === 'pending' ? null : decidedBy, decidedAt: status === 'pending' ? null : nowMs - 30 * 3600000, note }); };
  L('e5', 'annual', addDays(T, -26), addDays(T, -22), 'approved', 'Family trip', 'e3');
  L('e7', 'sick', addDays(T, -12), addDays(T, -11), 'approved', 'Flu', 'e3');
  L('e9', 'annual', addDays(T, -9), addDays(T, -7), 'approved', 'Moving flats', 'e4');
  L('e6', 'casual', addDays(T, -3), addDays(T, -3), 'approved', 'Personal errand', 'e3');
  L('e10', 'unpaid', addDays(T, -15), addDays(T, -14), 'approved', 'Family matter', 'e4');
  L('e11', 'annual', T, addDays(T, 2), 'approved', 'Short break', 'e2');
  L('e12', 'sick', T, T, 'approved', 'Dentist', 'e2');
  L('e8', 'annual', addDays(T, 9), addDays(T, 13), 'approved', 'Wedding', 'e4');
  L('e5', 'annual', addDays(T, 14), addDays(T, 18), 'pending', 'Holiday at the coast', null);
  L('e7', 'casual', addDays(T, 3), addDays(T, 3), 'pending', 'Bank appointment', null);
  L('e3', 'annual', addDays(T, 20), addDays(T, 24), 'pending', 'Conference travel and a few days off', null);
  L('e6', 'annual', addDays(T, -45), addDays(T, -40), 'rejected', 'Trip', 'e3', 'Release week, please pick another date.');
  const lv = (i) => st.leaves[i];
  const ev = (hoursAgo, kind, actor, e, extra = {}) => st.log.push({ ts: nowMs - hoursAgo * 3600000, actor, kind, emp: e, ...extra });
  ev(1.2, 'request', 'e7', 'e7', { type: 'casual', days: lv(9).days }); ev(5, 'request', 'e5', 'e5', { type: 'annual', days: lv(8).days }); ev(26, 'approved', 'e4', 'e8', { type: 'annual', days: lv(7).days });
  ev(27, 'approved', 'e2', 'e11', { type: 'annual', days: lv(5).days }); ev(30, 'request', 'e3', 'e3', { type: 'annual', days: lv(10).days }); ev(52, 'rejected', 'e3', 'e6', { type: 'annual', days: lv(11).days });
  const rand = rng(20261125); const jit = (a, b) => Math.round(a + rand() * (b - a));
  for (let d = addDays(T, -75); d <= T; d = addDays(d, 1)) {
    for (const e of st.employees) {
      const sh = shiftOf(st, e); const workday = isWorkday(st, d);
      if (!workday) { if (rand() < 0.015) st.attendance[e.id + '|' + d] = { in: fromMin(toMin(sh.start) + 20), out: fromMin(toMin(sh.start) + 20 + 200), src: 'web' }; continue; }
      if (approvedOn(st, e.id, d)) continue;
      if (e.id === 'e8' && rand() < 0.07) continue; // a person with a few unexcused absences
      if (rand() < 0.012) continue;
      let inM = toMin(sh.start) + jit(-22, 6); if (rand() < (e.id === 'e9' ? 0.3 : 0.1)) inM = toMin(sh.start) + sh.grace + jit(3, 40);
      let outM = toMin(sh.end) + jit(-6, 14); if (rand() < 0.14) outM = toMin(sh.end) + jit(35, 120);
      if (d === T) { const nowM = toMin(ctx.time); if (inM > nowM) continue; if (outM <= nowM) { st.attendance[e.id + '|' + d] = { in: fromMin(inM), out: fromMin(outM), src: 'web' }; continue; } st.attendance[e.id + '|' + d] = { in: fromMin(inM), out: null, src: 'web' }; continue; }
      st.attendance[e.id + '|' + d] = { in: fromMin(inM), out: fromMin(outM), src: rand() < 0.04 ? 'offline' : 'web' };
    }
  }
  return st;
}
