import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../lib/domain.mjs';

const { emptyState, applyCommand, shiftDay, weekPlans, memberStatuses } = domain;
const week = '2026-10-05', target = '2026-10-12', now = '2026-10-03T09:00:00.000Z';
let seq = 0;
const command = (state, type, fields = {}) => applyCommand(state, { type, requestId: `r-${++seq}`, expectedRevision: state.revision, ...fields }, { now, id: `id-${++seq}` });
const item = (date, overrides = {}) => ({ date, time: '09:00 ~ 10:00', place: '  시험포장 A  ', task: '토양 시료 채취', assignees: ['예시 나'], notes: '  메모\n둘째 줄\r\n  ', reviewed: true, ...overrides });
function source(sourceWeek = week) {
  let state = emptyState();
  for (const name of ['예시 가', '예시 나', '예시 다']) state = command(state, 'addMember', { name });
  state = command(state, 'submit', { week: sourceWeek, submitterId: state.members[0].id, sourceText: '  원문\r\n\t월요일🙂\n  ', items: [item(sourceWeek), item(null, { task: '날짜 미정 작업' })] });
  return command(state, 'submit', { week: sourceWeek, submitterId: state.members[1].id, sourceText: '다른 제출자 원문', items: [item(shiftDay(sourceWeek, 6), { task: '일요일 작업' })] });
}
function fields(state, overrides = {}) { return { sourceWeek: week, targetWeek: target, planIds: state.plans.filter(x => x.week === week && !x.cancelled).map(x => x.id), ...overrides }; }
function freeze(value) { Object.freeze(value); for (const v of Object.values(value)) if (v && typeof v === 'object' && !Object.isFrozen(v)) freeze(v); return value; }
function preview(state, values = fields(state)) { return domain.previewCopyPlans(state, values.sourceWeek, values.targetWeek, values.planIds); }
function rejectAtomic(state, values, match) {
  const before = JSON.stringify(state);
  assert.throws(() => command(state, 'copyPlans', values), match);
  assert.throws(() => preview(state, values), match);
  assert.equal(JSON.stringify(state), before);
}

test('copy shifts dated plans by seven days and leaves unknown dates null; all fields retain source provenance', () => {
  const state = freeze(source()), before = JSON.stringify(state);
  const copied = command(state, 'copyPlans', fields(state));
  const plans = weekPlans(copied, target);
  assert.equal(plans.length, state.plans.length);
  assert.equal(copied.revision, state.revision + 1);
  assert.equal(copied.receipts.length, state.receipts.length + 1);
  const ids = new Set(copied.plans.map(p => p.id));
  assert.equal(ids.size, copied.plans.length);
  for (const original of state.plans) {
    const p = plans.find(x => x.copiedFrom.planId === original.id);
    assert.ok(p);
    assert.notEqual(p.id, original.id);
    assert.equal(p.date, original.date === null ? null : shiftDay(original.date, 7));
    assert.equal(p.reviewed, false);
    assert.equal(p.cancelled, false);
    assert.equal(p.week, target);
    assert.deepEqual(p.copiedFrom, { planId: original.id, week });
    for (const key of ['task', 'time', 'place', 'notes', 'assignees', 'sourceText', 'submitterId']) assert.deepEqual(p[key], original[key], key);
    assert.equal(p.createdAt, now);
    assert.equal(p.updatedAt, now);
    const entry = copied.history.find(h => h.type === 'copyPlans' && h.planId === p.id);
    assert.ok(entry);
    assert.equal(entry.sourcePlanId, original.id);
    assert.equal(entry.sourceWeek, week);
    assert.equal(entry.before, null);
    assert.deepEqual(entry.after, p);
  }
  assert.equal(copied.history.length, state.history.length + state.plans.length);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(copied.plans.filter(p => p.week === week), state.plans);
  assert.equal(memberStatuses(copied, target)[0].status, 'review');
});

