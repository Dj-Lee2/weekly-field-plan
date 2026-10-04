import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText } from '../lib/parser.mjs';
const week = '2026-10-05';

test('pipe and slash rows map Korean weekdays, preserve source-like notes, never mark reviewed', () => {
  const result = parseText('다음 주 포장작업 계획\n월 | 09:00 | 1포장 | 토양 채취 | 담당: 예시 가, 예시 나 | 비고: 장갑\n수 / 오후 2시 / 2포장 / 생육 조사 / 담당 예시 다',week);
  assert.equal(result.mode,'rules');
  assert.equal(result.items.length,2);
  assert.equal(result.items[0].date,week);
  assert.equal(result.items[1].date,'2026-10-07');
  assert.equal(result.items[0].time,'09:00');
  assert.equal(result.items[0].place,'1포장');
  assert.equal(result.items[0].task,'토양 채취');
  assert.deepEqual(result.items[0].assignees,['예시 가','예시 나']);
  assert.match(result.items[0].notes,/장갑/);
  assert.ok(result.items.every(i => i.reviewed === false));
  assert.ok(result.warnings.length);
});

test('frontend example supports combined day/time then slash place and task', () => {
  const result = parseText('다음 주 포장 계획입니다.\n월요일 오전 / 시험포장 A / 제초 / 담당: 예시 연구원 가\n수요일 오후 / 시험포장 B / 토양 시료 채취 / 담당: 예시 연구원 가, 예시 연구원 나 / 비고: 운반차 필요', week);
  assert.equal(result.items.length,2);
  assert.equal(result.items[0].date,week);
  assert.equal(result.items[0].time,'오전');
  assert.equal(result.items[0].place,'시험포장 A');
  assert.equal(result.items[0].task,'제초');
  assert.equal(result.items[1].time,'오후');
  assert.match(result.items[1].notes,/운반차 필요/);
});

test('simple weekday time place task line produces review-only editable draft', () => {
  const result = parseText('화 10:30 3포장 배추 생육 조사 담당: 예시 가',week);
  assert.equal(result.items[0].date,'2026-10-06');
  assert.equal(result.items[0].task,'배추 생육 조사');
  assert.equal(result.items[0].place,'3포장');
});

test('ambiguous prose is preserved without inventing dates or silently losing words', () => {
  const text = '날씨가 좋으면 포장 점검을 검토합니다';
  const result = parseText(text,week);
  assert.equal(result.items[0].date,null);
  assert.equal(result.items[0].task,text);
  assert.equal(result.items[0].place,'');
  assert.ok(result.warnings.some(w => /확인|형식/.test(w)));
});

test('explicit dates outside week and invalid calendar dates fail visibly', () => {
  assert.throws(() => parseText('2026-10-12 | 09:00 | 1포장 | 조사',week),/주|날짜/);
  assert.throws(() => parseText('2026-02-30 | 09:00 | 1포장 | 조사',week),/날짜/);
  assert.throws(() => parseText('월 | 09:00 | 1포장 | 조사','2026-10-06'));
  assert.equal(parseText('2026-10-06 | 09:00 | 1포장 | 조사',week).items[0].date,'2026-10-06');
});

test('short explicit calendar dates resolve only inside selected week, including year boundaries', () => {
  for (const text of ['10/12 / 오전 / 1포장 / 조사', '10월 12일 | 오전 | 1포장 | 조사', '10.12. 오전 조사']) assert.throws(() => parseText(text,week),/주|날짜/);
  assert.equal(parseText('10/06 / 오전 / 1포장 / 조사',week).items[0].date,'2026-10-06');
  assert.equal(parseText('10월 7일 / 오전 / 1포장 / 조사',week).items[0].date,'2026-10-07');
  assert.equal(parseText('1/2 / 오전 / 1포장 / 조사','2026-12-28').items[0].date,'2027-01-02');
});

test('update/cancel/no-work language never silently creates or mutates records', () => {
  const r = parseText('월요일 작업 취소해주세요\n화요일로 일정 변경\n이번 주 작업 없음',week);
  assert.deepEqual(r.items,[]);
  assert.ok(r.warnings.some(w => /수정|취소/.test(w)));
  assert.ok(r.warnings.some(w => /작업 없음/.test(w)));
});

test('unknown extra fields remain in notes with warning; input and batch limits apply', () => {
  const r = parseText('목 | | 4포장 | 관수 | 확인되지 않은 정보 | 추가 메모',week);
  assert.match(r.items[0].notes,/확인되지 않은 정보/);
  assert.match(r.items[0].notes,/추가 메모/);
  assert.throws(() => parseText('x'.repeat(8001),week));
  assert.throws(() => parseText(Array.from({length:31},()=>'월 | | 1포장 | 조사').join('\n'),week));
  assert.equal(parseText('',week).items.length,0);
});
