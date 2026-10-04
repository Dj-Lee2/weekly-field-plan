import React, { useMemo, useState } from 'react';
import { weekPlans, shiftDay, planIssues } from '../lib/domain.mjs';
import { makeReminder, previewCopyPlans } from '../lib/planning.mjs';
import { Modal } from './forms.jsx';
import { Copy, WarningCircle, ArrowRight, Check } from './icons.mjs';
import './planning.css';

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
export const dateLabel = value => value ? `${Number(value.slice(5,7))}.${Number(value.slice(8,10))}` : '일정 미정';
export function PlanFilters({ plans, query, person, place, onQuery, onPerson, onPlace, onReset, count }) {
  const people = [...new Set(plans.flatMap(p => p.assignees))].sort((a,b) => a.localeCompare(b,'ko'));
  const places = [...new Set(plans.map(p => p.place).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ko'));
  return <div className="plan-filters">
    <label className="search-field">작업 찾기<input type="search" aria-label="계획 검색" value={query} onChange={e=>onQuery(e.target.value)} placeholder="작업·포장·담당자·비고 검색" maxLength={200}/></label>
    <label>담당자<select aria-label="담당자 필터" value={person} onChange={e=>onPerson(e.target.value)}><option value="">전체 담당자</option>{people.map(x=><option key={x}>{x}</option>)}</select></label>
    <label>포장<select aria-label="포장 필터" value={place} onChange={e=>onPlace(e.target.value)}><option value="">전체 포장</option>{places.map(x=><option key={x}>{x}</option>)}</select></label>
    <div className="filter-result" role="status"><span>{count}건 표시</span>{(query||person||place)&&<button className="text-button" onClick={onReset}>검색 초기화</button>}</div>
  </div>;
}
export function WeekCalendar({ week, plans, selected, onSelect }) {
  const item = p => <button key={p.id} className={`calendar-item ${selected===p.id?'chosen':''} ${p.cancelled?'is-cancelled':''}`} onClick={()=>onSelect(p.id)}>
    <span className="calendar-time">{p.time||'시간 미정'}</span><strong>{p.task}</strong><span>{p.place||'포장 미정'}</span><span>{p.assignees.join(' · ')||'담당자 미정'}</span>
    {p.cancelled?<span className="badge missing">취소</span>:planIssues(p).length>0?<span className="badge review">확인 필요</span>:null}
  </button>;
  return <div className="calendar-view">
    <div className="week-calendar" aria-label="주간 일정표">{DAYS.map((day,i)=>{const date=shiftDay(week,i),items=plans.filter(p=>p.date===date);return <section className={`calendar-day ${i>4?'weekend':''}`} key={date} aria-label={`${date} ${day}요일`}><header><h2>{day} <span>{dateLabel(date)}</span></h2><span>{items.length}건</span></header><div>{items.length?items.map(item):<p className="calendar-empty">표시할 계획 없음</p>}</div></section>;})}</div>
    {plans.some(p=>!p.date)&&<section className="undated-plans"><h2>일정 미정</h2><p className="muted small">날짜가 정해지지 않은 계획은 별도로 표시합니다.</p><div>{plans.filter(p=>!p.date).map(item)}</div></section>}
  </div>;
}
export function ChecksView({ state, week, analysis, onOpen, onExample, exampleBusy, exampleError }) {
  const byId = new Map(weekPlans(state,week).map(p=>[p.id,p]));
  const [limit,setLimit]=useState(20);
  const review=[...byId.values()].filter(p=>planIssues(p).length);
  const overlaps=analysis.conflicts.slice(0,limit).filter(x=>x.level==='overlap');
  return <div className="checks-layout">
    <section className="section-panel">
      <div className="section-head"><div><h2>함께 확인할 일정</h2><p>같은 날 담당자나 포장이 겹치는 계획을 비교합니다.</p></div>{onExample&&<button className="button secondary" disabled={exampleBusy} onClick={onExample}>{exampleBusy?'추가 중…':'겹침 예시 추가'}</button>}</div>
      {exampleError&&<p role="alert" className="form-error padded-inline">{exampleError}</p>}
      <div className="check-explainer"><WarningCircle size={19}/><p><b>시간 겹침</b>은 두 계획의 명시된 시간 범위가 겹칠 때만 표시합니다. ‘오전·오후’ 또는 종료 시각이 없는 일정은 <b>시간 확인</b>으로 구분합니다. 공동 작업일 수 있으므로 자동 변경·배정하지 않습니다.</p></div>
      <div className="check-counts"><b>비교 대상 {analysis.totalConflicts}쌍</b><span>표시된 항목 중 시간 겹침 {overlaps.length}쌍</span></div>
      {!analysis.conflicts.length?<div className="empty-mini"><Check size={25}/><h3>현재 비교할 겹침 후보가 없습니다</h3><p>입력된 날짜·담당자·포장 기준입니다. 미정 항목까지 안전하다는 뜻은 아닙니다.</p></div>:<div className="conflict-list">{analysis.conflicts.slice(0,limit).map(c=><article className="conflict-row" key={c.id}><div className="row between wrap"><h3>{dateLabel(c.date)} · {c.resources.join(' / ')}</h3><span className={`badge ${c.level==='overlap'?'conflict':'review'}`}>{c.level==='overlap'?'시간 겹침':'시간 확인'}</span></div><p>{c.message}</p><div className="conflict-pair">{c.planIds.map(id=>{const p=byId.get(id);return p&&<button className="compare-plan" key={id} onClick={()=>onOpen(id)}><span>{p.time||'시간 미정'} · {p.place||'포장 미정'}</span><strong>{p.task}</strong><span>{p.assignees.join(' · ')||'담당자 미정'}</span><span className="text-link">계획 열기 <ArrowRight size={15}/></span></button>;})}</div></article>)}</div>}
      {analysis.conflicts.length>limit&&<button className="button secondary more-checks" onClick={()=>setLimit(limit+20)}>비교 항목 더 보기</button>}
      {analysis.totalConflicts>analysis.conflicts.length&&<p className="section-foot">전체 {analysis.totalConflicts}쌍 중 최대 {analysis.conflicts.length}쌍을 불러왔습니다. 현재 {Math.min(limit,analysis.conflicts.length)}쌍이 펼쳐져 있습니다. 일정을 정리하면 나머지 항목도 점검할 수 있습니다.</p>}
    </section>
    <aside className="notice-actions">
      <section className="section-panel padded"><h2>입력 보완 {review.length}건</h2>{review.length?review.map(p=><button className="issue-link" onClick={()=>onOpen(p.id)} key={p.id}><strong>{p.task}</strong><span>{planIssues(p).join(' · ')}</span></button>):<p>필수 항목과 원문 대조가 완료되었습니다.</p>}</section>
      <section className="section-panel padded"><h2>시간·날짜 점검 한계</h2><p>시간을 추정하지 않습니다. 범위를 입력하려면 09:00~11:00처럼 적어 주세요. 장비 수량·이동시간은 점검하지 않습니다.</p>{analysis.unchecked.map(x=><button className="issue-link" key={x.planId} onClick={()=>onOpen(x.planId)}><strong>{byId.get(x.planId)?.task}</strong><span>{x.reason}</span></button>)}</section>
    </aside>
  </div>;
}
export function ReminderComposer({ state, week, onToast, download }) {
  const [kind,setKind]=useState('missing');
  const [deadline,setDeadline]=useState('');
  const text=useMemo(()=>makeReminder(state,week,{kind,deadline}),[state,week,kind,deadline]);
  async function copy(){try{await navigator.clipboard.writeText(text);onToast('안내문을 복사했습니다. 자동 발송은 하지 않았습니다.');}catch{document.getElementById('reminder-text')?.select();onToast('자동 복사가 제한되었습니다. 선택된 안내문을 직접 복사해 주세요.');}}
  return <section className="section-panel reminder-panel">
    <div className="section-head"><div><h2>제출 안내문 만들기</h2><p>현재 제출 현황으로 문안을 준비합니다. 발송 대상이 자동 지정되는 것은 아닙니다.</p></div></div>
    <div className="reminder-controls"><div className="segmented" aria-label="안내문 종류"><button aria-pressed={kind==='missing'} className={kind==='missing'?'active':''} onClick={()=>setKind('missing')}>미제출 안내</button><button aria-pressed={kind==='review'} className={kind==='review'?'active':''} onClick={()=>setKind('review')}>보완 요청</button></div><label>제출 기한 (선택)<input aria-label="안내문 제출 기한" value={deadline} maxLength={100} onChange={e=>setDeadline(e.target.value)} placeholder="예: 금요일 오후 3시까지"/></label></div>
    <textarea id="reminder-text" className="notice-text reminder-text" readOnly aria-label="제출 안내문" value={text}/>
    <div className="section-foot row between wrap"><span>기한을 비워 두면 임의로 정하지 않습니다. 복사 후 직접 검토해 주세요.</span><div className="row"><button className="text-button" onClick={()=>download(`포장계획_제출안내_${week}.txt`,text)}>안내문 TXT</button><button className="button secondary" onClick={copy}><Copy size={17}/>안내문 복사</button></div></div>
  </section>;
}
export function CopyWeekDialog({ state, week, onCommand, onClose, onCopied }) {
  const plans=weekPlans(state,week), targetWeek=shiftDay(week,7);
  const already=new Set(state.plans.filter(p=>p.week===targetWeek).map(p=>p.copiedFrom?.planId));
  const eligible=plans.filter(p=>!already.has(p.id));
  const [ids,setIds]=useState(()=>eligible.length<=30?eligible.map(p=>p.id):[]);
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  let preview=[],previewError='';
  if(ids.length){try{preview=previewCopyPlans(state,week,targetWeek,ids);}catch(e){previewError=e.message;}}
  async function save(){setBusy(true);setError('');try{await onCommand({type:'copyPlans',sourceWeek:week,targetWeek,planIds:ids});onCopied(targetWeek);onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <Modal title="다음 주 계획 복사" subtitle={`${dateLabel(week)} 주 → ${dateLabel(targetWeek)} 주 · 원래 계획은 그대로 둡니다.`} onClose={onClose} busy={busy} wide>
    <fieldset className="modal-body" disabled={busy}><div className="notice-strip"><Copy size={19}/><span>선택한 작업의 날짜만 7일 뒤로 옮깁니다. 복사본은 모두 ‘확인 필요’로 시작하며, 작업 없음·확정본은 복사하지 않습니다.</span></div>
      <div className="row between wrap copy-select-head"><b>{ids.length}건 선택 / 한 번에 최대 30건</b><div className="row"><button className="text-button" disabled={eligible.length>30} onClick={()=>setIds(eligible.map(p=>p.id))}>복사 가능한 계획 전체</button><button className="text-button" onClick={()=>setIds([])}>선택 해제</button></div></div>
      {plans.length?<div className="copy-list">{plans.map(p=><label className={`copy-choice ${already.has(p.id)?'unavailable':''}`} key={p.id}><input type="checkbox" aria-label={`${p.task} 복사 선택`} checked={ids.includes(p.id)} disabled={already.has(p.id)||(!ids.includes(p.id)&&ids.length>=30)} onChange={e=>setIds(e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/><span><strong>{p.task}</strong><small>{dateLabel(p.date)} → {dateLabel(p.date?shiftDay(p.date,7):null)} · {p.time||'시간 미정'} · {p.place||'포장 미정'}</small><small>{state.members.find(m=>m.id===p.submitterId)?.name}{already.has(p.id)?' · 다음 주에 복사본 있음 (취소본 포함)':''}</small></span></label>)}</div>:<p className="empty-mini">복사할 활성 계획이 없습니다.</p>}
      <p className="small muted copy-guidance">기존 다음 주 계획에 추가되며 자동 덮어쓰지 않습니다. 같은 원본의 중복 복사는 막습니다. 날짜 미정은 그대로 남고, 제출 원문은 복사 출처로만 보존합니다.</p>
      {(error||previewError)&&<p role="alert" className="form-error">{error||previewError}</p>}
    </fieldset><footer className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>돌아가기</button><button className="button primary" disabled={busy||!preview.length||!!previewError} onClick={save}>{busy?'복사 중…':`선택 ${ids.length}건 다음 주에 추가`}</button></footer>
  </Modal>;
}
