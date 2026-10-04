import React, {useMemo, useState} from 'react';
import {CaretLeft, CaretRight, CalendarBlank, ArrowRight, DownloadSimple, Plus} from './icons.mjs';
import {Modal} from './forms.jsx';
import {publicDemo} from './store.mjs';
import {monday, nextWeek} from '../lib/domain.mjs';
import {koreaToday, monthDays, shiftMonth, calendarEntries, makeResultCsv} from '../lib/calendar.mjs';
import './calendar.css';

const STATES = {'done':'완료','partial':'일부 완료','not-done':'미실시'};
const short = date => date ? `${Number(date.slice(5,7))}.${Number(date.slice(8,10))}` : '일정 미정';
const dateLabel = date => `${date} (${['일','월','화','수','목','금','토'][new Date(`${date}T00:00:00Z`).getUTCDay()]})`;
const monthLabel = month => `${month.slice(0,4)}년 ${Number(month.slice(5))}월`;
function saveCsv(name, text){const u=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);}

export function ResultDialog({plan,onClose,onCommand}){
  const today=koreaToday();
  const [value,setValue]=useState(()=>({status:plan.result?.status||'',date:plan.result?.date||(plan.date&&plan.date<=today?plan.date:today),summary:plan.result?.summary||'',recorder:plan.result?.recorder||''}));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const update=(key,v)=>setValue(s=>({...s,[key]:v}));
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{await onCommand({type:'recordResult',id:plan.id,result:value});onClose();}catch(err){setError(err.message);}finally{setBusy(false);}}
  return <Modal title={plan.result?'작업 결과 수정':'작업 결과 기록'} subtitle={plan.task} onClose={onClose} busy={busy}>
    <form onSubmit={submit}><fieldset disabled={busy} className="result-form">
      <p className="result-help">계획일 {plan.date||'미정'} · {plan.place||'포장 미정'}<br/>실제 확인한 결과만 기록합니다. 계획 원문과 확정본은 바뀌지 않습니다.</p>
      <div className="form-grid"><label>진행 결과<select aria-label="진행 결과" required value={value.status} onChange={e=>update('status',e.target.value)}><option value="">결과 선택</option>{Object.entries(STATES).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
      <label>작업·확인일<input aria-label="작업·확인일" type="date" required max={today} value={value.date} onChange={e=>update('date',e.target.value)}/></label></div>
      <p className="small muted">완료·일부 완료는 실제 작업일, 미실시는 실시하지 못한 사실을 확인한 날짜입니다.</p>
      <label>결과 메모<textarea aria-label="결과 메모" required maxLength={2000} rows={4} value={value.summary} onChange={e=>update('summary',e.target.value)} placeholder="실시한 내용, 남은 작업, 미실시 사유 등을 입력하세요."/></label>
      <label>기록자<input aria-label="기록자" required maxLength={80} value={value.recorder} onChange={e=>update('recorder',e.target.value)} placeholder="결과를 확인한 사람"/></label>
      <p className="small muted">{publicDemo?'시연 기록은 현재 화면에서만 유지되며, 새로고침하면 사라집니다.':'결과 수정 전 내용은 변경 이력에 남습니다.'}</p>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <div className="result-actions"><button type="button" className="button secondary" onClick={onClose}>돌아가기</button><button className="button primary">{busy?'반영 중…':publicDemo?'시연 결과 반영':'결과 저장'}</button></div>
    </fieldset></form>
  </Modal>;
}

