import { weekPlans, memberStatuses, planIssues, monday, shiftDay } from './domain.mjs';

export { previewCopyPlans } from './domain.mjs';

const MAX_CONFLICTS = 200;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Plain text only: keep user text visible without letting it add lines or tags.
const singleLine = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/</g, '‹').replace(/>/g, '›').trim();

function timeRange(value) {
  if (typeof value !== 'string') return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)\s*[-~]\s*([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return start < end ? { start, end } : null;
}
function knownDate(date, week) {
  if (!date) return false;
  try { return monday(date) === week; } catch { return false; }
}

export function analyzeWeek(state, week) {
  const conflicts = [], unchecked = [];
  let totalConflicts = 0;
  const plans = weekPlans(state, week).sort((a, b) => compare(a.date ?? '9999', b.date ?? '9999') || compare(a.id, b.id));
  const byDate = new Map();
  for (const plan of plans) {
    const dateKnown = knownDate(plan.date, week), range = timeRange(plan.time);
    const reasons = [];
    if (!dateKnown) reasons.push('날짜 확인 필요: 날짜가 없어 같은 날인지 점검할 수 없습니다.');
    if (!range) reasons.push('시간 확인 필요: 유효한 시작·종료 시각(HH:mm-HH:mm 또는 HH:mm~HH:mm)이 없어 겹침을 확정할 수 없습니다.');
    if (reasons.length) unchecked.push({ planId: plan.id, reason: reasons.join(' ') });
    if (!dateKnown) continue;
    const names = new Set(plan.assignees.map(name => name.trim()).filter(Boolean));
    const entry = { plan, range, names, namesList: [...names], place: plan.place.trim() };
    if (!byDate.has(plan.date)) byDate.set(plan.date, []);
    byDate.get(plan.date).push(entry);
  }
  for (const [date, entries] of byDate) {
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i];
      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j];
        // Exact non-overlap takes precedence even if a resource is shared.
        if (a.range && b.range && (a.range.end <= b.range.start || b.range.end <= a.range.start)) continue;
        const sharedPlace = a.place && a.place === b.place;
        if (!sharedPlace && !a.namesList.some(name => b.names.has(name))) continue;
        totalConflicts += 1;
        if (conflicts.length >= MAX_CONFLICTS) continue;
        const resources = a.namesList.filter(name => b.names.has(name)).sort(compare).map(name => `담당자: ${name}`);
        if (sharedPlace) resources.push(`장소: ${a.place}`);
        const level = a.range && b.range ? 'overlap' : 'check';
        const planIds = [a.plan.id, b.plan.id];
        conflicts.push({
          id: `conflict:${JSON.stringify([date, ...planIds])}`, level, date, planIds, resources,
          message: `${resources.map(singleLine).join(' · ')} — ${level === 'overlap' ? '입력한 시간 범위가 겹칩니다.' : '시간 범위를 확정할 수 없어 겹침 여부 확인이 필요합니다.'}`,
        });
      }
    }
  }
  return { conflicts, unchecked, totalConflicts };
}

export function makeReminder(state, week, { kind = 'missing', deadline = '' } = {}) {
  if (!['missing', 'review'].includes(kind)) throw Object.assign(new Error('안내문 종류는 미제출 또는 검토 필요를 선택해 주세요.'), { code: 'VALIDATION' });
  if (typeof deadline !== 'string' || deadline.length > 200) throw Object.assign(new Error('기한은 200자 이내의 문자열로 입력해 주세요.'), { code: 'VALIDATION' });
  const statuses = memberStatuses(state, week);
  const targets = statuses.filter(s => s.status === kind);
  const lines = [
    `[주간 포장작업 계획 · ${kind === 'missing' ? '미제출 안내' : '검토 요청'} 초안]`,
    `대상 주: ${week} ~ ${shiftDay(week, 6)}`,
    singleLine(deadline) ? `기한: ${singleLine(deadline)}` : '기한 미지정',
    '※ 담당자가 검토 후 직접 전달하는 안내문입니다. 카카오톡 자동발송 없음.',
    '',
  ];
  if (!statuses.length) lines.push('등록된 제출자 명단이 없습니다. 먼저 명단을 등록해 주세요.');
  else if (!targets.length) lines.push(`${kind === 'missing' ? '미제출 안내' : '검토 요청'} 대상이 없습니다.`);
  else if (kind === 'missing') {
    lines.push(`미제출 대상: ${targets.map(s => singleLine(s.name)).join(', ')}`);
    lines.push('해당 주의 작업 계획을 제출해 주세요. 작업이 없으면 “작업 없음”으로 알려 주세요.');
  } else {
    const plans = weekPlans(state, week);
    lines.push('다음 작업의 실제 누락 항목과 원문 대조 검토 상태를 확인해 주세요.');
    for (const owner of targets) {
      lines.push('', `제출자: ${singleLine(owner.name)}`);
      for (const plan of plans.filter(p => p.submitterId === owner.memberId)) {
        const issues = planIssues(plan);
        if (issues.length) lines.push(`- ${plan.date ?? '날짜 미정'} · ${singleLine(plan.task) || '작업 내용 미입력'}: ${issues.join(', ')}`);
      }
    }
  }
  return lines.join('\n');
}
