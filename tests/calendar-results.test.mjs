import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyCommand, monday, shiftDay, weekChanged } from '../lib/domain.mjs';
import { makeNotice, changeSummary } from '../lib/exports.mjs';
import { koreaToday, monthDays, shiftMonth, calendarEntries, makeResultCsv } from '../lib/calendar.mjs';
const now = '2026-10-03T15:00:00.000Z', week = '2026-09-28';
let seq = 0;
const command = (state, type, fields = {}, at = now) => applyCommand(state, { type, requestId: `r-${++seq}`, expectedRevision: state.revision, ...fields }, { now: at, id: `id-${++seq}` });
const item = (overrides = {}) => ({ date: week, time: '09:00', place: '  예시 포장 A  ', task: '예시 제초', assignees: ['예시 담당'], notes: '예시 메모', reviewed: true, ...overrides });
const result = (overrides = {}) => ({ status: 'done', date: '2026-10-04', summary: '예시 작업 결과\n입력 내용 그대로', recorder: '예시 기록자', ...overrides });
function source(items = [item()]) {
  const state = command(emptyState(), 'addMember', { name: '예시 제출자' });
  return command(state, 'submit', { week, submitterId: state.members[0].id, sourceText: '예시 테스트 원문', items });
}
function record(state, value = result(), at = now, id = state.plans[0].id) { return command(state, 'recordResult', { id, result: value }, at); }
function freeze(value) { Object.freeze(value); for (const v of Object.values(value)) if (v && typeof v === 'object' && !Object.isFrozen(v)) freeze(v); return value; }
function rejectAtomic(state, type, fields, match = error => error.code === 'VALIDATION', at = now) {
  const before = JSON.stringify(state);
  assert.throws(() => command(freeze(state), type, fields, at), match);
  assert.equal(JSON.stringify(state), before);
}
const capture = plan => Object.fromEntries(['task', 'date', 'time', 'place', 'assignees'].map(key => [key, structuredClone(plan[key])]));

test('recordResult is explicit, immutable, schema-v1 compatible and keeps original plan fields plus before/after audit', () => {
  const state = freeze(source()), original = state.plans[0];
  assert.equal(Object.hasOwn(original, 'result'), false);
  const next = record(state);
  assert.equal(next.schemaVersion, 1);
  assert.equal(next.revision, state.revision + 1);
  assert.equal(next.history.length, state.history.length + 1);
  assert.equal(next.receipts.length, state.receipts.length + 1);
  assert.deepEqual(next.plans[0].result, { ...result(), recordedAt: now, updatedAt: now, planSnapshot: capture(original) });
  assert.deepEqual(next.history.at(-1).before, original);
  assert.deepEqual(next.history.at(-1).after, next.plans[0]);
  assert.equal(next.history.at(-1).type, 'recordResult');
  assert.equal(next.history.at(-1).planId, original.id);
  assert.equal(Object.hasOwn(state.plans[0], 'result'), false);
  for (const key of ['task', 'date', 'time', 'place', 'assignees', 'notes', 'sourceText', 'week', 'reviewed']) assert.deepEqual(next.plans[0][key], original[key]);
});

test('all three result statuses are explicit, including not-done assessment, without measurements or inferred completion', () => {
  for (const status of ['done', 'partial', 'not-done']) {
    const state = record(source(), result({ status }));
    assert.equal(state.plans[0].result.status, status);
    assert.deepEqual(Object.keys(state.plans[0].result).sort(), ['status', 'date', 'summary', 'recorder', 'recordedAt', 'updatedAt', 'planSnapshot'].sort());
  }
  assert.equal(source().plans[0].result, undefined);
});

