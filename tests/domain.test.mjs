import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, monday, shiftDay, nextWeek, planIssues, weekPlans, memberStatuses, weekChanged, applyCommand } from '../lib/domain.mjs';
import { makeNotice, makeCsv, changeSummary } from '../lib/exports.mjs';

const week = '2026-10-05';
const now = '2026-10-03T09:00:00.000Z';
let sequence = 0;
function command(state, type, fields = {}, requestId = `r-${++sequence}`) {
  return applyCommand(state, {type, requestId, expectedRevision: state.revision, ...fields}, {now, id:`id-${++sequence}`});
}
function roster() {
  let state = emptyState();
  for (const name of ['예시 가', '예시 나', '예시 다', '예시 라']) state = command(state, 'addMember', {name});
  return state;
}
const item = (overrides = {}) => ({date:week, time:'09:00', place:'1포장', task:'토양 채취', assignees:['예시 나'], notes:'', reviewed:true, ...overrides});
function submitted(state = roster(), overrides = {}) {
  return command(state, 'submit', {week, submitterId:state.members[0].id, sourceText:'월 / 09:00 / 1포장 / 토양 채취 / 담당 예시 나', items:[item()], ...overrides});
}
function deepFreeze(value) { Object.freeze(value); for (const v of Object.values(value)) if(v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return value; }

test('calendar math validates actual dates and next Monday uses Korea time', () => {
  assert.equal(monday('2026-10-11'), week);
  assert.equal(shiftDay('2024-02-28', 1), '2024-02-29');
  assert.equal(nextWeek(new Date('2026-10-04T14:59:00Z')), week);
  assert.equal(nextWeek(new Date('2026-10-04T15:00:00Z')), '2026-10-12');
  assert.throws(() => monday('2026-02-30'));
  assert.throws(() => shiftDay('2026-10-05', 1.5));
});

test('create and edit are immutable, preserve source and submitter, and retain history', () => {
  const original = deepFreeze(roster());
  const state = submitted(original);
  assert.equal(original.plans.length, 0);
  assert.equal(state.plans.length, 1);
  const plan = state.plans[0];
  const edited = command(deepFreeze(state), 'editPlan', {id:plan.id, patch:{task:'토양 수분 조사'}});
  assert.equal(state.plans[0].task, '토양 채취');
  assert.equal(edited.plans[0].sourceText, plan.sourceText);
  assert.equal(edited.plans[0].submitterId, original.members[0].id);
  assert.ok(JSON.stringify(edited.history).includes('토양 채취'));
  assert.ok(JSON.stringify(edited.history).includes('토양 수분 조사'));
  for (const patch of [{sourceText:'위조'}, {week:'2026-10-12'}, {submitterId:original.members[1].id}]) {
    assert.throws(() => command(edited, 'editPlan', {id:plan.id, patch}), /허용|필드|수정/);
  }
});

test('submission is attributed to submitter, not assigned coworker; missing differs from noWork', () => {
  let state = submitted();
  state = command(state, 'noWork', {week, memberId:state.members[2].id});
  assert.deepEqual(memberStatuses(state, week).map(x => x.status), ['submitted','missing','none','missing']);
  assert.deepEqual(memberStatuses(state, '2026-10-12').map(x => x.status), ['missing','missing','missing','missing']);
  assert.throws(() => command(state, 'noWork', {week,memberId:state.members[0].id}));
});

test('cancel and restore are explicit; cancelling last submission returns to missing', () => {
  let state = submitted();
  const id = state.plans[0].id;
  state = command(state, 'cancelPlan', {id, cancelled:true});
  assert.equal(weekPlans(state,week).length, 0);
  assert.equal(weekPlans(state,week,true).length, 1);
  assert.equal(memberStatuses(state,week)[0].status, 'missing');
  state = command(state, 'noWork', {week,memberId:state.members[0].id});
  state = command(state, 'cancelPlan', {id,cancelled:false});
  assert.equal(weekPlans(state,week).length, 1);
  assert.equal(state.noWork.length, 0);
  assert.throws(() => command(state, 'cancelPlan', {id,cancelled:'false'}));
});

test('new submission clears only its week/submitter noWork, and week data never leaks', () => {
  let state = roster();
  state = command(state,'noWork',{week,memberId:state.members[0].id});
  state = command(state,'noWork',{week:'2026-10-12',memberId:state.members[0].id});
  state = submitted(state);
  assert.equal(state.noWork.length, 1);
  assert.equal(state.noWork[0].week,'2026-10-12');
  assert.equal(weekPlans(state,'2026-10-12').length,0);
  assert.equal(makeNotice(state,'2026-10-12').includes('토양 채취'),false);
});

test('missing fields and unreviewed plans block finalize; time is optional', () => {
  assert.deepEqual(planIssues(item({time:''})), []);
  assert.ok(planIssues(item({date:null,place:'',assignees:[],reviewed:false})).length >= 4);
  let state = submitted(roster(), {items:[item({reviewed:false})]});
  assert.equal(memberStatuses(state,week)[0].status,'review');
  assert.throws(() => command(state,'finalize',{week}), /검토|확인/);
  assert.throws(() => command(roster(),'finalize',{week}), /없/);
});

test('finalize freezes active effective content and names missing members; changes compare content not metadata', () => {
  let state = submitted();
  state = command(state,'finalize',{week});
  assert.equal(state.snapshots.length,1);
  const snapshot = JSON.stringify(state.snapshots[0]);
  assert.ok(state.snapshots[0].notice.includes('예시 라'));
  assert.equal(weekChanged(state,week),false);
  state = command(state,'editPlan',{id:state.plans[0].id,patch:{task:'토양 채취'}});
  assert.equal(weekChanged(state,week),false);
  state = command(state,'editPlan',{id:state.plans[0].id,patch:{task:'새 조사'}});
  assert.equal(weekChanged(state,week),true);
  assert.equal(JSON.stringify(state.snapshots[0]),snapshot);
  assert.match(changeSummary(state,week),/수정|변경/);
  assert.equal(weekChanged(state,'2026-10-12'),false);
  state = command(state,'cancelPlan',{id:state.plans[0].id,cancelled:true});
  assert.match(changeSummary(state,week),/취소/);
  state = command(state,'noWork',{week,memberId:state.members[0].id});
  assert.match(changeSummary(state,week),/작업 없음|미제출|제출 상태/);
});

test('no-work-only week can be frozen; later submission and membership change are visible', () => {
  let state = roster();
  state = command(state,'noWork',{week,memberId:state.members[0].id});
  state = command(state,'finalize',{week});
  assert.equal(state.snapshots[0].plans.length,0);
  state = submitted(state);
  assert.match(changeSummary(state,week),/추가/);
  state = command(state,'addMember',{name:'새 담당자'});
  assert.equal(weekChanged(state,week),true);
  assert.match(changeSummary(state,week),/새 담당자/);
});

test('malformed batch is atomic; exact types, weeks, members, and dates are validated', () => {
  const state = roster(); const before = JSON.stringify(state);
  const invalid = [
    {items:[item(), item({task:''})]}, {items:[]}, {items:[item({date:'2026-10-12'})]},
    {items:[item({date:'2026-02-30'})]}, {items:[item({reviewed:'true'})]},
    {items:[item({assignees:'가'})]}, {items:[item({sourceText:'위조'})]},
    {week:'2026-10-06'}, {submitterId:'missing'}, {sourceText:'x'.repeat(8001)},
    {sourceText:null}, {items:[item({time:null})]}, {items:[item({notes:null})]}, {items:[item({place:null})]},
    {items:[item(), , item()]}, {items:[item({assignees:['가', , '나']})]},
  ];
  for(const extra of invalid) assert.throws(() => submitted(state,extra));
  assert.equal(JSON.stringify(state),before);
  assert.throws(() => command(state,'editPlan',{id:'unknown',patch:{task:'x'}}));
  assert.throws(() => command(state,'submit',{week,submitterId:state.members[0].id,sourceText:'',items:[item()],extra:true}));
});

test('exact request replay survives stale revision; changed payload and stale new request conflict', () => {
  const state = roster();
  const cmd = {type:'submit',requestId:'stable-request',expectedRevision:state.revision,week,submitterId:state.members[0].id,sourceText:'원문',items:[item()]};
  let after = applyCommand(state,cmd,{now,id:'stable-id'});
  after = command(after,'addMember',{name:'예시 마'});
  const replay = applyCommand(after,structuredClone(cmd),{now,id:'different-id'});
  assert.deepEqual(replay,after);
  assert.notEqual(replay,after);
  assert.throws(() => applyCommand(after,{...cmd,sourceText:'다른 원문'}),e => e.code === 'CONFLICT');
  assert.throws(() => applyCommand(after,{...cmd,requestId:'new-request'}),e => e.code === 'CONFLICT');
  assert.throws(() => applyCommand(after,{type:'addMember',name:'가'}));
});

test('limits reject more members/plans/receipts and bounded audit structures stay bounded', () => {
  const state = roster();
  const fullMembers = {...state,members:Array.from({length:100},(_,i) => ({id:`m${i}`,name:`예시${i}`}))};
  assert.throws(() => command(fullMembers,'addMember',{name:'초과'}));
  const fullPlans = {...state,plans:Array.from({length:2000},(_,i) => ({...item(),id:`p${i}`,week,submitterId:state.members[0].id,cancelled:false}))};
  assert.throws(() => submitted(fullPlans));
  const fullReceipts = {...state,receipts:Array.from({length:5000},(_,i) => ({requestId:`q${i}`}))};
  assert.throws(() => command(fullReceipts,'addMember',{name:'초과'}));
  const longHistory = {...state,history:Array.from({length:1000},() => ({type:'old'}))};
  const before = JSON.stringify(longHistory);
  assert.throws(() => command(longHistory,'addMember',{name:'예시 새'}),e => e.code === 'LIMIT');
  assert.equal(JSON.stringify(longHistory),before);
  const almostFullHistory = {...state,history:Array.from({length:999},() => ({type:'old'}))};
  assert.throws(() => submitted(almostFullHistory,{items:[item(),item()]}),e => e.code === 'LIMIT');
  assert.equal(almostFullHistory.plans.length,0);
  const withPlan = submitted();
  const fullSnapshots = {...withPlan,snapshots:Array.from({length:100},(_,i) => ({id:`snap-${i}`,week,plans:[]}))};
  const frozenBefore = JSON.stringify(fullSnapshots);
  assert.throws(() => command(fullSnapshots,'finalize',{week}),e => e.code === 'LIMIT');
  assert.equal(JSON.stringify(fullSnapshots),frozenBefore);
});

test('example load is visibly synthetic, gives four status cases, and never merges into existing state', () => {
  const state = command(emptyState(),'loadExample',{week});
  assert.equal(state.members.length,4);
  assert.ok(state.members.every(x => /예시/.test(x.name)));
  assert.deepEqual(memberStatuses(state,week).map(x => x.status),['submitted','review','none','missing']);
  assert.throws(() => command(state,'loadExample',{week}));
});

test('CSV uses BOM, quoting, formula neutralization, active current week rows and submitter names', () => {
  let state = submitted(roster(),{items:[item({place:'  =HYPERLINK("x")',task:'+cmd',notes:'\t@SUM(1)\n"메모"',assignees:['-인원']})]});
  const csv = makeCsv(state,week);
  assert.ok(csv.startsWith('\ufeff'));
  assert.equal(csv.split('\r\n')[0],'\ufeff"대상 주","작업일","시간","포장","작업내용","담당자","제출자","비고","상태"');
  assert.ok(csv.includes("'  =HYPERLINK"));
  assert.ok(csv.includes("'+cmd"));
  assert.ok(csv.includes("'\t@SUM"));
  assert.ok(csv.includes('""메모""'));
  assert.ok(csv.includes('예시 가'));
  assert.equal(makeCsv(state,'2026-10-12').split('\r\n').filter(Boolean).length,1);
  state = command(state,'cancelPlan',{id:state.plans[0].id,cancelled:true});
  assert.equal(makeCsv(state,week).includes('+cmd'),false);
});

test('change summary shows changed time, place, dates, assignees and bounded notes', () => {
  const frozen = command(submitted(),'finalize',{week});
  const timeChanged = command(frozen,'editPlan',{id:frozen.plans[0].id,patch:{time:'14:30'}});
  assert.match(changeSummary(timeChanged,week),/시간: 09:00 → 14:30/);
  assert.doesNotMatch(changeSummary(timeChanged,week),/토양 채취 → 토양 채취/);
  const changed = command(timeChanged,'editPlan',{id:frozen.plans[0].id,patch:{place:'시험포장 B',date:'2026-10-06',assignees:['예시 다'],notes:'아'.repeat(2000)}});
  const summary = changeSummary(changed,week);
  assert.match(summary,/포장: 1포장 → 시험포장 B/);
  assert.match(summary,/작업일: 2026-10-05 → 2026-10-06/);
  assert.match(summary,/담당자: 예시 나 → 예시 다/);
  assert.match(summary,/비고: 미입력 → 아/);
  assert.ok(summary.length < 600);
  assert.ok(summary.includes('…'));
});

test('notice is provisional text with missing/review/no-work labels and never sends', () => {
  const state = command(emptyState(),'loadExample',{week});
  const notice = makeNotice(state,week);
  for (const pattern of [/임시|가안/,/미제출/,/검토/,/작업 없음/,/2026-10-05/]) assert.match(notice,pattern);
});
