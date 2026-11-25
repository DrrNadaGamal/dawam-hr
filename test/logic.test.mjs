import assert from 'node:assert/strict';
import { applyOp, seed, view, payrollFor, dayInfo, balances, workdaysBetween, localParts, addDays, emp } from '../api/_logic.js';

const NOW = Date.parse('2026-11-25T08:00:00Z'); // 10:00 in Cairo, a Wednesday
const T = '2026-11-25';
const mk = () => seed(NOW);
const op = (s, who, o, at = NOW) => applyOp(s, who, o, at);
const fails = (s, who, o, re, at = NOW) => assert.throws(() => op(s, who, o, at), re);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('company time zone and Friday/Saturday weekend', () => {
  assert.deepEqual(localParts(NOW, 'Africa/Cairo').time, '10:00');
  const s = mk();
  assert.equal(workdaysBetween(s, '2026-11-22', '2026-11-28'), 5); // Sun..Thu
  assert.equal(workdaysBetween(s, '2026-12-01', '2026-12-04'), 2); // Dec 3 is a company holiday, Dec 4 is Friday
});

t('leave request: validation', () => {
  const s = mk();
  fails(s, 'e5', { type: 'leave.request', leaveType: 'nope', from: '2026-12-06', to: '2026-12-07' }, /bad leave type/);
  fails(s, 'e5', { type: 'leave.request', leaveType: 'annual', from: '2026-12-08', to: '2026-12-07' }, /end before start/);
  fails(s, 'e5', { type: 'leave.request', leaveType: 'annual', from: '2026-11-20', to: '2026-11-21' }, /in the past/);
  fails(s, 'e5', { type: 'leave.request', leaveType: 'annual', from: '2026-11-27', to: '2026-11-28' }, /no working days/); // Fri-Sat
  fails(s, 'e5', { type: 'leave.request', leaveType: 'annual', from: '2026-12-31', to: '2027-01-02' }, /across years/);
  fails(s, 'e5', { type: 'leave.request', leaveType: 'annual', from: '2026-12-01', to: '2026-12-10' }, /overlaps|balance/); // e5 has a pending Dec 9-13
});

t('leave request counts working days only, and pending days are reserved', () => {
  const s = mk(); const before = balances(s, emp(s, 'e12'), '2026').annual.available;
  op(s, 'e12', { type: 'leave.request', leaveType: 'annual', from: '2026-12-06', to: '2026-12-10', reason: 'x' });
  const l = s.leaves.at(-1); assert.equal(l.days, 5); // Sun to Thu
  assert.equal(balances(s, emp(s, 'e12'), '2026').annual.available, before - l.days);
});

t('no overlapping requests, no overspending of balance', () => {
  const s = mk();
  op(s, 'e7', { type: 'leave.request', leaveType: 'annual', from: '2026-12-20', to: '2026-12-22' });
  fails(s, 'e7', { type: 'leave.request', leaveType: 'casual', from: '2026-12-22', to: '2026-12-23' }, /overlaps/);
  const q = mk(); emp(q, 'e12').ent.casual = 1;
  fails(q, 'e12', { type: 'leave.request', leaveType: 'casual', from: '2026-12-14', to: '2026-12-15' }, /not enough balance/);
  op(q, 'e12', { type: 'leave.request', leaveType: 'unpaid', from: '2026-12-14', to: '2026-12-15' }); // unpaid has no balance
});

t('approval rights: manager of that person or admin, never yourself', () => {
  const s = mk(); op(s, 'e5', { type: 'leave.request', leaveType: 'annual', from: '2027-02-07', to: '2027-02-08' });
  const id = s.leaves.at(-1).id;
  fails(s, 'e5', { type: 'leave.decide', id, decision: 'approve' }, /not allowed/);
  fails(s, 'e4', { type: 'leave.decide', id, decision: 'approve' }, /not allowed/); // manager of another team
  fails(s, 'e3', { type: 'leave.decide', id, decision: 'reject', note: '' }, /reason is required/);
  op(s, 'e3', { type: 'leave.decide', id, decision: 'approve' });
  assert.equal(s.leaves.at(-1).status, 'approved'); assert.equal(s.leaves.at(-1).decidedBy, 'e3');
  fails(s, 'e2', { type: 'leave.decide', id, decision: 'reject', note: 'later' }, /already decided/);
  const own = mk(); op(own, 'e2', { type: 'leave.request', leaveType: 'annual', from: '2027-02-07', to: '2027-02-07' });
  fails(own, 'e2', { type: 'leave.decide', id: own.leaves.at(-1).id, decision: 'approve' }, /not allowed/); // an admin cannot approve their own
  op(own, 'e1', { type: 'leave.decide', id: own.leaves.at(-1).id, decision: 'approve' });
});

