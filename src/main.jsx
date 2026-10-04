import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarBlank,
  Users,
  ClipboardText,
  Plus,
  CaretLeft,
  CaretRight,
  Check,
  WarningCircle,
  DownloadSimple,
  Copy,
  PencilSimple,
  ArrowCounterClockwise,
  ChatCircleText,
  FileText,
  ArrowRight,
  X,
  SlidersHorizontal,
} from "./icons.mjs";
import {
  nextWeek,
  monday,
  shiftDay,
  weekPlans,
  memberStatuses,
  planIssues,
  weekChanged,
} from "../lib/domain.mjs";
import { makeNotice, makeCsv, changeSummary } from "../lib/exports.mjs";
import { loadState, sendCommand, offline, publicDemo, storageLabel, subscribeStorage } from "./store.mjs";
import { IntakeDialog, EditDialog, ConfirmDialog } from "./forms.jsx";
import "./style.css";
import { analyzeWeek } from "../lib/planning.mjs";
import { PlanFilters, WeekCalendar, ChecksView, ReminderComposer, CopyWeekDialog } from "./planning.jsx";
import {WorkCalendar, ResultDialog} from "./calendar.jsx";
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const statusNames = {
  submitted: "제출 완료",
  review: "확인 필요",
  none: "작업 없음",
  missing: "미제출",
};
const eventNames = {
  submit: "계획 등록",
  editPlan: "내용 수정",
  cancelPlan: "취소 상태 변경",
  finalize: "취합 확정",
  loadExample: "예시 불러오기",
  copyPlans: "이전 주에서 복사",
  recordResult: "작업 결과 기록",
  loadHistoryExample: "과거 예시 불러오기",
};
function shortDate(v) {
  return v ? `${Number(v.slice(5, 7))}.${Number(v.slice(8, 10))}` : "일정 미정";
}
function dayLabel(v) {
  return v
    ? `${shortDate(v)} (${DAYS[new Date(v + "T00:00:00Z").getUTCDay()]})`
    : "일정 미정";
}
function timeLabel(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.valueOf())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
}
function download(name, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function historyLine(h) {
  if(h.type === "recordResult") {const r=h.after?.result;return r ? `작업·확인일 ${r.date} · ${({done:"완료",partial:"일부 완료","not-done":"미실시"})[r.status]} · ${r.summary} · 기록자 ${r.recorder}` : "";}
  if (!h.before || !h.after) return "";
  if (h.before.cancelled !== h.after.cancelled)
    return h.after.cancelled
      ? "현재 취합에서 제외했습니다."
      : "현재 취합으로 복구했습니다.";
  const labels = {
    date: "작업일",
    time: "시간",
    place: "포장",
    task: "작업내용",
    assignees: "담당자",
    notes: "비고",
  };
  return (
    Object.entries(labels)
      .filter(
        ([k]) => JSON.stringify(h.before[k]) !== JSON.stringify(h.after[k]),
      )
      .map(([k, label]) => {
        const show = (v) => (Array.isArray(v) ? v.join(", ") : v || "미정");
        return `${label}: ${show(h.before[k])} → ${show(h.after[k])}`;
      })
      .join("\n") || "원문 대조를 완료했습니다."
  );
}
function Badge({ status, children }) {
  return (
    <span className={`badge ${status}`}>{children || statusNames[status]}</span>
  );
}
function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <CalendarBlank size={38} weight="light" />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function App() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [week, setWeek] = useState(nextWeek());
  const [route, setRoute] = useState(location.hash.slice(1) || "/week");
  const [group, setGroup] = useState("day");
  const [filter, setFilter] = useState("active");
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberError, setMemberError] = useState("");
  const [saving, setSaving] = useState(false);
  const [noticeMode, setNoticeMode] = useState("current");
  const [view, setView] = useState("list");
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState("");
  const [place, setPlace] = useState("");
  const [exampleBusy, setExampleBusy] = useState(false);
  const [exampleError, setExampleError] = useState("");
  const analysis = useMemo(() => state ? analyzeWeek(state, week) : {conflicts:[], unchecked:[], totalConflicts:0}, [state,week]);
  function resetFilters(){setQuery("");setPerson("");setPlace("");}
  function openPlan(id){const target=state?.plans.find(p=>p.id===id);if(!target)return;resetFilters();setWeek(target.week);setFilter(target.cancelled?"cancelled":"active");setSelected(id);location.hash="/week";}
  useEffect(()=>{if(selected)requestAnimationFrame(()=>document.querySelector('.context-panel:has(.source-block)')?.scrollIntoView({block:'nearest'}));},[selected,route,view]);
  async function addConflictExample(){
    setExampleBusy(true);setExampleError("");
    try {
      if(!state.members.length) throw new Error("취합 대상을 먼저 추가해 주세요.");
      if(weekPlans(state,week).some(p=>p.sourceText==='[일정 겹침 시연 예시]')) throw new Error("이미 추가한 겹침 예시가 있습니다. 해당 계획을 수정하며 확인해 주세요.");
      await command({type:"submit",week,submitterId:state.members[0].id,sourceText:'[일정 겹침 시연 예시]',items:[
        {date:shiftDay(week,3),time:'09:00~11:00',place:'시험포장 D (예시)',task:'관수 준비 (겹침 예시)',assignees:[state.members[0].name],notes:'시간 겹침 점검을 위한 가상 일정입니다.',reviewed:true},
        {date:shiftDay(week,3),time:'10:00~12:00',place:'시험포장 D (예시)',task:'생육 조사 (겹침 예시)',assignees:[state.members[0].name],notes:'공동 작업 여부나 시간을 직접 확인하세요.',reviewed:true}
      ]});
    } catch(e){setExampleError(e.message);} finally {setExampleBusy(false);}
  }
  useEffect(() => {
    const changed = () => setRoute(location.hash.slice(1) || "/week");
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  async function refresh() {
    setLoadError("");
    try {
      setState(await loadState());
    } catch (e) {
      setLoadError(e.message);
    }
  }
  useEffect(() => {
    refresh();
    return subscribeStorage(refresh);
  }, []);
  useEffect(() => {
    setSelected(id=>state?.plans.some(p=>p.id===id&&p.week===week)?id:null);
    setNoticeMode("current");
    resetFilters();setExampleError("");
  }, [week]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  async function command(payload) {
    try {
      const next = await sendCommand(state, payload);
      setState(next);
      setToast(
        payload.type === "finalize"
          ? (publicDemo ? "시연 확정본을 만들었습니다. 새로고침하면 초기화됩니다." : "취합 확정본을 저장했습니다. 카톡에는 발송하지 않았습니다.")
          : (publicDemo ? "시연 화면에 반영했습니다. 새로고침하면 초기화됩니다." : "저장했습니다."),
      );
      return next;
    } catch (e) {
      if (e.status === 409 || /revision|다른|변경|충돌/i.test(e.message))
        await refresh();
      throw e;
    }
  }
  const active = state ? weekPlans(state, week) : [];
  const all = state ? weekPlans(state, week, true) : [];
  const statuses = state ? memberStatuses(state, week) : [];
  const review = active.filter((p) => planIssues(p).length);
  const latest = state?.snapshots.filter((s) => s.week === week).at(-1);
  const changed = state ? weekChanged(state, week) : false;
  const plan = all.find((p) => p.id === selected);
  const missing = statuses.filter((x) => x.status === "missing");
  const visible = all.filter((p) => {
    const statusMatch = filter === "cancelled" ? p.cancelled : filter === "review" ? !p.cancelled && planIssues(p).length : !p.cancelled;
    const haystack = [p.task,p.place,p.notes,...p.assignees].join(" ").toLocaleLowerCase();
    return statusMatch && (!query.trim() || haystack.includes(query.trim().toLocaleLowerCase())) && (!person || p.assignees.includes(person)) && (!place || p.place===place);
  });
  const groups = useMemo(() => {
    const result = new Map();
    for (const p of visible) {
      const keys =
        group === "day"
          ? [p.date || "undated"]
          : group === "place"
            ? [p.place || "포장 미정"]
            : p.assignees.length
              ? p.assignees
              : ["담당자 미정"];
      for (const k of keys) {
        if (!result.has(k)) result.set(k, []);
        result.get(k).push(p);
      }
    }
    return [...result.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], "ko"),
    );
  }, [state, week, group, filter, query, person, place]);
  const notice = state
    ? noticeMode === "snapshot" && latest
      ? latest.notice
      : makeNotice(state, week)
    : "";
  async function copyNotice() {
    try {
      await navigator.clipboard.writeText(notice);
      setToast("공지문을 복사했습니다. 카톡 발송은 하지 않았습니다.");
    } catch {
      document.querySelector("#notice-text")?.select();
      setToast(
        "자동 복사가 제한되었습니다. 선택된 공지문을 직접 복사해 주세요.",
      );
    }
  }
  async function addMember(e) {
    e.preventDefault();
    setSaving(true);
    setMemberError("");
    try {
      await command({ type: "addMember", name: memberName.trim() });
      setMemberName("");
    } catch (e) {
      setMemberError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const nav = [
    ["/calendar", "작업 달력", CalendarBlank],
    ["/week", "주간 계획", CalendarBlank],
    ["/checks", "일정 점검", WarningCircle],
    ["/submissions", "제출 현황", Users],
    ["/notice", "취합·공지", ClipboardText],
    ["/settings", "취합 대상", SlidersHorizontal],
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/week">
          <span className="brand-icon">
            <CalendarBlank weight="bold" size={23} />
          </span>
          <span>
            포장계획<span className="brand-sub">주간 업무 취합</span>
          </span>
        </a>
        <div className="sidebar-label">작업 공간</div>
        <nav aria-label="주 메뉴">
          {nav.map(([href, title, Icon]) => (
            <a
              key={href}
              href={"#" + href}
              className={route === href ? "nav-item selected" : "nav-item"}
              aria-current={route === href ? "page" : undefined}
            >
              <Icon size={21} />
              {title}
              {href === "/submissions" && review.length > 0 && (
                <span className="nav-count">{review.length}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="tiny-label">연결 상태</span>
          <div className="connection">
            <span className="dot" />
            카카오 미연결
          </div>
          <p>지정한 방의 연결과 실제 양식은 다음 단계에 적용합니다.</p>
          <div className="storage-state">
            <FileText size={15} />
            {storageLabel}
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="draft-banner">
          <span>
            <span className="draft-pill">{publicDemo ? "공개 시연" : "작동 초안"}</span>
            {publicDemo ? "예시 전용 · 실제 업무자료는 입력하지 마세요. 새로고침하면 초기화됩니다." : "팀 데이터가 아닌 예시·직접 입력으로 확인하세요."}
          </span>
          {publicDemo ? (
            <button className="button secondary" onClick={() => location.reload()}>예시 처음으로</button>
          ) : <span className="banner-right">자동 발송 없음</span>}
        </div>
        {loadError ? (
          <div className="load-error" role="alert">
            <WarningCircle size={30} />
            <h2>초안을 열지 못했습니다</h2>
            <p>{loadError}</p>
            <button className="button primary" onClick={refresh}>
              다시 연결
            </button>
          </div>
        ) : !state ? (
          <div className="skeleton-wrap" aria-label="초안 불러오는 중">
            <div className="skeleton heading" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : (
          <>
            <header className="page-head">
              <div>
                <div className="eyebrow">
                  {route === "/settings" ? "팀 설정" : route === "/calendar" ? "계획과 결과" : "주간 업무"}
                </div>
                <h1>{nav.find((n) => n[0] === route)?.[1] || "주간 계획"}</h1>
                <p>
                  {route === "/calendar" ? "앞으로 할 일과 지난 작업의 결과를 날짜별로 확인합니다." : route === "/week"
                    ? "카톡에 흩어진 계획을, 한 주의 일정으로."
                    : route === "/checks"
                      ? "겹치는 일정과 미정 항목을 확인하고, 원래 계획에서 직접 수정합니다."
                    : route === "/submissions"
                      ? "제출자 기준으로 확인합니다. 공동 담당자는 별도 제출로 세지 않습니다."
                      : route === "/notice"
                        ? "취합안을 확인하고, 기존 공지에 옮길 내용을 준비합니다."
                        : "실제 카카오 구성원과 연동되기 전의 수동 취합 명단입니다."}
                </p>
              </div>
              {route !== "/settings" && route !== "/calendar" && (
                <button
                  className="button primary"
                  onClick={() => setDialog({ kind: "intake" })}
                >
                  <Plus size={19} />
                  계획 입력
                </button>
              )}
            </header>
            {route !== "/settings" && route !== "/calendar" && (
              <div className="week-toolbar">
                <div className="week-selector">
                  <button
                    className="icon-button"
                    aria-label="이전 주"
                    onClick={() => setWeek(shiftDay(week, -7))}
                  >
                    <CaretLeft size={18} />
                  </button>
                  <label className="week-picker">
                    <span>
                      {shortDate(week)} — {shortDate(shiftDay(week, 6))}
                    </span>
                    <span className="year">{week.slice(0, 4)}</span>
                    <input
                      aria-label="조회할 주 선택"
                      type="date"
                      value={week}
                      onChange={(e) => {
                        if (e.target.value) setWeek(monday(e.target.value));
                      }}
                    />
                  </label>
                  <button
                    className="icon-button"
                    aria-label="다음 주"
                    onClick={() => setWeek(shiftDay(week, 7))}
                  >
                    <CaretRight size={18} />
                  </button>
                  <button
                    className="text-button small"
                    onClick={() => setWeek(nextWeek())}
                  >
                    다음 주로
                  </button>
                </div>
                <Badge
                  status={
                    latest ? (changed ? "review" : "submitted") : "missing"
                  }
                >
                  {latest
                    ? changed
                      ? "확정 후 변경 있음"
                      : "취합 확정"
                    : "취합 중"}
                </Badge>
              </div>
            )}
            {route === "/calendar" && <WorkCalendar state={state} onCommand={command} onOpenPlan={openPlan} onResult={plan=>setDialog({kind:"result",plan})} onAddPlan={target=>{setWeek(target);setDialog({kind:"intake"});}}/>}
            {route === "/week" && (
              <>
                <a className="calendar-quicklink" href="#/calendar"><span><b>작업 달력</b>에서 지난 작업과 결과까지 한눈에 확인하세요.</span><ArrowRight size={18}/></a>
                <div className="summary-line">
                  <span>
                    <b>{active.length}</b>개 작업
                  </span>
                  <span>
                    <b>
                      {
                        statuses.filter(
                          (x) =>
                            x.status === "submitted" || x.status === "none",
                        ).length
                      }
                    </b>
                    명 제출 완료
                  </span>
                  <span className={review.length ? "amber" : ""}>
                    <b>{review.length}</b>건 확인 필요
                  </span>
                  <span>
                    <b>{missing.length}</b>명 미제출
                  </span>
                </div>
                <div className="feature-toolbar">
                  <div className="segmented" aria-label="계획 표시 방식">
                    <button className={view==='list'?'active':''} aria-pressed={view==='list'} onClick={()=>setView('list')}>목록 보기</button>
                    <button className={view==='calendar'?'active':''} aria-pressed={view==='calendar'} onClick={()=>setView('calendar')}>주간 일정표</button>
                  </div>
                  <button className="button secondary" disabled={!active.length} onClick={()=>setDialog({kind:'copy'})}><Copy size={17}/>다음 주에 복사</button>
                </div>
                <PlanFilters plans={all} query={query} person={person} place={place} onQuery={setQuery} onPerson={setPerson} onPlace={setPlace} onReset={resetFilters} count={visible.length}/>
                <a className="check-link" href="#/checks"><span><b>일정 점검</b> · 겹침 후보 {analysis.totalConflicts}쌍 · 시간·날짜 점검 한계 {analysis.unchecked.length}건</span><ArrowRight size={17}/></a>
                <div className={`workspace-grid ${plan ? "detail-open" : ""} ${view==='calendar'?'calendar-mode':''}`}>
                  <section className="plan-list">
                    <div className="list-toolbar">
                      {view==='list' ? <div className="segmented" aria-label="계획 묶음 기준">
                        <button
                          className={group === "day" ? "active" : ""}
                          onClick={() => setGroup("day")}
                        >
                          요일별
                        </button>
                        <button
                          className={group === "person" ? "active" : ""}
                          onClick={() => setGroup("person")}
                        >
                          담당자별
                        </button>
                        <button
                          className={group === "place" ? "active" : ""}
                          onClick={() => setGroup("place")}
                        >
                          포장별
                        </button>
                      </div> : <p className="small muted">월요일부터 일요일까지 · 미정 일정은 하단에 표시</p>}
                      <select
                        aria-label="계획 상태 필터"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="active">현재 계획</option>
                        <option value="review">확인 필요</option>
                        <option value="cancelled">취소된 계획</option>
                      </select>
                    </div>
                    {view==='calendar' ? <WeekCalendar week={week} plans={visible} selected={selected} onSelect={setSelected}/> : !visible.length ? (
                      <Empty
                        title={
                          query || person || place
                            ? "검색 조건에 맞는 계획이 없습니다"
                            : filter === "cancelled"
                            ? "취소된 계획이 없습니다"
                            : filter === "review"
                              ? "확인이 필요한 계획이 없습니다"
                              : "아직 등록된 계획이 없습니다"
                        }
                      >
                        {filter === "active"
                          ? "계획을 입력하거나 예시를 불러와 취합 흐름을 확인하세요."
                          : "다른 상태를 선택하면 등록된 계획을 볼 수 있습니다."}
                      </Empty>
                    ) : (
                      groups.map(([key, plans]) => (
                        <section className="day-section" key={key}>
                          <div className="day-heading">
                            <h2>
                              {group === "day"
                                ? key === "undated"
                                  ? "일정 미정"
                                  : dayLabel(key)
                                : key}
                            </h2>
                            <span>{plans.length}건</span>
                          </div>
                          {plans.map((p) => (
                            <button
                              key={p.id}
                              className={`plan-row ${selected === p.id ? "is-selected" : ""} ${p.cancelled ? "cancelled" : ""}`}
                              onClick={() => setSelected(p.id)}
                            >
                              <div className="plan-time">
                                {group === "day"
                                  ? p.time || "시간 미정"
                                  : dayLabel(p.date)}
                                {group !== "day" && (
                                  <small>{p.time || "시간 미정"}</small>
                                )}
                              </div>
                              <div className="plan-content">
                                <div className="row wrap">
                                  <strong>{p.task}</strong>
                                  {p.cancelled ? (
                                    <Badge status="missing">취소</Badge>
                                  ) : planIssues(p).length > 0 ? (
                                    <Badge status="review">확인 필요</Badge>
                                  ) : null}
                                </div>
                                <div className="plan-meta">
                                  <span>{p.place || "포장 미정"}</span>
                                  <span>
                                    {p.assignees.filter(Boolean).join(" · ") ||
                                      "담당자 미정"}
                                  </span>
                                </div>
                                {p.notes && (
                                  <p className="plan-notes">{p.notes}</p>
                                )}
                              </div>
                              <CaretRight className="row-arrow" size={18} />
                            </button>
                          ))}
                        </section>
                      ))
                    )}
                    {!state.members.length && (
                      <div className="first-actions">
                        <button
                          className="button primary"
                          onClick={() => setDialog({ kind: "example" })}
                        >
                          예시로 둘러보기 <ArrowRight size={17} />
                        </button>
                        <a href="#/settings" className="button secondary">
                          취합 대상부터 추가
                        </a>
                      </div>
                    )}
                  </section>
                  <aside className="context-panel">
                    {plan ? (
                      <>
                        <div className="row between">
                          <span className="tiny-label">작업 상세</span>
                          <button
                            className="icon-button"
                            aria-label="상세 닫기"
                            onClick={() => setSelected(null)}
                          >
                            <X size={20} />
                          </button>
                        </div>
                        <h2>{plan.task}</h2>
                        <p className="muted">
                          {dayLabel(plan.date)} · {plan.time || "시간 미정"}
                        </p>
                        <dl>
                          <dt>포장</dt>
                          <dd>{plan.place || "미정"}</dd>
                          <dt>담당</dt>
                          <dd>
                            {plan.assignees.filter(Boolean).join(", ") ||
                              "미정"}
                          </dd>
                          <dt>제출자</dt>
                          <dd>
                            {state.members.find(
                              (m) => m.id === plan.submitterId,
                            )?.name || "알 수 없음"}
                          </dd>
                        </dl>
                        {planIssues(plan).length > 0 && (
                          <div className="warning-box">
                            {planIssues(plan).map((x, i) => (
                              <div key={i}>{x}</div>
                            ))}
                          </div>
                        )}
                        <div className="row wrap">
                          <button
                            className="button secondary"
                            disabled={plan.cancelled}
                            onClick={() => setDialog({ kind: "edit", plan })}
                          >
                            <PencilSimple size={17} />
                            수정
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setDialog({ kind: "cancel", plan })}
                          >
                            {plan.cancelled ? (
                              <ArrowCounterClockwise size={17} />
                            ) : (
                              <X size={17} />
                            )}
                            {plan.cancelled ? "취소 복구" : "계획 취소"}
                          </button>
                        </div>
                        <div className="source-block"><h3>작업 결과</h3>{plan.result ? <><p className="small">{({done:"완료",partial:"일부 완료","not-done":"미실시"})[plan.result.status]} · {plan.result.date}</p><pre>{plan.result.summary}</pre><p className="small muted">기록자 {plan.result.recorder}</p></> : <p className="small muted">아직 결과를 기록하지 않았습니다.</p>}<button className="button secondary" disabled={plan.cancelled} onClick={()=>setDialog({kind:"result",plan})}>{plan.result?"결과 수정":"결과 기록"}</button></div>
                        {plan.copiedFrom && <div className="warning-box">{plan.copiedFrom.week} 주의 계획에서 복사했습니다. 아래 원문은 이전 주 자료이며 이번 주 제출을 뜻하지 않습니다. 날짜·내용을 다시 검토해 주세요.</div>}
                        <div className="source-block">
                          <div className="row">
                            <ChatCircleText size={18} />
                            <h3>제출 원문</h3>
                          </div>
                          <p className="small muted">
                            실제 카카오 수신이 아닌 초안 입력 원문입니다.
                          </p>
                          <pre>
                            {plan.sourceText || "직접 입력한 계획입니다."}
                          </pre>
                        </div>
                        <div className="history-block">
                          <h3>최근 변경 이력</h3>
                          {state.history
                            .filter((h) => h.planId === plan.id)
                            .slice(-8)
                            .reverse()
                            .map((h, i) => (
                              <div className="history-item" key={h.id || i}>
                                <span className="history-dot" />
                                <div>
                                  <b>{eventNames[h.type] || "계획 변경"}</b>
                                  <small>{timeLabel(h.at)}</small>
                                  {h.before && h.after && (
                                    <p>{historyLine(h)}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="tiny-label">이번 주 취합</span>
                        <h2>제출 현황</h2>
                        <div className="member-mini-list">
                          {statuses.length ? (
                            statuses.slice(0, 8).map((s) => (
                              <div key={s.memberId}>
                                <span>{s.name}</span>
                                <Badge status={s.status} />
                              </div>
                            ))
                          ) : (
                            <p className="muted">
                              취합 대상을 등록하면
                              <br />
                              미제출 여부를 확인할 수 있습니다.
                            </p>
                          )}
                        </div>
                        <a href="#/submissions" className="text-link">
                          전체 현황 보기 <ArrowRight size={16} />
                        </a>
                        <div className="panel-note">
                          <ClipboardText size={23} />
                          <h3>계획을 모은 다음에는</h3>
                          <p>
                            확인할 항목을 정리하고
                            <br />
                            취합 파일과 공지문을 만드세요.
                          </p>
                          <a href="#/notice" className="button secondary">
                            취합·공지 열기
                          </a>
                        </div>
                      </>
                    )}
                  </aside>
                </div>
              </>
            )}
            {route === "/checks" && <ChecksView key={week} state={state} week={week} analysis={analysis} onOpen={openPlan} onExample={publicDemo?addConflictExample:null} exampleBusy={exampleBusy} exampleError={exampleError}/>}
            {route === "/submissions" && (
              <><section className="section-panel">
                <div className="section-head">
                  <h2>제출자별 현황</h2>
                  <a className="text-link" href="#/settings">
                    명단 관리 <ArrowRight size={16} />
                  </a>
                </div>
                {statuses.length ? (
                  <div className="submission-list">
                    {statuses.map((s) => (
                      <div className="submission-row" key={s.memberId}>
                        <div className="initial">{s.name.slice(-1)}</div>
                        <div className="grow">
                          <h3>{s.name}</h3>
                          <p>
                            {s.status === "none"
                              ? "포장 작업 없음으로 제출"
                              : s.status === "missing"
                                ? "아직 제출된 계획이 없습니다"
                                : `등록된 작업 ${s.count}건`}
                          </p>
                        </div>
                        <Badge status={s.status} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title="취합 대상을 추가해 주세요">
                    누가 제출했고 누가 아직 제출하지 않았는지 구분할 명단이
                    필요합니다.
                  </Empty>
                )}
                <div className="section-foot">
                  이 초안의 이름은 수동 명단입니다. 카카오 계정 인증·미제출 알림
                  발송은 하지 않습니다.
                </div>
              </section><ReminderComposer key={week} state={state} week={week} onToast={setToast} download={download}/></>
            )}
            {route === "/notice" && (
              <div className="notice-layout">
                <section className="section-panel">
                  <div className="section-head">
                    <div>
                      <h2>공지문 미리보기</h2>
                      <p>실제 공지 양식을 받기 전의 임시 형식입니다.</p>
                    </div>
                    <button className="button secondary" onClick={copyNotice}>
                      <Copy size={17} />
                      복사
                    </button>
                  </div>
                  <div className="notice-tabs segmented">
                    <button
                      className={noticeMode === "current" ? "active" : ""}
                      onClick={() => setNoticeMode("current")}
                    >
                      현재 취합안
                    </button>
                    <button
                      className={noticeMode === "snapshot" ? "active" : ""}
                      disabled={!latest}
                      onClick={() => setNoticeMode("snapshot")}
                    >
                      마지막 확정본
                    </button>
                  </div>
                  <textarea
                    id="notice-text"
                    className="notice-text"
                    aria-label="공지문"
                    readOnly
                    value={notice}
                  />
                  <div className="section-foot">
                    복사·다운로드만 가능합니다. 카카오톡에 자동 발송되지
                    않습니다.
                  </div>
                </section>
                <aside className="notice-actions">
                  <section className="section-panel padded">
                    <span className="tiny-label">취합 상태</span>
                    <h2>
                      {latest
                        ? changed
                          ? "확정 후 변경되었습니다"
                          : "확정본이 저장되었습니다"
                        : "아직 취합 중입니다"}
                    </h2>
                    <p className="muted">
                      {latest
                        ? `마지막 확정: ${timeLabel(latest.createdAt)}`
                        : "확정하면 현재 계획과 공지문을 함께 보관합니다."}
                    </p>
                    {analysis.totalConflicts > 0 && <a href="#/checks" className="check-link">일정 겹침 후보 {analysis.totalConflicts}쌍 확인 <ArrowRight size={16}/></a>}
                    {review.length > 0 && (
                      <div className="warning-box">
                        확인 필요한 작업 {review.length}건을 먼저 수정해 주세요.
                      </div>
                    )}
                    {missing.length > 0 && (
                      <p className="small muted">
                        미제출 {missing.length}명은 공지문에 표시됩니다. 미제출
                        상태로도 확정할 수 있습니다.
                      </p>
                    )}
                    <button
                      className="button primary full"
                      disabled={
                        review.length > 0 ||
                        (!active.length &&
                          !statuses.some((s) => s.status === "none")) ||
                        (!!latest && !changed)
                      }
                      onClick={() => setDialog({ kind: "finalize" })}
                    >
                      <Check size={18} />
                      현재 취합 확정
                    </button>
                  </section>
                  <section className="section-panel padded">
                    <h3>취합 파일</h3>
                    <p>
                      엑셀에서 열 수 있는 CSV입니다.
                      <br />
                      기존 파일 양식은 아직 미적용입니다.
                    </p>
                    <button
                      className="button secondary full"
                      onClick={() =>
                        download(
                          `포장계획_${week}.csv`,
                          makeCsv(state, week),
                          "text/csv;charset=utf-8",
                        )
                      }
                    >
                      <DownloadSimple size={18} />
                      현재 계획 CSV
                    </button>
                    <button
                      className="text-button full"
                      onClick={() =>
                        download(`포장계획_공지_${week}.txt`, notice)
                      }
                    >
                      <FileText size={17} />
                      공지문 TXT
                    </button>
                  </section>
                  {latest && (
                    <section className="section-panel padded">
                      <h3>확정본과의 차이</h3>
                      <pre className="change-text">
                        {changeSummary(state, week)}
                      </pre>
                    </section>
                  )}
                </aside>
              </div>
            )}
            {route === "/settings" && (
              <div className="settings-layout">
                <section className="section-panel">
                  <div className="section-head">
                    <div>
                      <h2>취합 대상 명단</h2>
                      <p>
                        제출자 이름을 추가해 주세요. 공동 작업 담당자는 계획별로
                        입력합니다.
                      </p>
                    </div>
                  </div>
                  <form className="add-member-form" onSubmit={addMember}>
                    <label>
                      이름
                      <input
                        aria-label="추가할 제출자 이름"
                        value={memberName}
                        maxLength={40}
                        onChange={(e) => setMemberName(e.target.value)}
                        placeholder="제출자 이름"
                        disabled={saving}
                      />
                    </label>
                    <button
                      className="button primary"
                      disabled={saving || !memberName.trim()}
                    >
                      <Plus size={18} />
                      추가
                    </button>
                  </form>
                  {memberError && (
                    <p role="alert" className="form-error padded-inline">
                      {memberError}
                    </p>
                  )}
                  <div className="roster">
                    {state.members.map((m) => (
                      <div key={m.id}>
                        <span className="initial">{m.name.slice(-1)}</span>
                        <b>{m.name}</b>
                        <span className="muted small">수동 등록</span>
                      </div>
                    ))}
                  </div>
                  {!state.members.length && (
                    <Empty title="등록된 취합 대상이 없습니다">
                      이름을 추가하거나 예시 명단으로 먼저 확인해 보세요.
                    </Empty>
                  )}
                </section>
                <aside className="section-panel padded">
                  <span className="tiny-label">초안 사용 안내</span>
                  <h2>
                    양식을 맞추기 전,
                    <br />
                    흐름부터 확인합니다.
                  </h2>
                  <ul className="plain-list">
                    <li>카카오 메시지를 수신하거나 발송하지 않습니다.</li>
                    <li>
                      메시지 항목 정리는 규칙 기반입니다. AI 해석은
                      미연결입니다.
                    </li>
                    <li>
                      {publicDemo
                        ? "입력·수정은 현재 화면의 메모리에서만 체험합니다. 서버나 브라우저 저장소에 저장하지 않으며, 새로고침하면 예시로 돌아갑니다."
                        : offline
                        ? "저장 내용은 이 브라우저에만 남습니다. 브라우저 데이터 삭제 시 사라집니다."
                        : "저장 내용은 서버에 남으며 다른 기기에서도 같은 내용을 확인합니다. 공유 기기에서는 사용 후 브라우저를 닫아 주세요."}
                    </li>
                    <li>실제 업무자료 대신 예시로 검토해 주세요.</li>
                  </ul>
                  {!state.members.length && !state.plans.length && (
                    <button
                      className="button secondary full"
                      onClick={() => setDialog({ kind: "example" })}
                    >
                      예시 데이터 불러오기
                    </button>
                  )}
                  <p className="small muted">
                    제출·수정 권한은 현재 단일 사용자 검토용입니다. 팀원 인증과
                    원문 보관기간은 실제 연동 단계에서 정합니다.
                  </p>
                </aside>
              </div>
            )}
            {!nav.some((n) => n[0] === route) && (
              <Empty
                title="페이지를 찾지 못했습니다"
                action={
                  <a href="#/week" className="button primary">
                    주간 계획으로
                  </a>
                }
              >
                주 메뉴에서 확인할 화면을 선택해 주세요.
              </Empty>
            )}
            <footer className="page-footer">
              <span>주간 포장계획 · {publicDemo ? "예시 전용 시연" : "검토용 초안"}</span>
              <span>{storageLabel} · AI·카카오 미연결</span>
            </footer>
          </>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {state && dialog?.kind === "result" && <ResultDialog plan={dialog.plan} onCommand={command} onClose={()=>setDialog(null)}/>}
      {state && dialog?.kind === "copy" && <CopyWeekDialog state={state} week={week} onCommand={command} onClose={()=>setDialog(null)} onCopied={target=>{setWeek(target);setFilter('review');location.hash='/week';setToast('다음 주에 복사했습니다. 확인 필요 항목을 검토해 주세요.');}}/>}
      {state && dialog?.kind === "intake" && (
        <IntakeDialog
          state={state}
          week={week}
          onCommand={command}
          onClose={() => setDialog(null)}
        />
      )}
      {state && dialog?.kind === "edit" && (
        <EditDialog
          plan={dialog.plan}
          onCommand={command}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "example" && (
        <ConfirmDialog
          title="예시로 둘러보기"
          label="예시 불러오기"
          onClose={() => setDialog(null)}
          onConfirm={() => command({ type: "loadExample", week })}
        >
          <p>
            가상의 제출자와 포장 작업을 불러옵니다. 실제 팀 업무가 아닙니다.
          </p>
          <p className="muted">
            제출 완료·확인 필요·작업 없음·미제출 상태를 비교할 수 있습니다.
            예시도 저장되므로 검토용으로만 사용해 주세요.
          </p>
        </ConfirmDialog>
      )}
      {dialog?.kind === "cancel" && (
        <ConfirmDialog
          title={
            dialog.plan.cancelled
              ? "취소한 계획을 복구할까요?"
              : "이 계획을 취소할까요?"
          }
          label={dialog.plan.cancelled ? "계획 복구" : "계획 취소"}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            command({
              type: "cancelPlan",
              id: dialog.plan.id,
              cancelled: !dialog.plan.cancelled,
            })
          }
        >
          <p>{dialog.plan.task}</p>
          <p className="muted">
            원문과 변경 이력은 보관합니다. 취소한 계획은 현재 취합·공지에서
            제외됩니다.
          </p>
        </ConfirmDialog>
      )}
      {dialog?.kind === "finalize" && (
        <ConfirmDialog
          title="현재 취합안을 확정할까요?"
          label="확정본 저장"
          onClose={() => setDialog(null)}
          onConfirm={() => command({ type: "finalize", week })}
        >
          <p>
            {week} ~ {shiftDay(week, 6)}의 계획과 공지문을 보관합니다.
          </p>
          {analysis.totalConflicts > 0 && <p className="warning-box">일정 겹침 후보 {analysis.totalConflicts}쌍이 남아 있습니다. 공동 작업 여부와 시간을 확인해 주세요. 확정해도 자동 해소되지는 않습니다.</p>}
          {missing.length > 0 && (
            <p className="warning-box">
              미제출 {missing.length}명이 있습니다. 공지문에도 표시됩니다.
            </p>
          )}
          <p className="muted">
            이 작업은 저장만 합니다. 카카오톡에는 발송하지 않습니다.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: false };
  }
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="load-error">
        <h1>초안을 표시하지 못했습니다</h1>
        <p>
          저장된 데이터는 지우지 않았습니다. 새로 열거나 검토를 요청해 주세요.
        </p>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
