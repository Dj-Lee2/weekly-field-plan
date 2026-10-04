import { makeNotice } from './exports.mjs';
import { koreaToday } from './calendar.mjs';

const DAY = 86400000;
const EDIT_FIELDS = ['date', 'time', 'place', 'task', 'assignees', 'notes', 'reviewed'];
const LIMITS = { members: 100, plans: 2000, receipts: 5000, history: 1000, snapshots: 100, noWork: 5000 };
const commandFields = {
  addMember: ['name'], submit: ['week', 'submitterId', 'sourceText', 'items'],
  editPlan: ['id', 'patch'], cancelPlan: ['id', 'cancelled'],
  recordResult: ['id', 'result'], loadHistoryExample: ['week'],
  copyPlans: ['sourceWeek', 'targetWeek', 'planIds'],
  noWork: ['week', 'memberId'], finalize: ['week'], loadExample: ['week'],
};

function fail(message, code = 'VALIDATION') { throw Object.assign(new Error(message), { code }); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function fields(value, allowed, label) {
  if (!plain(value)) fail(`${label} 형식이 올바르지 않습니다.`);
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${label}에 허용되지 않은 필드가 있습니다.`);
}
function text(value, label, max, required = false, trim = true) {
  if (typeof value !== 'string' || value.length > max || /\u0000/.test(value)) fail(`${label}: 문자열 길이 또는 형식을 확인해 주세요. (최대 ${max}자)`);
  if (required && !value.trim()) fail(`${label}을 입력해 주세요.`);
  return trim ? value.trim() : value;
}
function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail('실제 달력에 있는 날짜를 입력해 주세요.');
  return date;
}
function weekValue(value) {
  if (monday(value) !== value) fail('선택 주의 시작일은 월요일이어야 합니다.');
  return value;
}
function canonical(value, depth = 0) {
  if (depth > 20) fail('입력 구조가 너무 깊습니다.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, item => canonical(item, depth + 1)).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
  fail('JSON으로 저장 가능한 값만 입력해 주세요.');
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assertState(state) {
  if (!plain(state) || state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0) fail('저장 자료의 버전을 확인해 주세요.');
  for (const key of Object.keys(LIMITS)) if (!Array.isArray(state[key])) fail('저장 자료 형식이 올바르지 않습니다.');
}
function capacity(state, key, add = 1) { if (state[key].length + add > LIMITS[key]) fail(`로컬 초안의 ${key} 저장 한도(${LIMITS[key]})에 도달했습니다. 자료를 내보내 보관해 주세요.`, 'LIMIT'); }
function member(state, id) {
  if (typeof id !== 'string' || !state.members.some(m => m.id === id)) fail('등록된 제출자를 선택해 주세요.');
}
function normalizeItem(input, week) {
  fields(input, EDIT_FIELDS, '작업 항목');
  const date = input.date === undefined ? null : input.date;
  if (date !== null) { dateValue(date); if (monday(date) !== week) fail('작업 날짜가 선택한 주에 속하지 않습니다.'); }
  const assignees = input.assignees === undefined ? [] : input.assignees;
  if (!Array.isArray(assignees) || assignees.length > 30) fail('담당자는 최대 30명의 이름 목록이어야 합니다.');
  const reviewed = input.reviewed === undefined ? false : input.reviewed;
  if (typeof reviewed !== 'boolean') fail('검토 여부는 true 또는 false여야 합니다.');
  return {
    date, time: text(input.time === undefined ? '' : input.time, '시간', 100), place: text(input.place === undefined ? '' : input.place, '장소', 200, false, false),
    task: text(input.task, '작업 내용', 1000, true),
    assignees: [...new Set(assignees.map(name => text(name, '담당자 이름', 80, true)))],
    notes: text(input.notes === undefined ? '' : input.notes, '비고', 2000, false, false), reviewed,
  };
}
function effectivePlan(plan) {
  const { createdAt, updatedAt, cancelled, result, ...content } = plan;
  return content;
}
function normalizeResult(input, now) {
  fields(input, ['status', 'date', 'summary', 'recorder'], '작업 결과');
  if (!['done', 'partial', 'not-done'].includes(input.status)) fail('결과 상태는 완료, 일부 완료, 미실시 중에서 선택해 주세요.');
  dateValue(input.date);
  if (input.date > koreaToday(now)) fail('실제 작업일 또는 평가일은 한국 시간 오늘 이후일 수 없습니다.');
  return {
    status: input.status, date: input.date,
    summary: text(input.summary, '결과 요약', 2000, true, false),
    recorder: text(input.recorder, '기록자', 80, true),
  };
}

function prepareHistoryExample(state, week, now) {
  weekValue(week);
  capacity(state, 'plans', 4); capacity(state, 'history', 8);
  if (state.history.some(event => event.type === 'loadHistoryExample')) fail('과거 결과 예시는 이미 불러왔습니다. 중복으로 추가할 수 없습니다.');
  const initial = state.history[2], originals = state.history.slice(0, 2);
  // Fail closed: only the pristine two-plan loadExample state is eligible.
  // A marker in arbitrary source text is not proof that a draft is synthetic.
  if (state.revision !== 1 || state.receipts.length !== 1 || state.history.length !== 3
    || initial?.type !== 'loadExample' || initial.week !== week
    || state.members.length !== 4 || !state.members.every((m, i) => m.name === `예시 연구원 ${['가', '나', '다', '라'][i]}`)
    || state.plans.length !== 2 || originals.some(event => event.type !== 'submit' || !event.after?.sourceText?.startsWith('[예시 원문]'))
    || canonical(state.plans) !== canonical(originals.map(event => event.after))
    || state.snapshots.length || state.noWork.length !== 1 || state.noWork[0].week !== week || state.noWork[0].memberId !== state.members[2].id) {
    fail('과거 결과 예시는 처음 불러온 예시 초안에서만 추가할 수 있습니다. 실제 자료나 수정한 초안에는 섞을 수 없습니다.');
  }
  const fixtures = [
    { offset: -7, status: 'done', task: '제초 완료 (예시)', summary: '예시: 계획한 구역의 제초를 마쳤다는 시연 기록입니다. 실제 작업 결과가 아닙니다.' },
    { offset: -12, status: 'partial', task: '토양 시료 채취 (예시)', summary: '예시: 일부 구역만 채취하고 나머지는 진행하지 않았다는 시연 기록입니다.' },
    { offset: -17, status: 'not-done', task: '포장 점검 (예시)', summary: '예시: 해당 작업을 실시하지 않았다고 평가한 시연 기록입니다.' },
    { offset: -10, status: null, task: '결과 미기록 작업 (예시)' },
  ].map(fixture => ({ ...fixture, date: shiftDay(week, fixture.offset) }));
  if (fixtures.some(fixture => fixture.date > koreaToday(now))) fail('과거 예시 날짜가 미래가 되는 주에는 불러올 수 없습니다.');
  return fixtures;
}
function effectiveContent(plans, members, noWork) {
  return canonical({
    plans: plans.map(effectivePlan).sort((a, b) => a.id.localeCompare(b.id)),
    members: [...members].sort((a, b) => a.id.localeCompare(b.id)),
    noWork: noWork.map(({ week, memberId }) => ({ week, memberId })).sort((a, b) => a.memberId.localeCompare(b.memberId)),
  });
}

export function emptyState() { return { schemaVersion: 1, revision: 0, members: [], plans: [], noWork: [], snapshots: [], history: [], receipts: [] }; }
export function monday(dateISO) {
  const date = dateValue(dateISO);
  return shiftDay(dateISO, -((date.getUTCDay() + 6) % 7));
}
export function shiftDay(dateISO, days) {
  if (!Number.isSafeInteger(days)) fail('이동 일수는 정수여야 합니다.');
  const shifted = new Date(dateValue(dateISO).getTime() + days * DAY);
  if (!Number.isFinite(shifted.getTime()) || !/^\d{4}-/.test(shifted.toISOString())) fail('지원 날짜 범위를 벗어났습니다.');
  return shifted.toISOString().slice(0, 10);
}
export function nextWeek(now = new Date()) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) fail('현재 시각이 올바르지 않습니다.');
  const koreaDate = new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  return shiftDay(monday(koreaDate), 7);
}
export function planIssues(plan) {
  const issues = [];
  if (!plan.date) issues.push('날짜 확인 필요');
  if (!plan.place?.trim()) issues.push('장소 확인 필요');
  if (!plan.task?.trim()) issues.push('작업 내용 확인 필요');
  if (!Array.isArray(plan.assignees) || !plan.assignees.length) issues.push('담당자 확인 필요');
  if (plan.reviewed !== true) issues.push('원문 대조 검토 필요');
  return issues;
}
export function weekPlans(state, week, includeCancelled = false) {
  weekValue(week);
  return clone(state.plans.filter(plan => plan.week === week && (includeCancelled || !plan.cancelled)))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.time.localeCompare(b.time, 'ko') || a.id.localeCompare(b.id));
}
export function memberStatuses(state, week) {
  const plans = weekPlans(state, week);
  return state.members.map(m => {
    const owned = plans.filter(plan => plan.submitterId === m.id);
    const status = owned.length ? (owned.some(plan => planIssues(plan).length) ? 'review' : 'submitted')
      : state.noWork.some(n => n.week === week && n.memberId === m.id) ? 'none' : 'missing';
    return { memberId: m.id, name: m.name, status, count: owned.length };
  });
}
export function weekChanged(state, week) {
  weekValue(week);
  const snapshot = [...state.snapshots].reverse().find(s => s.week === week);
  if (!snapshot) return false;
  return effectiveContent(weekPlans(state, week), state.members, state.noWork.filter(n => n.week === week))
    !== effectiveContent(snapshot.plans, snapshot.members, snapshot.noWork);
}

// Preview and commit share one preflight. It includes capacity checks, but
// command receipts are still checked first so an exact retry remains a no-op.
function prepareCopies(state, sourceWeek, targetWeek, planIds) {
  assertState(state);
  weekValue(sourceWeek); weekValue(targetWeek);
  if (targetWeek !== shiftDay(sourceWeek, 7)) fail('복사 대상은 선택한 주의 바로 다음 주여야 합니다.');
  if (!Array.isArray(planIds) || !planIds.length || planIds.length > 30) fail('복사할 작업을 1~30개 선택해 주세요.');
  const selectedIds = Array.from(planIds);
  if (selectedIds.some(id => typeof id !== 'string' || !id.trim())) fail('복사할 작업 ID를 확인해 주세요.');
  if (new Set(selectedIds).size !== selectedIds.length) fail('같은 작업을 중복 선택할 수 없습니다.');
  const byId = new Map(state.plans.map(plan => [plan.id, plan]));
  const alreadyCopied = new Set(state.plans.filter(p => p.week === targetWeek && p.copiedFrom).map(p => p.copiedFrom.planId));
  const copies = selectedIds.map(id => {
    const source = byId.get(id);
    if (!source || source.week !== sourceWeek || source.cancelled) fail('선택한 주의 활성 작업만 복사할 수 있습니다. 작업을 다시 확인해 주세요.');
    if (alreadyCopied.has(id)) fail('이미 다음 주로 복사한 작업입니다. 기존 복사본을 수정하거나 취소한 복사본을 복원해 주세요.');
    member(state, source.submitterId);
    text(source.sourceText, '원문', 8000, false, false);
    const item = Object.fromEntries(EDIT_FIELDS.map(key => [key, source[key]]));
    // Validate the existing schema without normalizing away preserved text.
    normalizeItem(item, sourceWeek);
    item.date = source.date === null ? null : shiftDay(source.date, 7);
    item.reviewed = false;
    return { source, item: clone(item) };
  });
  capacity(state, 'plans', copies.length);
  capacity(state, 'history', copies.length);
  capacity(state, 'receipts');
  if (state.revision === Number.MAX_SAFE_INTEGER) fail('자료 버전 한도에 도달했습니다.', 'LIMIT');
  return copies;
}

export function previewCopyPlans(state, sourceWeek, targetWeek, planIds) {
  return prepareCopies(state, sourceWeek, targetWeek, planIds).map(({ source, item }) => ({
    sourceId: source.id, task: item.task, fromDate: source.date, date: item.date,
    time: item.time, place: item.place, assignees: item.assignees, submitterId: source.submitterId,
  }));
}

export function applyCommand(state, command, context = {}) {
  assertState(state);
  if (!plain(command) || !Object.hasOwn(commandFields, command.type)) fail('지원하지 않는 명령입니다.');
  fields(command, ['type', 'requestId', 'expectedRevision', ...commandFields[command.type]], '명령');
  text(command.requestId, '요청 ID', 128, true);
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) fail('자료 버전(expectedRevision)을 확인해 주세요.');
  const payload = canonical(command);
  if (payload.length > 131072) fail('한 번에 처리할 수 있는 입력량을 초과했습니다.');
  const receipt = state.receipts.find(r => r.requestId === command.requestId);
  if (receipt) {
    if (receipt.payload !== payload) fail('같은 요청 ID의 내용이 달라졌습니다. 새 요청 ID로 다시 검토해 주세요.', 'CONFLICT');
    return clone(state);
  }
  if (command.expectedRevision !== state.revision) fail('다른 창에서 자료가 변경되었습니다. 새로 불러온 뒤 다시 검토해 주세요.', 'CONFLICT');
  capacity(state, 'receipts');
  if (state.revision === Number.MAX_SAFE_INTEGER) fail('자료 버전 한도에 도달했습니다.', 'LIMIT');
  const now = context.now ?? new Date().toISOString();
  if (typeof now !== 'string' || !Number.isFinite(new Date(now).getTime())) fail('기록 시각이 올바르지 않습니다.');
  const baseId = text(context.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, '기록 ID', 128, true);
  let index = 0;
  const used = new Set([...state.members, ...state.plans, ...state.snapshots, ...state.history].map(x => x.id));
  const id = () => { let value; do { value = `${baseId}-${++index}`; } while (used.has(value)); used.add(value); return value; };
  const next = clone(state);
  function audit(type, before = null, after = null, extra = {}) {
    next.history.push({ id: id(), at: now, type, planId: after?.id ?? before?.id ?? null, before: clone(before), after: clone(after), ...extra });
  }
  function clearNoWork(week, memberId) { next.noWork = next.noWork.filter(n => n.week !== week || n.memberId !== memberId); }
  function createPlan(week, submitterId, sourceText, item) {
    const plan = { id: id(), week, ...item, submitterId, sourceText, cancelled: false, createdAt: now, updatedAt: now };
    next.plans.push(plan); audit('submit', null, plan); return plan;
  }
  function recordResult(plan, input) {
    if (plan.cancelled) fail('취소된 계획에는 결과를 기록할 수 없습니다. 먼저 계획을 복원해 주세요.');
    const result = normalizeResult(input, now), before = clone(plan);
    const planSnapshot = plan.result?.planSnapshot ?? Object.fromEntries(['task', 'date', 'time', 'place', 'assignees'].map(key => [key, plan[key]]));
    plan.result = { ...result, recordedAt: plan.result?.recordedAt ?? now, updatedAt: now, planSnapshot: clone(planSnapshot) };
    plan.updatedAt = now;
    audit('recordResult', before, plan);
  }
  if (command.type === 'addMember') {
    const name = text(command.name, '이름', 40, true);
    if (next.members.some(m => m.name === name)) fail('같은 표시 이름이 이미 있습니다. 구분할 수 있는 이름을 입력해 주세요.');
    capacity(next, 'members'); next.members.push({ id: id(), name }); audit('addMember', null, null, { name });
  } else if (command.type === 'submit') {
    const week = weekValue(command.week); member(next, command.submitterId);
    const sourceText = text(command.sourceText === undefined ? '' : command.sourceText, '원문', 8000, false, false);
    if (!Array.isArray(command.items) || !command.items.length || command.items.length > 30) fail('작업은 한 번에 1~30개 제출할 수 있습니다.');
    capacity(next, 'plans', command.items.length);
    // Validate every item before adding any record or audit entry.
    const items = command.items.map(item => normalizeItem(item, week));
    clearNoWork(week, command.submitterId);
    for (const item of items) createPlan(week, command.submitterId, sourceText, item);
  } else if (command.type === 'copyPlans') {
    const copies = prepareCopies(next, command.sourceWeek, command.targetWeek, command.planIds);
    for (const { source, item } of copies) {
      const plan = {
        id: id(), week: command.targetWeek, ...item, submitterId: source.submitterId,
        sourceText: source.sourceText, reviewed: false, cancelled: false,
        copiedFrom: { planId: source.id, week: command.sourceWeek }, createdAt: now, updatedAt: now,
      };
      clearNoWork(command.targetWeek, source.submitterId);
      next.plans.push(plan);
      audit('copyPlans', null, plan, { sourcePlanId: source.id, sourceWeek: command.sourceWeek });
    }
  } else if (command.type === 'recordResult') {
    const plan = next.plans.find(p => p.id === command.id);
    if (!plan) fail('결과를 기록할 작업을 찾지 못했습니다.');
    capacity(next, 'history');
    recordResult(plan, command.result);
  } else if (command.type === 'editPlan' || command.type === 'cancelPlan') {
    const plan = next.plans.find(p => p.id === command.id);
    if (!plan) fail('수정할 작업을 찾지 못했습니다.');
    const before = clone(plan);
    if (command.type === 'editPlan') {
      fields(command.patch, EDIT_FIELDS, '수정 항목');
      if (!Object.keys(command.patch).length) fail('수정할 항목이 없습니다.');
      const editable = Object.fromEntries(EDIT_FIELDS.map(key => [key, plan[key]]));
      Object.assign(plan, normalizeItem({ ...editable, ...command.patch }, plan.week));
    } else {
      if (typeof command.cancelled !== 'boolean') fail('취소 여부는 true 또는 false여야 합니다.');
      plan.cancelled = command.cancelled;
      if (!plan.cancelled) clearNoWork(plan.week, plan.submitterId);
    }
    plan.updatedAt = now; audit(command.type, before, plan);
  } else if (command.type === 'noWork') {
    const week = weekValue(command.week); member(next, command.memberId);
    if (next.plans.some(p => p.week === week && p.submitterId === command.memberId && !p.cancelled)) fail('진행 중인 제출 작업이 있습니다. 먼저 해당 작업을 취소해 주세요.');
    clearNoWork(week, command.memberId); capacity(next, 'noWork');
    next.noWork.push({ week, memberId: command.memberId, updatedAt: now });
    audit('noWork', null, null, { week, memberId: command.memberId });
  } else if (command.type === 'finalize') {
    const week = weekValue(command.week);
    const plans = weekPlans(next, week), noWork = next.noWork.filter(n => n.week === week);
    if (!plans.length && !noWork.length) fail('확정할 작업 또는 작업 없음 제출이 없습니다.');
    if (plans.some(plan => planIssues(plan).length)) fail('모든 활성 작업의 누락 항목과 원문 대조 검토를 완료해 주세요.');
    const snapshot = { id: id(), week, createdAt: now, plans, members: clone(next.members), noWork: clone(noWork), statuses: memberStatuses(next, week), notice: makeNotice(next, week) };
    capacity(next, 'snapshots'); next.snapshots.push(snapshot);
    audit('finalize', null, null, { week, snapshotId: snapshot.id });
  } else if (command.type === 'loadHistoryExample') {
    const fixtures = prepareHistoryExample(next, command.week, now);
    for (const [index, fixture] of fixtures.entries()) {
      const week = monday(fixture.date), owner = next.members[index % 2];
      const plan = createPlan(week, owner.id, `[예시 과거 원문] ${fixture.date} / 예시 포장 / ${fixture.task} / 실제 자료가 아닌 시연용 예시`, normalizeItem({
        date: fixture.date, time: '오전', place: `예시 포장 ${index % 2 ? 'B' : 'A'}`, task: fixture.task,
        assignees: [owner.name], notes: '과거 작업과 결과 조회를 위한 예시입니다. 실제 측정값이나 작업 실적이 아닙니다.', reviewed: true,
      }, week));
      if (fixture.status) recordResult(plan, { status: fixture.status, date: fixture.date, summary: fixture.summary, recorder: '예시 기록자' });
    }
    audit('loadHistoryExample', null, null, { week: command.week });
  } else if (command.type === 'loadExample') {
    const week = weekValue(command.week);
    if (next.revision !== 0 || ['members', 'plans', 'noWork', 'snapshots', 'history', 'receipts'].some(key => next[key].length)) fail('예시 자료는 완전히 빈 초안에서만 불러올 수 있습니다.');
    next.members = ['가', '나', '다', '라'].map(label => ({ id: id(), name: `예시 연구원 ${label}` }));
    createPlan(week, next.members[0].id, '[예시 원문] 월요일 오전 / 시험포장 A / 제초 / 담당: 예시 연구원 가', normalizeItem({ date: week, time: '오전', place: '시험포장 A', task: '제초 (예시)', assignees: [next.members[0].name], notes: '실제 일정이 아닌 예시입니다.', reviewed: true }, week));
    createPlan(week, next.members[1].id, '[예시 원문] 수요일 오후 토양 시료 채취. 장소 확인 필요', normalizeItem({ date: shiftDay(week, 2), time: '오후', place: '', task: '토양 시료 채취 (예시)', assignees: [next.members[1].name], notes: '장소와 원문 대조 검토가 필요한 예시입니다.', reviewed: false }, week));
    next.noWork.push({ week, memberId: next.members[2].id, updatedAt: now });
    audit('loadExample', null, null, { week });
  }
  next.revision += 1;
  // Never discard source/audit evidence silently. The entire command fails on
  // a private copy, so callers and the SQLite transaction retain every record.
  capacity(next, 'history', 0);
  next.receipts.push({ requestId: command.requestId, payload, revision: next.revision, at: now });
  return next;
}