t('cancel rules', () => {
  const s = mk(); op(s, 'e12', { type: 'leave.request', leaveType: 'annual', from: '2027-02-07', to: '2027-02-07' });
  const id = s.leaves.at(-1).id;
  fails(s, 'e11', { type: 'leave.cancel', id }, /not allowed/);
  op(s, 'e12', { type: 'leave.cancel', id }); assert.equal(s.leaves.at(-1).status, 'cancelled');
  assert.equal(balances(s, emp(s, 'e12'), '2027').annual.pending, 0);
  const past = s.leaves.find((l) => l.empId === 'e5' && l.status === 'approved' && l.to < T);
  fails(s, 'e5', { type: 'leave.cancel', id: past.id }, /only pending or future/);
});

t('check in / out, double check-in, leave day, times in company zone', () => {
  const s = mk(); const k = 'e1|' + T;
  delete s.attendance[k];
  op(s, 'e1', { type: 'att.in' }); assert.equal(s.attendance[k].in, '10:00');
  fails(s, 'e1', { type: 'att.in' }, /already checked in/);
  fails(s, 'e1', { type: 'att.out' }, /after check-in/); // same minute
  op(s, 'e1', { type: 'att.out' }, NOW + 6 * 3600000); assert.equal(s.attendance[k].out, '16:00');
  fails(s, 'e1', { type: 'att.out' }, /no open check-in/, NOW + 6 * 3600000);
  const l = mk(); fails(l, 'e11', { type: 'att.in' }, /on approved leave/); // e11 is on leave today
});

t('offline sync: accepts a recent timestamp, rejects future and stale ones', () => {
  const s = mk(); delete s.attendance['e1|' + T];
  op(s, 'e1', { type: 'att.in', at: NOW - 3600000 }, NOW); // synced an hour later
  assert.equal(s.attendance['e1|' + T].in, '09:00'); assert.equal(s.attendance['e1|' + T].src, 'offline');
  fails(s, 'e2', { type: 'att.in', at: NOW + 10 * 60000 }, /future/);
  fails(s, 'e2', { type: 'att.in', at: NOW - 48 * 3600000 }, /too old/);
  fails(s, 'e2', { type: 'att.in', at: 'abc' }, /bad time/);
});

t('late, grace and overtime are computed from the shift', () => {
  const s = mk(); const e = emp(s, 'e5'); const ctx = localParts(NOW);
  const d = '2026-11-18'; // Wednesday
  s.attendance['e5|' + d] = { in: '09:15', out: '17:20', src: 'web' }; // inside grace, overtime under 30 min does not count
  let i = dayInfo(s, e, d, ctx); assert.equal(i.s, 'present'); assert.equal(i.ot, 0);
  s.attendance['e5|' + d] = { in: '09:16', out: '17:45', src: 'web' };
  i = dayInfo(s, e, d, ctx); assert.equal(i.s, 'late'); assert.equal(i.late, 16); assert.equal(i.ot, 45); assert.equal(i.w, 509);
  s.attendance['e5|2026-11-20'] = { in: '10:00', out: '12:00', src: 'web' }; // Friday: weekend work counts as overtime
  i = dayInfo(s, e, '2026-11-20', ctx); assert.equal(i.ot, 120); assert.equal(i.extra, true);
});

t('manual correction: manager of that person or admin, not for yourself', () => {
  const s = mk();
  op(s, 'e3', { type: 'att.set', empId: 'e5', date: '2026-11-18', in: '09:05', out: '17:00' }); assert.equal(s.attendance['e5|2026-11-18'].src, 'manual');
  fails(s, 'e3', { type: 'att.set', empId: 'e3', date: '2026-11-18', in: '09:00', out: '17:00' }, /not allowed/);
  fails(s, 'e5', { type: 'att.set', empId: 'e5', date: '2026-11-18', in: '09:00', out: '17:00' }, /not allowed/);
  fails(s, 'e4', { type: 'att.set', empId: 'e5', date: '2026-11-18', in: '09:00', out: '17:00' }, /not allowed/);
  fails(s, 'e2', { type: 'att.set', empId: 'e5', date: '2026-11-18', in: '17:00', out: '09:00' }, /after check-in/);
  fails(s, 'e2', { type: 'att.set', empId: 'e5', date: '2026-12-30', in: '09:00', out: '17:00' }, /bad date/);
});

