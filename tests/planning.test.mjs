import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, planIssues } from '../lib/domain.mjs';
import { analyzeWeek, makeReminder } from '../lib/planning.mjs';

const week = '2026-10-05';
function plan(id, overrides = {}) {
  return { id, week, date: week, time: '09:00-10:00', place: '포장 A', task: `작업 ${id}`, assignees: ['담당 가'], submitterId: 'owner', notes: '', sourceText: '', reviewed: true, cancelled: false, ...overrides };
}
function stateWith(plans = []) { return { ...emptyState(), plans }; }
function freeze(value) { Object.freeze(value); for (const v of Object.values(value)) if (v && typeof v === 'object' && !Object.isFrozen(v)) freeze(v); return value; }

// Synthetic local fixtures only; no actual personnel or field data.
test('overlap requires a shared exact trimmed resource and returns one pair with deduplicated resources', () => {
  const state = freeze(stateWith([
    plan('b', { time: '09:30 ~ 11:00', assignees: [' 담당 가 ', '담당 나', '담당 가'], place: ' 포장 A ' }),
    plan('a', { assignees: ['담당 나', '담당 가'] }),
  ]));
  const before = JSON.stringify(state);
  const result = analyzeWeek(state, week);
  assert.equal(result.totalConflicts, 1);
  assert.equal(result.conflicts.length, 1);
  const conflict = result.conflicts[0];
  assert.equal(conflict.level, 'overlap');
  assert.deepEqual(conflict.planIds, ['a', 'b']);
  assert.equal(conflict.date, week);
  assert.ok(conflict.id);
  assert.equal(conflict.resources.length, 3);
  assert.equal(new Set(conflict.resources).size, 3);
  for (const label of ['담당 가', '담당 나', '포장 A']) assert.ok(conflict.resources.some(x => x.includes(label)));
  assert.match(conflict.message, /겹|중복/);
  assert.deepEqual(result.unchecked, []);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(analyzeWeek({ ...state, plans: [...state.plans].reverse() }, week), result);
});

test('half-open touching, separated, and minute-precise ranges are not conflicts', () => {
  for (const [a, b] of [['09:00-10:00', '10:00-11:00'], ['00:00~00:01', '00:01~23:59'], ['09:00-10:00', '11:00-12:00']]) {
    assert.deepEqual(analyzeWeek(stateWith([plan('a', { time: a }), plan('b', { time: b })]), week), { conflicts: [], unchecked: [], totalConflicts: 0 });
  }
  assert.equal(analyzeWeek(stateWith([plan('a', { time: '00:00-23:59' }), plan('b', { time: '23:58-23:59' })]), week).conflicts[0].level, 'overlap');
});

for (const time of ['오전', '오후', 'AM', 'PM', '09:00', '', '시간 미정', '9:00-10:00', '24:00-25:00', '09:60-11:00', '10:00-09:00', '09:00-09:00', '23:00-01:00', '09:00-10:00 추가']) {
  test(`uncertain time ${JSON.stringify(time)} never invents a duration`, () => {
    const result = analyzeWeek(stateWith([plan('a'), plan('b', { time })]), week);
    assert.equal(result.totalConflicts, 1);
    assert.equal(result.conflicts[0].level, 'check');
    assert.ok(result.unchecked.some(x => x.planId === 'b' && /시간/.test(x.reason)));
    assert.ok(!result.unchecked.some(x => x.planId === 'a'));
  });
}

test('AM versus PM remains a cautious check without invented working hours', () => {
  const result = analyzeWeek(stateWith([plan('a', { time: '오전' }), plan('b', { time: '오후' })]), week);
  assert.equal(result.conflicts[0].level, 'check');
  assert.equal(result.unchecked.length, 2);
});

test('unknown dates are unchecked rather than falsely paired', () => {
  const result = analyzeWeek(stateWith([plan('a', { date: null }), plan('b', { date: null, time: '' }), plan('c')]), week);
  assert.equal(result.totalConflicts, 0);
  assert.deepEqual(result.unchecked.map(x => x.planId), ['a', 'b']);
  for (const p of result.unchecked) assert.match(p.reason, /날짜/);
  assert.match(result.unchecked.find(x => x.planId === 'b').reason, /시간/);
});

test('same date is mandatory; no fuzzy names, no shared blank resources, no submitter-as-assignee inference', () => {
  const cases = [
    [plan('a'), plan('b', { date: '2026-10-06' })],
    [plan('a'), plan('b', { place: '포장 AB', assignees: ['담당 가나'] })],
    [plan('a', { place: '', assignees: [] }), plan('b', { place: ' ', assignees: [] })],
    [plan('a', { place: 'X', assignees: ['Case'] }), plan('b', { place: 'Y', assignees: ['case'] })],
  ];
  for (const plans of cases) assert.equal(analyzeWeek(stateWith(plans), week).totalConflicts, 0);
  for (const override of [{ place: '다른 포장' }, { assignees: ['다른 담당'] }]) assert.equal(analyzeWeek(stateWith([plan('a'), plan('b', override)]), week).totalConflicts, 1);
});

