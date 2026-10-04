const DAY = 86400000;
const RESULT_STATUSES = ['done', 'partial', 'not-done'];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const clone = value => JSON.parse(JSON.stringify(value));
function fail(message) { throw Object.assign(new Error(message), { code: 'VALIDATION' }); }
function isoDay(date) {
  if (!Number.isFinite(date.getTime())) fail('유효한 날짜를 입력해 주세요.');
  const iso = date.toISOString();
  if (!/^\d{4}-/.test(iso)) fail('지원 날짜 범위를 벗어났습니다.');
  return iso.slice(0, 10);
}
function monthValue(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('월은 YYYY-MM 형식이어야 합니다.');
  return month;
}

export function koreaToday(now = new Date()) {
  if (!(now instanceof Date) && typeof now !== 'string' && typeof now !== 'number') fail('현재 시각이 올바르지 않습니다.');
  const date = new Date(now);
  return isoDay(new Date(date.getTime() + 9 * 3600000));
}

export function monthDays(month) {
  // Parsing the ISO year avoids Date.UTC's special treatment of years 0..99.
  const first = new Date(`${monthValue(month)}-01T00:00:00.000Z`);
  const start = first.getTime() - first.getUTCDay() * DAY;
  return Array.from({ length: 42 }, (_, i) => isoDay(new Date(start + i * DAY)));
}

export function shiftMonth(month, offset) {
  monthValue(month);
  if (!Number.isSafeInteger(offset)) fail('이동 월수는 정수여야 합니다.');
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + offset;
  if (!Number.isSafeInteger(total) || total < 0 || total >= 10000 * 12) fail('지원 날짜 범위를 벗어났습니다.');
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String(total % 12 + 1).padStart(2, '0')}`;
}

export function calendarEntries(state, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('달력 필터 형식을 확인해 주세요.');
  const { mode = 'all', query = '', person = '', place = '', status = 'all' } = options;
  if (!['all', 'plans', 'results'].includes(mode)) fail('달력 보기 종류를 확인해 주세요.');
  if (!['all', 'no-result', ...RESULT_STATUSES].includes(status)) fail('결과 상태 필터를 확인해 주세요.');
  if ([query, person, place].some(value => typeof value !== 'string')) fail('달력 검색 조건은 문자열이어야 합니다.');
  const needle = query.trim().toLocaleLowerCase('ko'), personName = person.trim(), placeName = place.trim();
  const entries = [];
  function project(plan, kind) {
    const result = plan.result ?? null;
    // Never relabel historical results with a subsequently edited live plan.
    const content = kind === 'plan' ? plan : result?.planSnapshot;
    if (!content || !Array.isArray(content.assignees)) fail('작업 또는 결과의 계획 기록 형식을 확인해 주세요.');
    const entry = {
      id: `${plan.id}:${kind}`, planId: plan.id, date: kind === 'plan' ? (plan.date ?? null) : result.date,
      kind, task: content.task, place: content.place, assignees: [...content.assignees], time: content.time,
      // The plan leg retains the result metadata even if its actual date differs.
      // Only result/both legs should display actual work details or enter CSV.
      result: result ? clone(result) : null, cancelled: Boolean(plan.cancelled),
    };
    if (status === 'no-result' && result) return;
    if (RESULT_STATUSES.includes(status) && result?.status !== status) return;
    if (personName && !entry.assignees.some(name => name.trim() === personName)) return;
    if (placeName && entry.place?.trim() !== placeName) return;
    const searchable = [entry.task, entry.date, entry.time, entry.place, ...entry.assignees, result?.summary, result?.recorder].join('\n').toLocaleLowerCase('ko');
    if (needle && !searchable.includes(needle)) return;
    entries.push(entry);
  }
  for (const plan of Array.isArray(state?.plans) ? state.plans : []) {
    if (mode === 'all' && !plan.cancelled && plan.result && plan.date === plan.result.date) {
      project(plan, 'both');
    } else {
      if (mode !== 'results' && !plan.cancelled) project(plan, 'plan');
      if (mode !== 'plans' && plan.result) project(plan, 'result');
    }
  }
  return entries.sort((a, b) => compare(a.date ?? '9999-99-99', b.date ?? '9999-99-99') || compare(a.time, b.time) || compare(a.id, b.id));
}

function csvCell(value) {
  let cell = String(value ?? '');
  // Same defense as exports.mjs: prefix the original cell, including leading
  // Unicode whitespace/control characters, before any spreadsheet formula.
  if (/^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

export function makeResultCsv(entries = []) {
  if (!Array.isArray(entries)) fail('결과 내보내기 항목은 목록이어야 합니다.');
  const rows = [['계획일', '실제·평가일', '계획 시간', '포장', '작업내용', '담당자', '결과 상태', '결과 요약', '기록자', '최초 기록', '수정 시각', '계획 취소']];
  const seen = new Set(), labels = { done: '완료', partial: '일부 완료', 'not-done': '미실시' };
  for (const entry of entries) {
    if (!['result', 'both'].includes(entry.kind) || !entry.result || seen.has(entry.planId)) continue;
    const result = entry.result, plan = result.planSnapshot;
    if (!plan || !Array.isArray(plan.assignees)) fail('결과의 계획 기록 형식을 확인해 주세요.');
    seen.add(entry.planId);
    rows.push([plan.date, result.date, plan.time, plan.place, plan.task, plan.assignees.join(', '), labels[result.status] ?? result.status, result.summary, result.recorder, result.recordedAt, result.updatedAt, entry.cancelled ? '취소됨' : '']);
  }
  return `\ufeff${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