test('maximum result text lengths are accepted and result metadata cannot be edited through plan or submit fields', () => {
  const state = source();
  const next = record(state, result({ summary: '결'.repeat(2000), recorder: '기'.repeat(80) }));
  assert.equal(next.plans[0].result.summary.length, 2000);
  assert.equal(next.plans[0].result.recorder.length, 80);
  rejectAtomic(next, 'editPlan', { id: next.plans[0].id, patch: { result: result() } });
  rejectAtomic(state, 'submit', { week, submitterId: state.members[0].id, items: [item({ result: result() })] });
});

test('updates preserve first-record snapshot and recordedAt after plan edits; old result remains in audit', () => {
  const first = record(source());
  const saved = structuredClone(first.plans[0].result);
  let edited = command(first, 'editPlan', { id: first.plans[0].id, patch: { task: '예시 변경 작업', date: '2026-09-29', time: '오후', place: '예시 포장 B', assignees: ['예시 변경 담당'] } });
  const later = '2026-10-04T16:00:00.000Z';
  edited = record(freeze(edited), result({ status: 'partial', date: '2026-10-05', summary: '예시 정정' }), later);
  const updated = edited.plans[0].result;
  assert.equal(updated.recordedAt, now);
  assert.equal(updated.updatedAt, later);
  assert.equal(edited.plans[0].updatedAt, later);
  assert.deepEqual(updated.planSnapshot, saved.planSnapshot);
  assert.deepEqual(edited.history.at(-1).before.result, saved);
  assert.deepEqual(edited.history.at(-1).after.result, updated);
  assert.deepEqual(first.plans[0].result, saved);
});

test('snapshot captures current plan at FIRST record, including unscheduled date, not submission or finalized snapshot', () => {
  let state = source();
  state = command(state, 'finalize', { week });
  state = command(state, 'editPlan', { id: state.plans[0].id, patch: { task: '예시 최초 기록 전 수정', date: null, assignees: [] } });
  const next = record(state);
  assert.deepEqual(next.plans[0].result.planSnapshot, capture(state.plans[0]));
  assert.equal(next.plans[0].result.planSnapshot.date, null);
  assert.notEqual(next.plans[0].result.planSnapshot.task, next.snapshots[0].plans[0].task);
});

test('result-only changes do not change frozen weekly plans, notice or change summary', () => {
  const finalized = command(source(), 'finalize', { week });
  const notice = makeNotice(finalized, week), snapshots = structuredClone(finalized.snapshots);
  const next = record(finalized);
  assert.equal(weekChanged(next, week), false);
  assert.equal(makeNotice(next, week), notice);
  assert.equal(changeSummary(next, week), '최근 확정본 이후 변경 없음');
  assert.deepEqual(next.snapshots, snapshots);
  const refinalized = command(next, 'finalize', { week });
  const update = record(refinalized, result({ status: 'not-done', summary: '예시 결과 정정' }));
  assert.equal(weekChanged(update, week), false);
  assert.equal(makeNotice(update, week), notice);
  assert.deepEqual(update.snapshots, refinalized.snapshots);
  const edited = command(update, 'editPlan', { id: update.plans[0].id, patch: { task: '예시 계획 변경' } });
  assert.equal(weekChanged(edited, week), true);
});

for (const [label, value] of [
  ['missing result', undefined], ['null', null], ['array', []],
  ['missing status', { date: '2026-10-04', summary: '예시', recorder: '예시' }],
  ['missing date', { status: 'done', summary: '예시', recorder: '예시' }],
  ['missing summary', { status: 'done', date: '2026-10-04', recorder: '예시' }],
  ['missing recorder', { status: 'done', date: '2026-10-04', summary: '예시' }],
  ['invalid status', result({ status: 'cancelled' })], ['nonstring status', result({ status: true })],
  ['future date', result({ date: '2026-10-05' })], ['invalid actual date', result({ date: '2026-02-29' })],
  ['noncanonical date', result({ date: '2026-1-02' })], ['timestamp date', result({ date: now })],
  ['null date', result({ date: null })], ['empty summary', result({ summary: ' \n ' })],
  ['nonstring summary', result({ summary: 5 })], ['long summary', result({ summary: 'x'.repeat(2001) })],
  ['null character', result({ summary: '예시\u0000' })], ['empty recorder', result({ recorder: '\t' })],
  ['long recorder', result({ recorder: 'x'.repeat(81) })], ['nonstring recorder', result({ recorder: {} })],
  ['injected snapshot', { ...result(), planSnapshot: {} }], ['injected timestamp', { ...result(), recordedAt: now }],
  ['unexpected measurement', { ...result(), yield: 100 }],
]) test(`result validation atomically rejects ${label}`, () => {
  const state = source();
  const fields = { id: state.plans[0].id };
  if (value !== undefined) fields.result = value;
  rejectAtomic(state, 'recordResult', fields);
});

