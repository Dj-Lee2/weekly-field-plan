import { weekPlans, memberStatuses, planIssues, shiftDay } from './domain.mjs';

const statusLabel = { submitted: '제출 완료', review: '검토 필요', none: '작업 없음', missing: '미제출' };
const singleLine = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
function dayLabel(date) { return date ? `${date} (${'일월화수목금토'[new Date(`${date}T00:00:00Z`).getUTCDay()]})` : '날짜 확인 필요'; }

export function makeNotice(state, week) {
  const plans = weekPlans(state, week);
  const statuses = memberStatuses(state, week);
  const lines = [
    '[주간 포장작업 계획 · 임시 양식 가안]',
    `${week} ~ ${shiftDay(week, 6)}`,
    '※ 기존 양식 미수령 · 담당자 검토용 · 카카오톡 자동발송 없음',
    '',
  ];
  let previous;
  for (const plan of plans) {
    if (plan.date !== previous) { if (previous !== undefined) lines.push(''); lines.push(`■ ${dayLabel(plan.date)}`); previous = plan.date; }
    const submitter = state.members.find(m => m.id === plan.submitterId)?.name ?? '제출자 확인 필요';
    lines.push(`- ${singleLine(plan.time) || '시간 미정'} | ${singleLine(plan.place) || '장소 확인 필요'} | ${singleLine(plan.task)}`);
    lines.push(`  담당: ${plan.assignees.map(singleLine).join(', ') || '확인 필요'} / 제출: ${singleLine(submitter)}`);
    if (plan.notes) lines.push(`  비고: ${singleLine(plan.notes)}`);
    const issues = planIssues(plan);
    if (issues.length) lines.push(`  [검토 필요: ${issues.join(', ')}]`);
  }
  if (!plans.length) lines.push('등록된 활성 작업 없음');
  lines.push('', '■ 제출 현황');
  for (const status of ['submitted', 'review', 'none', 'missing']) {
    const names = statuses.filter(s => s.status === status).map(s => singleLine(s.name));
    lines.push(`${statusLabel[status]}: ${names.join(', ') || '없음'}`);
  }
  return lines.join('\n');
}

function csvCell(value) {
  let cell = String(value ?? '');
  // Prefix the original cell, not a trimmed copy. Includes spaces, tabs, BOM,
  // control characters and Unicode whitespace before an Excel formula marker.
  if (/^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}
export function makeCsv(state, week) {
  const rows = [['대상 주', '작업일', '시간', '포장', '작업내용', '담당자', '제출자', '비고', '상태']];
  for (const plan of weekPlans(state, week)) {
    rows.push([plan.week, plan.date ?? '', plan.time, plan.place, plan.task, plan.assignees.join(', '), state.members.find(m => m.id === plan.submitterId)?.name ?? '', plan.notes, planIssues(plan).length ? '검토 필요' : '제출 완료']);
  }
  return `\ufeff${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
function brief(value) {
  const text = singleLine(Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? '검토 완료' : '검토 필요') : value) || '미입력';
  const chars = [...text];
  return chars.length > 80 ? `${chars.slice(0, 80).join('')}…` : text;
}
const changedFields = [['date', '작업일'], ['time', '시간'], ['place', '포장'], ['task', '작업내용'], ['assignees', '담당자'], ['notes', '비고'], ['reviewed', '검토'], ['submitterId', '제출자'], ['sourceText', '원문']];
export function changeSummary(state, week) {
  const plans = weekPlans(state, week);
  const snapshot = [...state.snapshots].reverse().find(s => s.week === week);
  if (!snapshot) return '아직 확정본이 없습니다. 현재 초안을 검토해 주세요.';
  const changes = [];
  const old = new Map(snapshot.plans.map(p => [p.id, p]));
  const current = new Map(plans.map(p => [p.id, p]));
  for (const plan of plans) {
    if (!old.has(plan.id)) changes.push(`추가: ${dayLabel(plan.date)} · ${brief(plan.task)}`);
    else {
      const prior = old.get(plan.id);
      const edits = changedFields.filter(([key]) => JSON.stringify(prior[key]) !== JSON.stringify(plan[key]));
      if (edits.length) changes.push(`수정: ${dayLabel(plan.date)} · ${brief(plan.task)}\n${edits.map(([key, label]) => `  ${label}: ${brief(prior[key])} → ${brief(plan[key])}`).join('\n')}`);
    }
  }
  for (const plan of snapshot.plans) if (!current.has(plan.id)) changes.push(`취소: ${dayLabel(plan.date)} · ${brief(plan.task)}`);
  const priorStatuses = new Map(snapshot.statuses.map(s => [s.memberId, s]));
  for (const status of memberStatuses(state, week)) {
    const prior = priorStatuses.get(status.memberId);
    if (!prior || prior.status !== status.status || prior.name !== status.name) changes.push(`제출 상태: ${singleLine(status.name)} · ${prior ? statusLabel[prior.status] : '명단 신규'} → ${statusLabel[status.status]}`);
  }
  return changes.length ? ['최근 확정본 이후 변경', ...changes.map(line => `- ${line}`)].join('\n') : '최근 확정본 이후 변경 없음';
}