export function WorkCalendar({state,onCommand,onOpenPlan,onResult,onAddPlan}){
  const today=koreaToday();
  const [month,setMonth]=useState(today.slice(0,7));
  const [day,setDay]=useState(today);
  const [mode,setMode]=useState('all');
  const [query,setQuery]=useState(''),[person,setPerson]=useState(''),[place,setPlace]=useState(''),[status,setStatus]=useState('all');
  const [range,setRange]=useState('day');
  const [limit,setLimit]=useState(20);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const entries=useMemo(()=>calendarEntries(state,{mode,query,person,place,status}),[state,mode,query,person,place,status]);
  const unfiltered=useMemo(()=>[...calendarEntries(state,{mode:'plans'}),...calendarEntries(state,{mode:'results'})],[state]);
  const people=[...new Set(unfiltered.flatMap(e=>e.assignees))].sort((a,b)=>a.localeCompare(b,'ko'));
  const places=[...new Set(unfiltered.map(e=>e.place).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  const days=monthDays(month);
  const byDay=useMemo(()=>{const map=new Map();for(const entry of entries){if(!map.has(entry.date))map.set(entry.date,[]);map.get(entry.date).push(entry);}return map;},[entries]);
  const monthEntries=entries.filter(e=>e.date?.startsWith(month));
  const monthTasks=new Set(monthEntries.map(e=>e.planId)).size;
  const monthResults=monthEntries.filter(e=>e.kind!=='plan');
  const chosen=(range==='month'?monthEntries:range==='undated'?entries.filter(e=>!e.date):(byDay.get(day)||[])).slice().sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||a.time.localeCompare(b.time,'ko')||a.id.localeCompare(b.id));
  const counts=Object.fromEntries(Object.keys(STATES).map(s=>[s,monthResults.filter(e=>e.result?.status===s).length]));
  const historyLoaded=state.history.some(h=>h.type==='loadHistoryExample');
  function reset(){setQuery('');setPerson('');setPlace('');setStatus('all');setLimit(20);}
  function move(value){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||value<'0001-01'||value>'9998-12')return;setMonth(value);setDay(value===today.slice(0,7)?today:value+'-01');setRange('month');setLimit(20);}
  function selectDate(value){if(value.slice(0,7)<'0001-01'||value.slice(0,7)>'9998-12')return;setDay(value);setRange('day');setLimit(20);if(!value.startsWith(month))setMonth(value.slice(0,7));}
  async function examples(){setBusy(true);setError('');try{const seed=state.history.find(h=>h.type==='loadExample');const updated=await onCommand({type:'loadHistoryExample',week:seed?.week||nextWeek()});const dated=calendarEntries(updated,{mode:'results'}).filter(e=>e.date).sort((a,b)=>b.date.localeCompare(a.date));if(dated[0]){setMonth(dated[0].date.slice(0,7));setDay(dated[0].date);}setMode('all');setRange('month');reset();}catch(e){setError(e.message);}finally{setBusy(false);}}
  function keyboard(e,date){const d=days.indexOf(date);const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];if(offset===undefined)return;e.preventDefault();const target=days[d+offset];if(target)document.querySelector(`[data-cal-date="${target}"]`)?.focus();}
  const peak=[...byDay.entries()].filter(([d,es])=>d?.startsWith(month)&&es.length).sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0])).slice(0,3);
  return <div className="work-calendar">
    {publicDemo&&!historyLoaded&&<div className="calendar-example"><div><b>지난 작업은 어떻게 보일까요?</b><p>{state.revision===1?'가상의 과거 계획과 결과를 추가해 흐름을 확인해 보세요.':'수정한 시연에 예시를 섞지 않습니다. 필요하면 상단 ‘예시 처음으로’를 누른 뒤 불러오세요.'}</p></div><button className="button secondary" disabled={busy||state.revision!==1} onClick={examples}>{busy?'불러오는 중…':'과거 작업 예시 보기'}<ArrowRight size={17}/></button></div>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="calendar-filterbar"><label className="calendar-search">작업·결과 검색<input aria-label="달력 검색" value={query} onChange={e=>{setQuery(e.target.value);setLimit(20);}} placeholder="작업, 담당자, 포장, 결과 메모"/></label>
      <label>담당자<select aria-label="달력 담당자" value={person} onChange={e=>{setPerson(e.target.value);setLimit(20);}}><option value="">전체 담당자</option>{people.map(p=><option key={p}>{p}</option>)}</select></label>
      <label>포장<select aria-label="달력 포장" value={place} onChange={e=>{setPlace(e.target.value);setLimit(20);}}><option value="">전체 포장</option>{places.map(p=><option key={p}>{p}</option>)}</select></label>
      <label>결과 상태<select aria-label="달력 결과 상태" value={status} onChange={e=>{setStatus(e.target.value);setLimit(20);}}><option value="all">전체 결과</option><option value="no-result">결과 미기록</option>{Object.entries(STATES).map(([s,n])=><option key={s} value={s}>{n}</option>)}</select></label>
      {(query||person||place||status!=='all')&&<button className="text-button" onClick={reset}>달력 검색 초기화</button>}
    </div>
    <div className="month-layout">
      <section className="month-card" aria-label="월간 작업 달력">
        <div className="month-head"><h2>언제 어떤 작업이 있었나요?</h2><div className="calendar-segment" role="group" aria-label="달력 표시 자료">{[['all','전체'],['plans','계획'],['results','결과']].map(([v,n])=><button key={v} aria-pressed={mode===v} onClick={()=>{setMode(v);setLimit(20);}}>{n}</button>)}</div></div>
        <div className="month-control"><div className="month-navigation"><button className="icon-button" aria-label="이전 달" disabled={month==='0001-01'} onClick={()=>move(shiftMonth(month,-1))}><CaretLeft size={20}/></button><label className="month-picker"><span>{monthLabel(month)}</span><input type="month" min="0001-01" max="9998-12" aria-label="조회할 달" value={month} onChange={e=>move(e.target.value)}/></label><button className="icon-button" aria-label="다음 달" disabled={month==='9998-12'} onClick={()=>move(shiftMonth(month,1))}><CaretRight size={20}/></button></div><button className="button secondary compact" onClick={()=>{move(today.slice(0,7));setDay(today);setRange('day');}}>오늘</button></div>
        <p className="month-description">선택한 조건 · 작업 <b>{monthTasks}건</b> · 날짜별 표시 <b>{monthEntries.length}건</b>{peak.length>0&&<span> · 많은 날 {peak.map(([d,v])=>`${short(d)} ${v.length}건`).join(', ')}</span>}</p>
        <div className="month-weekdays" aria-hidden="true">{['일','월','화','수','목','금','토'].map(n=><span key={n}>{n}</span>)}</div>
        <div className="month-tiles" role="group" aria-label={`${monthLabel(month)} 날짜 선택`}>
          {days.map(date=>{const list=byDay.get(date)||[],num=list.length;const level=num===0?0:num===1?1:num<=3?2:num<=5?3:4;const resultCount=list.filter(e=>e.kind!=='plan').length;const outside=!date.startsWith(month);return <button key={date} disabled={date.slice(0,7)<'0001-01'||date.slice(0,7)>'9998-12'} data-cal-date={date} className={`month-tile heat-${level}${outside?' outside':''}${date===today?' today':''}${date===day&&range==='day'?' picked':''}`} aria-label={`${dateLabel(date)} ${num}건, 결과 ${resultCount}건`} aria-pressed={date===day&&range==='day'} aria-current={date===today?'date':undefined} onKeyDown={e=>keyboard(e,date)} onClick={()=>selectDate(date)}><span className="tile-date">{Number(date.slice(8))}{date===today&&<i className="today-mark"/>}</span>{num>0&&<span className="tile-count">{num}<small>건</small></span>}{resultCount>0&&<span className="tile-result" aria-hidden="true"/>}</button>;})}
        </div>
        <div className="month-legend"><span>표시 건수</span><i className="heat-0"/><span>0</span><i className="heat-1"/><span>1</span><i className="heat-2"/><span>2–3</span><i className="heat-3"/><span>4–5</span><i className="heat-4"/><span>6+</span><span className="result-dot-label"><i/>결과 있음</span></div>
        <p className="calendar-note">날짜를 누르면 상세를 봅니다. 계획일과 작업·확인일이 다르면 각각 표시합니다. 지난 계획도 결과를 기록하기 전에는 완료로 표시하지 않습니다.</p>
        <div className="month-footer"><button className="text-button" onClick={()=>{setRange('month');setLimit(20);}}>이 달 전체 {monthEntries.length}건 보기<ArrowRight size={16}/></button><button className="text-button" onClick={()=>{setRange('undated');setLimit(20);}}>일정 미정 {entries.filter(e=>!e.date).length}건</button></div>
      </section>
      <aside className="month-overview"><h3>이 달의 결과</h3><p className="muted small">현재 검색 조건 · 작업·확인일 기준</p><dl>{Object.entries(STATES).map(([s,n])=><div key={s}><dt><span className={`outcome-dot ${s}`}/>{n}</dt><dd>{counts[s]}<small>건</small></dd></div>)}</dl><p className="calendar-note">미실시는 완료 작업에 포함하지 않습니다. 결과 미기록은 작업을 하지 않았다는 뜻이 아닙니다.</p><button className="button secondary full" disabled={!monthResults.length} onClick={()=>saveCsv(`포장작업_결과_${month}.csv`,makeResultCsv(monthResults))}><DownloadSimple size={17}/>이 달 결과 CSV</button>{historyLoaded&&<p className="calendar-note">표시된 과거 자료는 실제 업무가 아닌 예시입니다.</p>}</aside>
    </div>
    <section className="calendar-detail" aria-label="선택한 작업 내역"><div className="calendar-detail-head"><div><span className="tiny-label">작업 내역</span><h2>{range==='month'?`${monthLabel(month)} 전체`:range==='undated'?'일정 미정':dateLabel(day)}</h2><p className="muted small">현재 조건 {chosen.length}건{chosen.length>limit?` · ${limit}건 표시`:''}</p></div>{range==='day'&&<button className="button secondary" onClick={()=>onAddPlan(monday(day))}><Plus size={17}/>이 주 계획 입력</button>}</div>
      {!chosen.length?<div className="calendar-empty"><CalendarBlank size={30}/><b>표시할 작업이 없습니다</b><p>날짜를 선택하거나 검색 조건을 바꿔보세요. 결과 미기록을 미실시로 간주하지 않습니다.</p></div>:<div className="calendar-records">{chosen.slice(0,limit).map(entry=>{const plan=state.plans.find(p=>p.id===entry.planId);const r=entry.kind!=='plan'?entry.result:null;const changes=state.history.filter(h=>h.type==='recordResult'&&h.planId===entry.planId);return <article className="calendar-record" key={entry.id} data-entry-kind={entry.kind}>
        <div className="record-date">{short(entry.date)}<span>{entry.kind==='both'?'계획·결과':entry.kind==='result'?'작업·확인일':'계획일'}</span></div>
        <div className="record-content"><div className="record-title"><h3>{entry.task}</h3>{r?<span className={`outcome-badge ${r.status}`}>{STATES[r.status]}</span>:<span className="outcome-badge no-result">{entry.result?'계획일 표시':'결과 미기록'}</span>}{entry.cancelled&&<span className="badge missing">계획 취소됨</span>}</div><p className="record-meta">{entry.place||'포장 미정'} · {entry.assignees.join(', ')||'담당자 미정'}{entry.time?` · 계획 시간 ${entry.time}`:''}</p>
          {r?<><p className="result-summary">{r.summary}</p><p className="record-meta">최초 기록 당시 계획일 {r.planSnapshot?.date||'미정'} → 작업·확인일 {r.date} · 기록자 {r.recorder}</p>{changes.length>0&&<details className="result-history"><summary>결과 수정 이력 {changes.length}건</summary>{[...changes].reverse().map(h=><div key={h.id}><b>{h.at.replace('T',' ').slice(0,16)} UTC · {h.before?.result?'결과 수정':'최초 기록'}</b>{h.before?.result&&<p>수정 전: {STATES[h.before.result.status]} · {h.before.result.date} · {h.before.result.summary} · {h.before.result.recorder}</p>}<p>반영 후: {STATES[h.after?.result?.status]} · {h.after?.result?.date} · {h.after?.result?.summary} · {h.after?.result?.recorder}</p></div>)}</details>}</>:entry.result?<p className="calendar-note">결과는 {entry.result.date}에 기록되어 있습니다. ‘결과’ 보기에서 확인하세요.</p>:<p className="calendar-note">아직 확인된 작업 결과가 없습니다.</p>}
        </div><div className="record-actions"><button className="text-button" onClick={()=>onOpenPlan(entry.planId)}>계획 보기<ArrowRight size={15}/></button><button className="button secondary" disabled={plan.cancelled} onClick={()=>onResult(plan)}>{plan.result?'결과 수정':'결과 기록'}</button></div>
      </article>;})}</div>}
      {chosen.length>limit&&<button className="button secondary full" onClick={()=>setLimit(l=>l+20)}>작업 내역 더 보기</button>}
    </section>
  </div>;
}