test('preview is side-effect free, follows requested selection order, and returns isolated assignee arrays', async () => {
  const state = freeze(source());
  const values = fields(state, { planIds: [state.plans[2].id, state.plans[0].id] });
  const expected = values.planIds.map(id => {
    const p = state.plans.find(p => p.id === id);
    return { sourceId: id, task: p.task, fromDate: p.date, date: p.date === null ? null : shiftDay(p.date, 7), time: p.time, place: p.place, assignees: p.assignees, submitterId: p.submitterId };
  });
  const result = preview(state, values);
  assert.deepEqual(result, expected);
  result[0].assignees.push('별도 편집');
  assert.deepEqual(state.plans[2].assignees, ['예시 나']);
  const planning = await import('../lib/planning.mjs');
  assert.deepEqual(planning.previewCopyPlans(state, values.sourceWeek, values.targetWeek, values.planIds), expected);
  assert.equal(command(state, 'copyPlans', values).plans.length, state.plans.length + 2);
});

test('selective copy clears target no-work only for copied submitters and never copies no-work or frozen snapshots', () => {
  let state = source();
  for (const m of state.members) state = command(state, 'noWork', { week: target, memberId: m.id });
  state = command(state, 'noWork', { week, memberId: state.members[2].id });
  state = command(state, 'noWork', { week: '2026-10-19', memberId: state.members[0].id });
  state = command(state, 'finalize', { week: target });
  const oldSnapshot = structuredClone(state.snapshots);
  const copied = command(freeze(state), 'copyPlans', fields(state, { planIds: [state.plans[0].id] }));
  assert.deepEqual(copied.noWork, state.noWork.filter(n => n.week !== target || n.memberId !== state.members[0].id));
  assert.deepEqual(copied.snapshots, oldSnapshot);
  assert.equal(weekPlans(copied, target).length, 1);
  assert.deepEqual(memberStatuses(copied, target).map(s => s.status), ['review', 'none', 'none']);
});

test('next-week copy crosses month/year boundaries with correct weekday and unchanged original', () => {
  const sourceWeek = '2026-12-28', targetWeek = '2027-01-04';
  const state = source(sourceWeek);
  const values = { sourceWeek, targetWeek, planIds: state.plans.map(p => p.id) };
  assert.deepEqual(preview(state, values).map(p => p.date), ['2027-01-04', null, '2027-01-10']);
  assert.equal(weekPlans(command(state, 'copyPlans', values), targetWeek).length, 3);
});

test('copy uses current live plans rather than frozen source snapshots and preserves frozen records', () => {
  let state = source();
  state = command(state, 'editPlan', { id: state.plans[1].id, patch: { date: week } });
  state = command(state, 'finalize', { week });
  state = command(state, 'editPlan', { id: state.plans[0].id, patch: { task: '확정 뒤 수정', time: '오후' } });
  const copied = command(freeze(state), 'copyPlans', fields(state, { planIds: [state.plans[0].id] }));
  assert.deepEqual(copied.snapshots, state.snapshots);
  assert.notEqual(copied.snapshots[0].plans[0].task, '확정 뒤 수정');
  const p = weekPlans(copied, target)[0];
  assert.equal(p.task, '확정 뒤 수정');
  assert.equal(p.time, '오후');
  assert.throws(() => command(copied, 'finalize', { week: target }), /검토/);
  assert.throws(() => command(copied, 'editPlan', { id: p.id, patch: { copiedFrom: null } }), /필드/);
  const reviewed = command(copied, 'editPlan', { id: p.id, patch: { reviewed: true } });
  assert.deepEqual(reviewed.plans.find(x => x.id === p.id).copiedFrom, p.copiedFrom);
  assert.equal(command(reviewed, 'finalize', { week: target }).snapshots.length, 2);
});

test('multi-owner copy clears only the copied owners target no-work declarations', () => {
  let state = source();
  for (const m of state.members) state = command(state, 'noWork', { week: target, memberId: m.id });
  const copied = command(freeze(state), 'copyPlans', fields(state));
  assert.deepEqual(copied.noWork, state.noWork.filter(n => n.memberId === state.members[2].id));
  assert.deepEqual(memberStatuses(copied, target).map(s => s.status), ['review', 'review', 'none']);
});