test('strict command/id/state validation rejects missing, repaired and unknown IDs and extra envelope fields', () => {
  const state = source();
  for (const id of [undefined, null, 5, 'missing', ` ${state.plans[0].id} `]) {
    const fields = { result: result() };
    if (id !== undefined) fields.id = id;
    rejectAtomic(state, 'recordResult', fields);
  }
  rejectAtomic(state, 'recordResult', { id: state.plans[0].id, result: result(), task: '위조' });
  for (const bad of [null, {}, { ...state, plans: null }]) assert.throws(() => applyCommand(bad, {}), e => e.code === 'VALIDATION');
  rejectAtomic(state, 'recordResult', { id: state.plans[0].id, result: result() }, e => e.code === 'VALIDATION', 'invalid-now');
});

test('KST midnight gates actual dates; results can cross week/month/year and use leap day', () => {
  const state = source();
  rejectAtomic(state, 'recordResult', { id: state.plans[0].id, result: result() }, e => e.code === 'VALIDATION', '2026-10-03T14:59:59.999Z');
  assert.equal(record(state).plans[0].result.date, '2026-10-04');
  for (const date of ['2026-09-01', '2025-12-31', '2024-02-29']) assert.equal(record(state, result({ date })).plans[0].result.date, date);
  assert.equal(record(state, result({ date: '2027-01-01' }), '2026-12-31T15:00:00Z').plans[0].result.date, '2027-01-01');
});

test('cancelled plans retain earlier results but reject new records and updates; restoring allows explicit updates', () => {
  const sourceState = source();
  const cancelledWithoutResult = command(sourceState, 'cancelPlan', { id: sourceState.plans[0].id, cancelled: true });
  rejectAtomic(cancelledWithoutResult, 'recordResult', { id: sourceState.plans[0].id, result: result() });
  const recorded = record(sourceState);
  const cancelled = command(recorded, 'cancelPlan', { id: sourceState.plans[0].id, cancelled: true });
  assert.deepEqual(cancelled.plans[0].result, recorded.plans[0].result);
  rejectAtomic(cancelled, 'recordResult', { id: sourceState.plans[0].id, result: result({ status: 'partial' }) });
  const restored = command(cancelled, 'cancelPlan', { id: sourceState.plans[0].id, cancelled: false });
  assert.equal(record(restored, result({ status: 'partial' })).plans[0].result.status, 'partial');
});

test('copy resets results without changing original result or immutable snapshot', () => {
  const state = record(source());
  const copied = command(freeze(state), 'copyPlans', { sourceWeek: week, targetWeek: '2026-10-05', planIds: [state.plans[0].id] });
  assert.deepEqual(copied.plans[0].result, state.plans[0].result);
  assert.equal(Object.hasOwn(copied.plans[1], 'result'), false);
  assert.equal(Object.hasOwn(copied.history.at(-1).after, 'result'), false);
  assert.equal(copied.plans[1].reviewed, false);
});

