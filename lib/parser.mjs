import { monday, shiftDay } from './domain.mjs';

const dayPrefix = /^(\d{4}-\d{2}-\d{2}|[월화수목금토일](?:요일)?)(?=\s|$)\s*(.*)$/u;
const timePrefix = /^(?:(?:오전|오후)(?:\s*\d{1,2}(?::\d{2}|시(?:\s*\d{1,2}분)?)?)?|\d{1,2}:\d{2}(?:\s*[~–-]\s*\d{1,2}:\d{2})?|\d{1,2}시(?:\s*\d{1,2}분)?)(?=\s|$)/u;
function error(message) { throw Object.assign(new Error(message), { code: 'VALIDATION' }); }
function dateFromToken(token, week) {
  if (/^\d/.test(token)) {
    if (monday(token) !== week) error(`날짜 ${token}가 선택한 주에 속하지 않습니다.`);
    return token;
  }
  return shiftDay(week, '월화수목금토일'.indexOf(token[0]));
}
function blank() { return { date: null, time: '', place: '', task: '', assignees: [], notes: '', reviewed: false }; }
function leadingShortDate(line, week) {
  const match = line.match(/^(\d{1,2})(?:[/.]|월\s*)(\d{1,2})(?:일|\.)?(?=\s|[|/]|$)/u);
  if (!match) return line;
  const monthDay = `${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  const date = Array.from({ length: 7 }, (_, index) => shiftDay(week, index)).find(value => value.slice(5) === monthDay);
  if (!date) error(`날짜 ${match[0]}가 선택한 주에 속하지 않거나 올바르지 않습니다.`);
  return date + line.slice(match[0].length);
}

export function parseText(text, week) {
  if (monday(week) !== week) error('선택 주의 시작일은 월요일이어야 합니다.');
  if (typeof text !== 'string' || text.length > 8000 || text.includes('\u0000')) error('원문은 최대 8000자의 텍스트여야 합니다.');
  const result = { items: [], warnings: ['AI 미연결: 규칙 기반 후보입니다. 날짜·장소·담당자를 원문과 대조한 후 제출해 주세요.'], mode: 'rules' };
  // Check all explicit dates, including lines containing an unsupported update.
  for (const match of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) dateFromToken(match[0], week);
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = leadingShortDate(lines[n].trim().replace(/^[-•*]\s+/, ''), week);
    if (!line) continue;
    if (/^[\[【]?(?:다음\s*주|이번\s*주|주간)?\s*포장\s*(?:작업\s*)?계획(?:입니다)?[.!\]】]?$/u.test(line)) continue;
    if (/(?:작업|일정)\s*(?:이\s*)?없(?:음|습니다|어요)?|할\s*일\s*없/u.test(line)) {
      result.warnings.push(`${n + 1}행: '작업 없음'은 제출자 선택 후 별도 작업 없음 버튼으로 등록해 주세요. 원문: ${line}`); continue;
    }
    if (/(취소|수정|변경|삭제|옮겨|대신)/u.test(line)) {
      result.warnings.push(`${n + 1}행: 수정·취소 의도는 자동 적용하지 않습니다. 기존 작업을 직접 선택해 수정해 주세요. 원문: ${line}`); continue;
    }
    const item = blank();
    const notes = [];
    if (/[|/]/u.test(line)) {
      const cells = line.split(/[|/]/u).map(cell => cell.trim());
      const prefix = cells.shift().match(dayPrefix);
      if (!prefix) {
        item.task = line;
        result.warnings.push(`${n + 1}행: 날짜/요일 형식을 확인하지 못해 원문 전체를 작업 내용에 보존했습니다.`);
      } else {
        item.date = dateFromToken(prefix[1], week);
        if (prefix[2]) {
          if (timePrefix.test(prefix[2]) && prefix[2].match(timePrefix)[0] === prefix[2]) item.time = prefix[2];
          else { notes.push(prefix[2]); result.warnings.push(`${n + 1}행: 날짜 뒤 불명확한 표현은 비고에 보존했습니다.`); }
        } else if (cells[0] === '' || (cells[0] && timePrefix.test(cells[0]) && cells[0].match(timePrefix)[0] === cells[0])) item.time = cells.shift();
        item.place = cells.shift() ?? '';
        item.task = cells.shift() ?? '';
        for (const cell of cells) {
          if (/^담당(?:자)?\s*[:：]?\s*/u.test(cell)) {
            const names = cell.replace(/^담당(?:자)?\s*[:：]?\s*/u, '').split(/[,，]/u).map(s => s.trim()).filter(Boolean);
            item.assignees.push(...names);
          } else if (/^비고\s*[:：]?/u.test(cell)) notes.push(cell.replace(/^비고\s*[:：]?\s*/u, ''));
          else if (cell) { notes.push(cell); result.warnings.push(`${n + 1}행: 알 수 없는 추가 항목을 비고에 보존했습니다: ${cell}`); }
        }
      }
    } else {
      const prefix = line.match(dayPrefix);
      if (!prefix) {
        item.task = line;
        result.warnings.push(`${n + 1}행: 구조를 확인하지 못했습니다. 원문을 작업 내용에 보존했으니 날짜와 장소 등을 직접 입력해 주세요.`);
      } else {
        item.date = dateFromToken(prefix[1], week);
        let rest = prefix[2];
        const time = rest.match(timePrefix);
        if (time) { item.time = time[0]; rest = rest.slice(time[0].length).trim(); }
        const assignment = rest.match(/\s+담당(?:자)?\s*[:：]?\s*(.+)$/u);
        if (assignment) { item.assignees = assignment[1].split(/[,，]/u).map(x => x.trim()).filter(Boolean); rest = rest.slice(0, assignment.index).trim(); }
        // Only a single location token is inferred without delimiters; all
        // remaining words remain the task. Multiword locations require review.
        const tokens = rest.match(/^(\S+)\s+(.+)$/u);
        if (time && tokens) { item.place = tokens[1]; item.task = tokens[2]; }
        else { item.task = rest; result.warnings.push(`${n + 1}행: 장소/작업 구분이 불명확합니다. 직접 확인해 주세요.`); }
      }
    }
    item.notes = notes.join('\n');
    item.assignees = [...new Set(item.assignees)];
    if (!item.task) {
      item.notes = [item.notes, `원문: ${line}`].filter(Boolean).join('\n');
      result.warnings.push(`${n + 1}행: 작업 내용을 찾지 못했습니다. 비고의 원문을 확인해 입력해 주세요.`);
    }
    result.items.push(item);
    if (result.items.length > 30) error('한 번에 최대 30개 작업까지 미리 볼 수 있습니다. 원문을 나누어 입력해 주세요.');
  }
  return result;
}