test('copying a copied plan to the following week uses direct-source provenance and preserves original raw source', () => {
  const state = source();
  const copied = command(state, 'copyPlans', fields(state, { planIds: [state.plans[0].id] }));
  const p = weekPlans(copied, target)[0];
  const next = command(copied, 'copyPlans', { sourceWeek: target, targetWeek: '2026-10-19', planIds: [p.id] });
  const p2 = weekPlans(next, '2026-10-19')[0];
  assert.deepEqual(p2.copiedFrom, { planId: p.id, week: target });
  assert.equal(p2.sourceText, state.plans[0].sourceText);
});

for (const [label, override] of [
  ['empty selection', { planIds: [] }], ['non-array selection', { planIds: 'x' }],
  ['unknown ID in final position', state => ({ planIds: [state.plans[0].id, 'missing'] })],
  ['whitespace-repaired ID', state => ({ planIds: [` ${state.plans[0].id} `] })],
  ['duplicate selection', state => ({ planIds: [state.plans[0].id, state.plans[0].id] })],
  ['nonstring ID', state => ({ planIds: [state.plans[0].id, null] })],
  ['sparse array', state => ({ planIds: [state.plans[0].id, , state.plans[1].id] })],
  ['too many selected IDs', { planIds: Array.from({ length: 31 }, (_, i) => `p${i}`) }],
  ['not exactly the next week', { targetWeek: '2026-10-19' }],
  ['same week', { targetWeek: week }], ['previous week', { targetWeek: '2026-09-28' }],
  ['target not Monday', { targetWeek: '2026-10-13' }], ['source not Monday', { sourceWeek: '2026-10-06' }],
  ['invalid calendar date', { targetWeek: '2026-02-30' }],
]) {
  test(`copy and preview atomically reject ${label}`, () => {
    const state = freeze(source());
    rejectAtomic(state, fields(state, typeof override === 'function' ? override(state) : override));
  });
}

test('cancelled source and IDs belonging to another week are rejected atomically, never partially copied', () => {
  let state = source();
  state = command(state, 'cancelPlan', { id: state.plans[1].id, cancelled: true });
  rejectAtomic(freeze(state), fields(state, { planIds: [state.plans[0].id, state.plans[1].id] }));
  rejectAtomic(state, { sourceWeek: target, targetWeek: '2026-10-19', planIds: [state.plans[0].id] });
});

test('same source cannot be copied again into the same target even if the earlier copy was cancelled', () => {
  const state = source();
  const selection = fields(state, { planIds: [state.plans[0].id] });
  let copied = command(state, 'copyPlans', selection);
  rejectAtomic(copied, selection, /이미.*복사|중복/);
  const copiedId = weekPlans(copied, target)[0].id;
  copied = command(copied, 'cancelPlan', { id: copiedId, cancelled: true });
  rejectAtomic(freeze(copied), selection, /수정|복원/);
  // A new valid item before the duplicate must not sneak into the target.
  rejectAtomic(copied, fields(copied, { planIds: [state.plans[1].id, state.plans[0].id] }), /수정|복원/);
});

test('the same source is not confused with identical content from another source plan', () => {
  let state = source();
  state = command(state, 'submit', { week, submitterId: state.members[0].id, sourceText: state.plans[0].sourceText, items: [item(week)] });
  const ids = [state.plans[0].id, state.plans.at(-1).id];
  assert.equal(weekPlans(command(state, 'copyPlans', fields(state, { planIds: ids })), target).length, 2);
});