test('result retries survive later edits and cancellation; changed payload and fresh stale request conflict', () => {
  const state = source();
  const cmd = { type: 'recordResult', requestId: 'stable-result', expectedRevision: state.revision, id: state.plans[0].id, result: result() };
  let next = applyCommand(state, cmd, { now, id: 'stable-result' });
  next = command(next, 'cancelPlan', { id: state.plans[0].id, cancelled: true });
  assert.deepEqual(applyCommand(freeze(next), structuredClone(cmd), { now: 'invalid-replay-now' }), next);
  assert.throws(() => applyCommand(next, { ...cmd, result: result({ summary: '바뀜' }) }), e => e.code === 'CONFLICT');
  assert.throws(() => applyCommand(next, { ...cmd, requestId: 'new-stale' }), e => e.code === 'CONFLICT');
});

test('result history/receipt/revision caps fail atomically; exact final-slot replay works', () => {
  const base = source();
  for (const padded of [
    { ...base, history: Array.from({ length: 1000 }, (_, i) => ({ id: `h${i}` })) },
    { ...base, receipts: Array.from({ length: 5000 }, (_, i) => ({ requestId: `r${i}` })) },
    { ...base, revision: Number.MAX_SAFE_INTEGER },
  ]) rejectAtomic(padded, 'recordResult', { id: base.plans[0].id, result: result() }, e => e.code === 'LIMIT');
  const almost = { ...base, history: Array.from({ length: 999 }, (_, i) => ({ id: `h${i}` })), receipts: Array.from({ length: 4999 }, (_, i) => ({ requestId: `prior${i}` })) };
  const cmd = { type: 'recordResult', requestId: 'last-slot', expectedRevision: almost.revision, id: base.plans[0].id, result: result() };
  const next = applyCommand(almost, cmd, { now });
  assert.equal(next.history.length, 1000);
  assert.equal(next.receipts.length, 5000);
  assert.deepEqual(applyCommand(freeze(next), cmd), next);
});