test('cancelled plans and other weeks are excluded from conflicts and unchecked', () => {
  const state = stateWith([plan('a'), plan('b', { cancelled: true, time: '' }), plan('c', { week: '2026-10-12', date: '2026-10-12', time: '' })]);
  assert.deepEqual(analyzeWeek(state, week), { conflicts: [], unchecked: [], totalConflicts: 0 });
  assert.throws(() => analyzeWeek(state, '2026-10-06'));
});

test('conflict details are bounded at 200 while totalConflicts counts every actual pair', () => {
  const plans = Array.from({ length: 30 }, (_, i) => plan(`p${String(i).padStart(2, '0')}`));
  const result = analyzeWeek(stateWith(plans), week);
  assert.equal(result.conflicts.length, 200);
  assert.equal(result.totalConflicts, plans.length * (plans.length - 1) / 2);
  assert.equal(new Set(result.conflicts.map(x => x.id)).size, 200);
  assert.deepEqual(analyzeWeek(stateWith(plans.reverse()), week), result);
});

test('at the 2000-plan domain cap conflict output stays bounded and the pair total remains exact', () => {
  const plans = Array.from({ length: 2000 }, (_, i) => plan(`dense${i}`));
  const result = analyzeWeek(stateWith(plans), week);
  assert.equal(result.conflicts.length, 200);
  assert.equal(result.totalConflicts, plans.length * (plans.length - 1) / 2);
  assert.equal(result.unchecked.length, 0);
});

function reminderState() {
  return {
    ...emptyState(),
    members: [
      { id: 'owner', name: '검토 제출자' }, { id: 'ready', name: '완료 제출자' },
      { id: 'none', name: '작업없는 제출자' }, { id: 'missing', name: '미제출자' },
    ],
    plans: [
      plan('a', { date: null, place: '', task: '날짜장소 누락', assignees: ['미제출자'], reviewed: true }),
      plan('b', { task: '담당검토 누락', assignees: [], reviewed: false }),
      plan('c', { task: '완료 작업', submitterId: 'ready' }),
      plan('d', { task: '취소 작업', submitterId: 'owner', cancelled: true, reviewed: false }),
      plan('e', { week: '2026-10-12', date: '2026-10-12', task: '다른주 작업', reviewed: false }),
    ],
    noWork: [{ week, memberId: 'none' }],
  };
}

test('missing reminder names submitters, not assignees, and excludes review/submitted/no-work', () => {
  const text = makeReminder(freeze(reminderState()), week, { kind: 'missing' });
  assert.match(text, /미제출자/);
  for (const name of ['검토 제출자', '완료 제출자', '작업없는 제출자']) assert.ok(!text.includes(name));
  assert.match(text, /2026-10-05/);
  assert.match(text, /기한 미지정/);
  assert.match(text, /자동.*발송.*없|자동.*전송.*없/);
  assert.doesNotMatch(text, /금요일|목요일|18:00|17:00/);
});

test('review reminder reports each pending owner actual per-plan issues, not generic fabricated issues', () => {
  const state = reminderState();
  const text = makeReminder(freeze(state), week, { kind: 'review', deadline: '10월 8일 15시' });
  assert.match(text, /검토 제출자/);
  assert.match(text, /10월 8일 15시/);
  for (const name of ['완료 제출자', '작업없는 제출자', '미제출자']) assert.ok(!text.includes(name));
  for (const p of state.plans.slice(0, 2)) {
    const line = text.split('\n').find(line => line.includes(p.task));
    assert.ok(line);
    for (const issue of planIssues(p)) assert.ok(line.includes(issue));
    for (const issue of planIssues(state.plans.find(x => x.id !== p.id && ['a', 'b'].includes(x.id)))) assert.ok(!line.includes(issue));
  }
  for (const task of ['완료 작업', '취소 작업', '다른주 작업']) assert.ok(!text.includes(task));
});

test('empty roster, no pending targets, and whitespace deadline are explained without inventing recipients', () => {
  for (const kind of ['missing', 'review']) {
    assert.match(makeReminder(emptyState(), week, { kind, deadline: '   ' }), /등록.*제출자.*없|명단.*없/);
    assert.match(makeReminder(emptyState(), week, { kind }), /기한 미지정/);
    const state = reminderState();
    state.members = state.members.filter(x => ['ready', 'none'].includes(x.id));
    assert.match(makeReminder(state, week, { kind }), /대상.*없/);
  }
  assert.throws(() => makeReminder(emptyState(), week, { kind: 'all' }));
});

test('reminders flatten user-controlled newlines/control characters and contain no HTML tags', () => {
  const state = reminderState();
  state.members.find(x => x.id === 'owner').name = '<b>검토</b>\n다른행\u0007';
  state.plans[0].task = '<img src=x>\r\n줄바꿈';
  const text = makeReminder(state, week, { kind: 'review', deadline: '<strong>금요일</strong>\n가짜줄' });
  assert.doesNotMatch(text, /<[^>]*>|\u0007|\n가짜줄|\n다른행|\n줄바꿈/);
  assert.match(text, /검토/);
  assert.match(text, /금요일/);
});