t('payroll: absence, unpaid leave, lateness and overtime', () => {
  const s = mk(); const e = emp(s, 'e5'); e.salary = 30000; e.hired = '2025-01-01';
  for (const k of Object.keys(s.attendance)) if (k.startsWith('e5|')) delete s.attendance[k];
  s.leaves = s.leaves.filter((l) => l.empId !== 'e5');
  const ctx = localParts(Date.parse('2026-12-02T12:00:00Z')); // Dec 2, a Wednesday; we pay November
  // November 2026: workdays = Sun-Thu = 21 + ... build the month: present all days except known ones
  for (let d = '2026-11-01'; d <= '2026-11-30'; d = addDays(d, 1)) if (workdaysBetween(s, d, d) === 1) s.attendance['e5|' + d] = { in: '09:00', out: '17:00', src: 'web' };
  delete s.attendance['e5|2026-11-03'];                                    // absent
  s.leaves.push({ id: 'x1', empId: 'e5', type: 'unpaid', from: '2026-11-04', to: '2026-11-04', days: 1, status: 'approved', reason: '' });
  delete s.attendance['e5|2026-11-04'];
  s.leaves.push({ id: 'x2', empId: 'e5', type: 'annual', from: '2026-11-05', to: '2026-11-05', days: 1, status: 'approved', reason: '' });
  delete s.attendance['e5|2026-11-05'];                                    // paid leave: no deduction
  s.attendance['e5|2026-11-08'] = { in: '10:00', out: '17:00', src: 'web' };  // 60 min late
  s.attendance['e5|2026-11-09'] = { in: '09:00', out: '18:00', src: 'web' };  // 60 min overtime
  const r = payrollFor(s, e, '2026-11', ctx);
  assert.equal(r.base, 30000); assert.equal(r.absent, 1); assert.equal(r.unpaidLeave, 1); assert.equal(r.paidLeave, 1);
  assert.equal(r.dAbsent, 1000); assert.equal(r.dUnpaid, 1000);          // 30000 / 30
  assert.equal(r.lateMin, 60); assert.equal(r.dLate, 125);                // 1000 per day / 480 min * 60
  assert.equal(r.otMin, 60); assert.equal(r.otPay, 187.5);                // 125/h * 1.5
  assert.equal(r.net, 30000 - 1000 - 1000 - 125 + 187.5);
});

t('payroll: mid-month hire is prorated; no negative pay', () => {
  const s = mk(); const e = emp(s, 'e12'); e.hired = '2026-11-16'; const ctx = localParts(Date.parse('2026-12-02T12:00:00Z'));
  const r = payrollFor(s, e, '2026-11', ctx); assert.equal(r.base, Math.round(16000 * (15 / 30) * 100) / 100);
  e.salary = 100; for (const k of Object.keys(s.attendance)) if (k.startsWith('e12|')) delete s.attendance[k];
  assert.ok(payrollFor(s, e, '2026-11', ctx).net >= 0);
});

t('employee management: validation, manager loops, last admin', () => {
  const s = mk(); const base = { name: 'New Person', role: 'employee', shiftId: 's1', salary: 10000, managerId: 'e3' };
  fails(s, 'e5', { type: 'emp.save', emp: base }, /admin only/);
  fails(s, 'e2', { type: 'emp.save', emp: { ...base, name: '' } }, /name required/);
  fails(s, 'e2', { type: 'emp.save', emp: { ...base, role: 'boss' } }, /bad role/);
  fails(s, 'e2', { type: 'emp.save', emp: { ...base, salary: -5 } }, /bad salary/);
  fails(s, 'e2', { type: 'emp.save', emp: { ...base, email: 'nope' } }, /invalid email/);
  op(s, 'e2', { type: 'emp.save', emp: base }); const added = s.employees.at(-1); assert.equal(added.ent.annual, 21); assert.equal(added.active, true);
  fails(s, 'e2', { type: 'emp.save', emp: { ...emp(s, 'e3'), managerId: 'e5' } }, /manager loop/);
  op(s, 'e1', { type: 'emp.save', emp: { ...emp(s, 'e2'), role: 'employee' } }); // e1 is still an admin
  fails(s, 'e1', { type: 'emp.save', emp: { ...emp(s, 'e1'), role: 'employee' } }, /keep at least one admin/);
  fails(s, 'e1', { type: 'emp.deactivate', id: 'e1' }, /yourself/);
  op(s, 'e1', { type: 'emp.deactivate', id: 'e5' });
  assert.ok(!s.leaves.some((l) => l.empId === 'e5' && l.status === 'pending'));
});

t('views: employees never see colleagues\' salaries, reasons or payroll', () => {
  const s = mk(); const v = view(s, 'e5', {}, NOW); const j = JSON.stringify(v);
  assert.equal(v.payroll, null); assert.deepEqual(v.teamIds, []);
  assert.ok(v.employees.find((e) => e.id === 'e5').salary > 0);
  assert.equal(v.employees.find((e) => e.id === 'e6').salary, undefined);
  assert.ok(v.leaves.every((l) => l.empId === 'e5'));
  assert.ok(v.outCal.some((o) => o.empId === 'e11' && o.type === null)); // calendar shows who is out, not why
  assert.ok(!j.includes('Dentist') && !j.includes('Wedding'));
  const m = view(s, 'e3', {}, NOW); assert.deepEqual(Object.keys(m.days).sort(), ['e3', 'e5', 'e6', 'e7']);
  assert.equal(m.payroll, null); assert.equal(m.employees.find((e) => e.id === 'e1').salary, undefined);
  assert.ok(m.pendingCount >= 2);
  const a = view(s, 'e2', {}, NOW); assert.ok(a.payroll.rows.length === 12); assert.ok(a.employees.every((e) => e.salary > 0));
});

t('demo reset restores the seed', () => {
  const s = mk(); op(s, 'e2', { type: 'emp.deactivate', id: 'e12' }); op(s, 'e2', { type: 'demo.reset' }, NOW);
  assert.equal(s.employees.filter((e) => e.active).length, 12);
});

console.log(`\n${n} test groups passed`);