test('Korea today uses KST without host timezone dependence and validates inputs', () => {
  assert.equal(koreaToday('2026-12-31T14:59:59.999Z'), '2026-12-31');
  assert.equal(koreaToday(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
  assert.match(koreaToday(), /^\d{4}-\d{2}-\d{2}$/);
  for (const invalid of ['bad', null, {}, new Date(NaN), '10000-01-01T00:00:00Z']) assert.throws(() => koreaToday(invalid), e => e.code === 'VALIDATION');
});

for (const [month, first, last] of [
  ['2026-10', '2026-09-27', '2026-11-07'],
  ['2024-02', '2024-01-28', '2024-03-09'],
  ['2026-02', '2026-02-01', '2026-03-14'],
  ['2027-01', '2026-12-27', '2027-02-06'],
  ['0099-03', '0099-03-01', '0099-04-11'],
]) test(`42-day Sunday month grid covers ${month} with valid contiguous unique dates`, () => {
  const days = monthDays(month);
  assert.equal(days.length, 42); assert.equal(new Set(days).size, 42);
  assert.equal(days[0], first); assert.equal(days.at(-1), last);
  assert.equal(new Date(`${days[0]}T00:00:00Z`).getUTCDay(), 0);
  for (let i = 0; i < days.length; i++) assert.equal(days[i], shiftDay(days[0], i));
  if (month === '2024-02') assert.ok(days.includes('2024-02-29'));
});

test('month shifting crosses leap/year boundaries and rejects invalid or out-of-range inputs', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2027-01', -1), '2026-12');
  assert.equal(shiftMonth('2024-02', 12), '2025-02');
  assert.equal(shiftMonth('0099-12', 1), '0100-01');
  assert.equal(shiftMonth('2026-10', 0), '2026-10');
  for (const invalid of [null, undefined, '2026-1', '2026-00', '2026-13', ' 2026-10', '2026-10-01', '10000-01']) {
    assert.throws(() => monthDays(invalid), e => e.code === 'VALIDATION');
    assert.throws(() => shiftMonth(invalid, 1), e => e.code === 'VALIDATION');
  }
  for (const offset of [1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => shiftMonth('2026-01', offset), e => e.code === 'VALIDATION');
  assert.throws(() => shiftMonth('0000-01', -1), e => e.code === 'VALIDATION');
  assert.throws(() => shiftMonth('9999-12', 1), e => e.code === 'VALIDATION');
  assert.throws(() => monthDays('9999-12'), e => e.code === 'VALIDATION');
});

test('calendar tolerates missing state and legacy schema-v1 result-free plans without inferring past completion', () => {
  for (const state of [undefined, null, {}, { plans: null }, emptyState()]) assert.deepEqual(calendarEntries(state), []);
  const state = source([item(), item({ date: null })]);
  assert.deepEqual(calendarEntries(state).map(e => [e.kind, e.date, e.result]), [['plan', week, null], ['plan', null, null]]);
  assert.deepEqual(calendarEntries(state, { mode: 'results' }), []);
});

function calendarState() {
  let state = source([item(), item({ date: '2026-09-29', task: '예시 미정 결과' }), item({ date: null, task: '예시 날짜 미정' }), item({ date: '2026-09-30', task: '예시 미기록' })]);
  state = record(state, result({ date: week }));
  state = record(state, result({ status: 'partial', summary: '예시 일부 기록 [literal].*' }), now, state.plans[1].id);
  return state;
}

test('all mode combines same-day plan/result but separates actual dates; result-only has unique plan IDs', () => {
  const state = calendarState(), entries = calendarEntries(freeze(state));
  assert.equal(entries.length, 5);
  assert.equal(new Set(entries.map(e => e.id)).size, entries.length);
  const first = entries.find(e => e.planId === state.plans[0].id);
  assert.equal(first.id, `${state.plans[0].id}:both`); assert.equal(first.kind, 'both');
  const second = entries.filter(e => e.planId === state.plans[1].id);
  assert.deepEqual(second.map(e => [e.kind, e.date]), [['plan', '2026-09-29'], ['result', '2026-10-04']]);
  assert.deepEqual(second[0].result, state.plans[1].result);
  assert.deepEqual(second.map(e => e.id), [`${state.plans[1].id}:plan`, `${state.plans[1].id}:result`]);
  assert.equal(calendarEntries(state, { mode: 'plans' }).length, 4);
  assert.ok(calendarEntries(state, { mode: 'plans' }).every(e => e.kind === 'plan'));
  assert.equal(calendarEntries(state, { mode: 'results' }).length, 2);
  assert.ok(calendarEntries(state, { mode: 'results' }).every(e => e.kind === 'result'));
});

test('result projections and filters use frozen fields after current plan edits, and outputs cannot mutate state', () => {
  let state = calendarState();
  state = command(state, 'editPlan', { id: state.plans[1].id, patch: { task: '수정 제목', place: '수정 장소', assignees: ['수정 담당'], time: '오후' } });
  const before = JSON.stringify(state), entries = calendarEntries(freeze(state));
  const actual = entries.find(e => e.id === `${state.plans[1].id}:result`);
  assert.equal(actual.task, '예시 미정 결과'); assert.equal(actual.place, '  예시 포장 A  ');
  assert.equal(actual.time, '09:00'); assert.deepEqual(actual.assignees, ['예시 담당']);
  assert.equal(calendarEntries(state, { query: '수정 제목' })[0].kind, 'plan');
  assert.equal(calendarEntries(state, { query: '예시 미정 결과' })[0].kind, 'result');
  assert.equal(calendarEntries(state, { person: '수정 담당', place: '수정 장소' }).length, 1);
  assert.deepEqual(calendarEntries(state, { mode: 'results', person: '수정 담당' }), []);
  actual.assignees.push('독립 배열'); actual.result.planSnapshot.assignees.push('독립 스냅샷'); actual.result.summary = '독립 편집';
  assert.equal(JSON.stringify(state), before);
});

test('combined entry uses frozen result fields even when a same-day live plan title changes', () => {
  const base = record(source(), result({ date: week }));
  const state = command(base, 'editPlan', { id: base.plans[0].id, patch: { task: '새 제목', place: '새 장소' } });
  const [entry] = calendarEntries(state);
  assert.equal(entry.kind, 'both'); assert.equal(entry.task, '예시 제초');
  assert.equal(calendarEntries(state, { mode: 'plans' })[0].task, '새 제목');
});

test('filters compose per projection; no-result excludes plan leg of a different-day recorded result', () => {
  const state = calendarState();
  assert.deepEqual(calendarEntries(state, { status: 'no-result' }).map(e => e.planId).sort(), state.plans.slice(2).map(p => p.id).sort());
  assert.deepEqual(calendarEntries(state, { mode: 'results', status: 'no-result' }), []);
  assert.equal(calendarEntries(state, { status: 'done' }).length, 1);
  assert.equal(calendarEntries(state, { status: 'partial' }).length, 2);
  assert.equal(calendarEntries(state, { status: 'not-done' }).length, 0);
  assert.equal(calendarEntries(state, { query: '[literal].*', person: ' 예시 담당 ', place: ' 예시 포장 A ', status: 'partial', mode: 'results' }).length, 1);
  assert.equal(calendarEntries(state, { query: '예시 기록자', mode: 'results' }).length, 2);
  assert.equal(calendarEntries(state, { person: '예시', mode: 'results' }).length, 0);
  assert.equal(calendarEntries(state, { place: '포장 A', mode: 'results' }).length, 0);
  assert.deepEqual(calendarEntries(state, { query: 'no match' }), []);
  for (const options of [{ mode: 'bad' }, { mode: 'plan' }, { mode: 'result' }, { status: 'bad' }, { query: [] }, { person: null }, { place: 5 }, null]) assert.throws(() => calendarEntries(state, options), e => e.code === 'VALIDATION');
});

test('cancelled plan entries disappear but recorded results remain searchable and exportable', () => {
  let state = calendarState();
  for (const p of state.plans) state = command(state, 'cancelPlan', { id: p.id, cancelled: true });
  const entries = calendarEntries(state);
  assert.equal(entries.length, 2);
  assert.ok(entries.every(e => e.kind === 'result' && e.cancelled));
  assert.equal(calendarEntries(state, { mode: 'plans' }).length, 0);
  assert.equal(calendarEntries(state, { status: 'no-result' }).length, 0);
  assert.equal(calendarEntries(state, { query: '일부 기록' }).length, 1);
  assert.match(makeResultCsv(entries), /예시 일부 기록/);
});

function parseCsv(csv) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') { if (quoted && csv[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === ',') { row.push(cell); cell = ''; }
    else if (!quoted && c === '\r' && csv[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  return rows;
}

test('result CSV exports one row per result/both, distinct planned/actual dates and captured fields rather than mutable entry text', () => {
  const state = calendarState(), entries = calendarEntries(state);
  const duplicate = structuredClone(entries.find(e => e.kind === 'both')); duplicate.task = '잘못된 최신 제목'; duplicate.date = '2099-01-01';
  const csv = makeResultCsv([duplicate, ...entries, ...calendarEntries(state, { mode: 'results' })]);
  assert.ok(csv.startsWith('\ufeff')); assert.ok(csv.endsWith('\r\n'));
  const rows = parseCsv(csv), [header] = rows;
  assert.deepEqual(header, ['계획일', '실제·평가일', '계획 시간', '포장', '작업내용', '담당자', '결과 상태', '결과 요약', '기록자', '최초 기록', '수정 시각', '계획 취소']);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1].slice(0, 6), [week, week, '09:00', '  예시 포장 A  ', '예시 제초', '예시 담당']);
  assert.equal(rows[2][0], '2026-09-29'); assert.equal(rows[2][1], '2026-10-04');
  assert.doesNotMatch(csv, /잘못된 최신 제목|2099/);
  assert.equal(parseCsv(makeResultCsv(calendarEntries(state, { mode: 'plans' }))).length, 1);
  assert.equal(parseCsv(makeResultCsv([])).length, 1);
  assert.equal(parseCsv(makeResultCsv(undefined)).length, 1);
  for (const invalid of [null, {}, 'text']) assert.throws(() => makeResultCsv(invalid), e => e.code === 'VALIDATION');
});

test('CSV defends spreadsheet formulas including leading control/Unicode whitespace and preserves quoted multiline text', () => {
  const attacks = ['=1+1', '+cmd', '-cmd', '@SUM(1)', '  =1', '\t@SUM(1)', '\ufeff=1', '\u001f+1', '\u0085-1'];
  for (const attack of attacks) {
    const state = record(source([item({ task: '+예시 "제초"', place: attack, assignees: ['-예시 담당'] })]), result({ summary: `${attack}\n"예시"`, recorder: '@예시 기록자' }));
    const [, row] = parseCsv(makeResultCsv(calendarEntries(state)));
    assert.equal(row[3], `'${attack}`);
    assert.equal(row[4], '\'+예시 "제초"');
    assert.equal(row[5], "'-예시 담당");
    assert.equal(row[7], `'${attack}\n"예시"`);
    assert.equal(row[8], "'@예시 기록자");
  }
});

function examples(anchor = '2026-10-05', at = now) { return command(emptyState(), 'loadExample', { week: anchor }, at); }
test('historical fixtures are opt-in, visibly synthetic, cover earlier weeks and never mark an unrecorded past plan done', () => {
  const initial = examples();
  assert.equal(initial.plans.length, 2); assert.ok(initial.plans.every(p => !p.result));
  const next = command(freeze(initial), 'loadHistoryExample', { week: '2026-10-05' });
  const added = next.plans.slice(initial.plans.length);
  assert.equal(added.length, 4);
  assert.deepEqual([...new Set(added.map(p => p.week))].sort(), ['2026-09-14', '2026-09-21', '2026-09-28']);
  assert.deepEqual(added.filter(p => p.result).map(p => p.result.status).sort(), ['done', 'not-done', 'partial']);
  assert.equal(added.filter(p => !p.result).length, 1);
  for (const p of added) {
    assert.ok(p.date <= koreaToday(now)); assert.equal(monday(p.date), p.week);
    for (const field of [p.task, p.sourceText, p.notes, p.place, ...p.assignees]) assert.match(field, /예시/);
    if (p.result) { assert.ok(p.result.date <= koreaToday(now)); assert.match(p.result.summary, /예시/); assert.match(p.result.recorder, /예시/); assert.deepEqual(p.result.planSnapshot, capture(p)); }
  }
  assert.equal(next.history.filter(h => h.type === 'loadHistoryExample').length, 1);
  assert.equal(next.history.length, initial.history.length + 8); // four plans, three results, one command audit
  assert.deepEqual(next.plans.slice(0, 2), initial.plans);
  assert.deepEqual(next.members, initial.members);
  assert.deepEqual(next.noWork, initial.noWork);
  assert.deepEqual(next.snapshots, initial.snapshots);
});

test('historical fixture command requires pristine initial examples, rejects real/mixed/edited data and duplicate loads', () => {
  const initial = examples();
  for (const state of [emptyState(), source(), command(initial, 'addMember', { name: '실제 데이터' }), command(initial, 'editPlan', { id: initial.plans[0].id, patch: { task: '실제 작업' } })]) rejectAtomic(state, 'loadHistoryExample', { week: '2026-10-05' });
  const fakeSource = source(); fakeSource.plans[0].sourceText = '[예시 원문]';
  rejectAtomic(fakeSource, 'loadHistoryExample', { week: '2026-10-05' });
  const loaded = command(initial, 'loadHistoryExample', { week: '2026-10-05' });
  rejectAtomic(loaded, 'loadHistoryExample', { week: '2026-10-05' });
  rejectAtomic(loaded, 'loadHistoryExample', { week: '2026-09-28' });
  rejectAtomic(initial, 'loadHistoryExample', { week: '2026-10-06' });
  rejectAtomic(initial, 'loadHistoryExample', { week: '2026-09-28' });
  rejectAtomic(initial, 'loadHistoryExample', { week: '2026-10-05', unexpected: true });
});

test('historical fixture dates cross year and leap month, respect context.now and reject future anchor weeks', () => {
  for (const [anchor, at] of [['2027-01-04', '2027-01-03T15:00:00Z'], ['2024-03-04', '2024-03-03T15:00:00Z'], ['2026-10-05', '2026-09-27T15:00:00Z']]) {
    const state = command(examples(anchor, at), 'loadHistoryExample', { week: anchor }, at);
    for (const p of state.plans.slice(2)) { assert.ok(p.date <= koreaToday(at)); if (p.result) assert.ok(p.result.date <= koreaToday(at)); }
    assert.ok(state.plans.slice(2).some(p => p.date.slice(0, 7) !== anchor.slice(0, 7)));
  }
  rejectAtomic(examples('2026-10-19'), 'loadHistoryExample', { week: '2026-10-19' });
});

test('historical fixtures share standard replay/conflict and atomic plan/history/receipt/revision caps', () => {
  const initial = examples(), fields = { week: '2026-10-05' };
  const cmd = { type: 'loadHistoryExample', requestId: 'history-example', expectedRevision: initial.revision, ...fields };
  const next = applyCommand(initial, cmd, { now });
  assert.deepEqual(applyCommand(freeze(next), cmd), next);
  assert.throws(() => applyCommand(next, { ...cmd, week: '2026-09-28' }), e => e.code === 'CONFLICT');
  assert.throws(() => applyCommand(next, { ...cmd, requestId: 'stale-history' }), e => e.code === 'CONFLICT');
  for (const state of [
    { ...initial, plans: Array.from({ length: 1997 }, (_, i) => ({ ...initial.plans[0], id: `p${i}` })) },
    { ...initial, history: [...initial.history, ...Array.from({ length: 990 }, (_, i) => ({ id: `h${i}` }))] },
    { ...initial, receipts: Array.from({ length: 5000 }, (_, i) => ({ requestId: `prior${i}` })) },
    { ...initial, revision: Number.MAX_SAFE_INTEGER },
  ]) rejectAtomic(state, 'loadHistoryExample', fields, e => e.code === 'LIMIT');
});

test('actual memory-only demo store supports historical results, returns isolated state, retries and resets on reload', async () => {
  const store = await import('../src/demo-store.mjs?calendar-results');
  const initial = await store.loadState();
  const cmd = { type: 'loadHistoryExample', week: initial.plans[0].week };
  const loaded = await store.sendCommand(initial, cmd, 'memory-history');
  assert.equal(loaded.plans.length, 6);
  assert.equal(calendarEntries(loaded, { mode: 'results' }).length, 3);
  assert.deepEqual(await store.sendCommand(initial, cmd, 'memory-history'), loaded);
  const target = loaded.plans.find(p => p.result);
  const updated = await store.sendCommand(loaded, { type: 'recordResult', id: target.id, result: result({ date: koreaToday(), summary: '예시 메모리 변경' }) }, 'memory-result');
  assert.match(updated.plans.find(p => p.id === target.id).result.summary, /메모리 변경/);
  updated.plans[0].task = '반환 객체 변경';
  assert.notEqual((await store.loadState()).plans[0].task, '반환 객체 변경');
  await assert.rejects(store.sendCommand(loaded, { type: 'recordResult', id: target.id, result: result({ date: koreaToday() }) }, 'stale-result'), e => e.code === 'CONFLICT');
  const fresh = await import('../src/demo-store.mjs?calendar-results-fresh');
  assert.equal((await fresh.loadState()).plans.length, 2);
  assert.equal(calendarEntries(await fresh.loadState(), { mode: 'results' }).length, 0);
});