test('copy uses the normal idempotent command envelope including stale replay and changed-payload conflict', () => {
  const state = source();
  const cmd = { type: 'copyPlans', requestId: 'stable-copy', expectedRevision: state.revision, ...fields(state) };
  let copied = applyCommand(state, cmd, { now, id: 'copy' });
  copied = command(copied, 'addMember', { name: '추가 제출자' });
  assert.deepEqual(applyCommand(freeze(copied), structuredClone(cmd), { now, id: 'ignored-replay' }), copied);
  assert.throws(() => applyCommand(copied, { ...cmd, planIds: [state.plans[0].id] }), e => e.code === 'CONFLICT');
  assert.throws(() => applyCommand(copied, { ...cmd, requestId: 'fresh-stale' }), e => e.code === 'CONFLICT');
  assert.throws(() => command(state, 'copyPlans', { ...fields(state), reviewed: true }), /필드/);
});

test('copy and preview honor plan/history/receipt/revision caps with no partial clearing or audit records', () => {
  let state = source();
  state = command(state, 'noWork', { week: target, memberId: state.members[0].id });
  const selection = fields(state, { planIds: [state.plans[0].id, state.plans[1].id] });
  const capped = [
    { ...state, plans: [...state.plans, ...Array.from({ length: 1996 }, (_, i) => ({ ...state.plans[2], id: `pad${i}`, cancelled: true }))] },
    { ...state, history: Array.from({ length: 999 }, (_, i) => ({ id: `h${i}`, type: 'prior' })) },
    { ...state, receipts: Array.from({ length: 5000 }, (_, i) => ({ requestId: `prior${i}` })) },
    { ...state, revision: Number.MAX_SAFE_INTEGER },
  ];
  for (const full of capped) rejectAtomic(freeze(full), selection, e => e.code === 'LIMIT');
});

test('normal retry is accepted even when copy filled history/receipt capacity', () => {
  const base = source();
  const state = { ...base, history: Array.from({ length: 999 }, (_, i) => ({ id: `h${i}`, type: 'prior' })), receipts: Array.from({ length: 4999 }, (_, i) => ({ requestId: `prior${i}` })) };
  const cmd = { type: 'copyPlans', requestId: 'last-slot', expectedRevision: state.revision, ...fields(state, { planIds: [state.plans[0].id] }) };
  const copied = applyCommand(state, cmd, { now, id: 'copy-last' });
  assert.equal(copied.history.length, 1000);
  assert.equal(copied.receipts.length, 5000);
  assert.deepEqual(applyCommand(freeze(copied), cmd), copied);
});

test('batch size boundary allows exactly 30 plans and fails 31 without mutation', () => {
  const base = source();
  let state = command(base, 'submit', { week, submitterId: base.members[0].id, sourceText: '', items: Array.from({ length: 30 }, (_, i) => item(week, { task: `경계 ${i}` })) });
  const values = fields(state, { planIds: state.plans.slice(-30).map(p => p.id) });
  assert.equal(preview(state, values).length, 30);
  assert.equal(weekPlans(command(state, 'copyPlans', values), target).length, 30);
  rejectAtomic(freeze(state), fields(state, { planIds: state.plans.slice(-31).map(p => p.id) }));
});

test('public memory-only store accepts copy, rejects stale writes, and resets on a fresh module load', async () => {
  const store = await import('../src/demo-store.mjs?copy-integration');
  const state = await store.loadState();
  const sourceWeek = state.plans[0].week, targetWeek = shiftDay(sourceWeek, 7);
  const values = { type: 'copyPlans', sourceWeek, targetWeek, planIds: state.plans.map(p => p.id) };
  const copied = await store.sendCommand(state, values, 'memory-copy');
  assert.equal(weekPlans(copied, targetWeek).length, state.plans.length);
  assert.deepEqual(await store.loadState(), copied);
  assert.deepEqual(await store.sendCommand(state, values, 'memory-copy'), copied);
  await assert.rejects(store.sendCommand(state, { type: 'addMember', name: '오래된 창' }, 'memory-stale'), e => e.code === 'CONFLICT');
  const fresh = await import('../src/demo-store.mjs?copy-integration-fresh');
  assert.equal(weekPlans(await fresh.loadState(), targetWeek).length, 0);
});
