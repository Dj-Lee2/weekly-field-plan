import React, { useEffect, useRef, useState } from "react";
import {
  X,
  Plus,
  Trash,
  ArrowRight,
  ChatCircleText,
} from "./icons.mjs";
import { publicDemo } from "./store.mjs";
import { parseText } from "../lib/parser.mjs";
import { shiftDay, planIssues } from "../lib/domain.mjs";
export const blankItem = () => ({
  date: null,
  time: "",
  place: "",
  task: "",
  assignees: [],
  notes: "",
  reviewed: false,
});
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  busy = false,
  wide = false,
}) {
  const ref = useRef();
  useEffect(() => {
    ref.current.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="modal-head">
        <div>
          <h2 id="dialog-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          aria-label="닫기"
          disabled={busy}
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function PlanFields({ item, onChange, week, tag = "" }) {
  const update = (k, v) => onChange({ ...item, [k]: v });
  return (
    <div className="form-grid">
      <label>
        작업일
        <input
          aria-label={`${tag}작업일`}
          type="date"
          min={week}
          max={shiftDay(week, 6)}
          value={item.date || ""}
          onChange={(e) => update("date", e.target.value || null)}
        />
      </label>
      <label>
        시간 <span className="optional">선택</span>
        <input
          aria-label={`${tag}시간`}
          value={item.time}
          placeholder="09:00~11:00 · 오전 · 오후"
          maxLength={60}
          onChange={(e) => update("time", e.target.value)}
        />
      </label>
      <label>
        포장
        <input
          aria-label={`${tag}포장`}
          value={item.place}
          placeholder="포장명 또는 위치"
          maxLength={120}
          onChange={(e) => update("place", e.target.value)}
        />
      </label>
      <label>
        담당자
        <input
          aria-label={`${tag}담당자`}
          value={item.assignees.join(", ")}
          placeholder="이름을 쉼표로 구분"
          maxLength={400}
          onChange={(e) => update("assignees", [e.target.value])}
        />
      </label>
      <label className="span-2">
        작업내용
        <input
          aria-label={`${tag}작업내용`}
          value={item.task}
          placeholder="어떤 작업을 하나요?"
          maxLength={300}
          onChange={(e) => update("task", e.target.value)}
        />
      </label>
      <label className="span-2">
        인력·장비·비고 <span className="optional">선택</span>
        <input
          aria-label={`${tag}비고`}
          value={item.notes}
          placeholder="예: 운반차 필요, 비가 오면 일정 협의"
          maxLength={1000}
          onChange={(e) => update("notes", e.target.value)}
        />
      </label>
    </div>
  );
}
const exampleText =
  "다음 주 포장 계획입니다.\n월요일 오전 / 시험포장 A / 제초 / 담당: 예시 연구원 가\n수요일 오후 / 시험포장 B / 토양 시료 채취 / 담당: 예시 연구원 가, 예시 연구원 나 / 비고: 운반차 필요";
export function IntakeDialog({ state, week, onClose, onCommand }) {
  const [sender, setSender] = useState(state.members[0]?.id || "");
  const [text, setText] = useState("");
  const [items, setItems] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("plan");
  function parse() {
    try {
      setError("");
      const p = parseText(text, week);
      setItems(p.items);
      setWarnings(p.warnings || []);
    } catch (e) {
      setError(e.message);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (!sender) throw new Error("제출자를 선택해 주세요.");
      const payload =
        kind === "none"
          ? { type: "noWork", week, memberId: sender }
          : {
              type: "submit",
              week,
              submitterId: sender,
              sourceText: text,
              items: items.map((x) => ({
                ...x,
                assignees: x.assignees
                  .flatMap((v) => v.split(/[,·]/))
                  .map((v) => v.trim())
                  .filter(Boolean),
                reviewed: true,
              })),
            };
      await onCommand(payload);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="계획 입력"
      subtitle={publicDemo ? "예시만 입력해 주세요. 입력 내용은 전송·저장되지 않고 새로고침하면 사라집니다." : `${week} ~ ${shiftDay(week, 6)} · 선택한 주에 저장됩니다.`}
      onClose={onClose}
      busy={busy}
      wide
    >
      <fieldset disabled={busy} className="modal-body">
        <div className="notice-strip">
          <ChatCircleText size={20} />
          <span>
            카카오 미연결 · 메시지를 붙여 넣어 흐름을 확인하는 입력창입니다.
          </span>
        </div>
        {!state.members.length ? (
          <div className="warning-box">
            먼저 ‘취합 대상’에서 제출자를 추가해 주세요.
          </div>
        ) : null}
        <div className="input-controls">
          <label>
            제출자
            <select
              aria-label="제출자"
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              disabled={busy}
            >
              <option value="">제출자 선택</option>
              {state.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented">
            <button
              className={kind === "plan" ? "active" : ""}
              onClick={() => setKind("plan")}
              disabled={busy}
            >
              작업계획
            </button>
            <button
              className={kind === "none" ? "active" : ""}
              onClick={() => setKind("none")}
              disabled={busy}
            >
              작업 없음
            </button>
          </div>
        </div>
        {kind === "none" ? (
          <div className="empty-mini">
            <h3>이번 주 포장 작업이 없습니다</h3>
            <p>
              ‘미제출’이 아닌 ‘작업 없음’으로 취합됩니다.
              <br />
              이미 등록한 작업이 있다면 먼저 취소해 주세요.
            </p>
          </div>
        ) : (
          <>
            <label>
              카톡 계획 원문
              <textarea
                rows={5}
                maxLength={8000}
                value={text}
                disabled={busy}
                onChange={(e) => {
                  setText(e.target.value);
                  setItems(null);
                  setWarnings([]);
                }}
                placeholder={exampleText}
              />
            </label>
            <div className="row between wrap">
              <span className="small muted">
                초안은 규칙 기반 정리입니다. AI 해석은 아직 연결되지 않았습니다.
              </span>
              <div className="row">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setText(exampleText);
                    setItems(null);
                    setWarnings([]);
                  }}
                >
                  예시 문장 넣기
                </button>
                <button
                  className="button secondary"
                  disabled={!text.trim() || busy}
                  onClick={parse}
                >
                  항목으로 정리 <ArrowRight size={17} />
                </button>
              </div>
            </div>
            {warnings.length > 0 && (
              <div className="warning-box">
                {warnings.map((x, i) => (
                  <div key={i}>{x}</div>
                ))}
              </div>
            )}
            {items !== null && (
              <div className="preview-list">
                <div className="row between">
                  <h3>
                    정리 결과 <span className="count-pill">{items.length}</span>
                  </h3>
                  <span className="small muted">수정 후 저장해 주세요</span>
                </div>
                {items.map((item, i) => (
                  <section key={i} className="preview-item">
                    <div className="row between">
                      <b>작업 {i + 1}</b>
                      <button
                        aria-label={`작업 ${i + 1} 제외`}
                        className="icon-button"
                        disabled={busy}
                        onClick={() =>
                          setItems(items.filter((_, j) => j !== i))
                        }
                      >
                        <Trash size={18} />
                      </button>
                    </div>
                    <PlanFields
                      item={item}
                      week={week}
                      tag={`작업 ${i + 1} `}
                      onChange={(v) =>
                        setItems(items.map((x, j) => (j === i ? v : x)))
                      }
                    />
                  </section>
                ))}
              </div>
            )}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setItems([...(items || []), blankItem()])}
            >
              <Plus size={17} /> 작업 직접 추가
            </button>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </fieldset>
      <footer className="modal-footer">
        <p>빈 날짜·포장·담당자는 ‘확인 필요’로 남습니다.</p>
        <button
          className="button primary"
          disabled={busy || !sender || (kind === "plan" && !items?.length)}
          onClick={save}
        >
          {busy
            ? "저장 중…"
            : kind === "none"
              ? "작업 없음으로 제출"
              : "확인한 계획 저장"}
        </button>
      </footer>
    </Modal>
  );
}
export function EditDialog({ plan, onClose, onCommand }) {
  const [item, setItem] = useState({ ...plan, assignees: [...plan.assignees] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const { date, time, place, task, notes } = item;
      await onCommand({
        type: "editPlan",
        id: plan.id,
        patch: {
          date,
          time,
          place,
          task,
          notes,
          assignees: item.assignees
            .flatMap((v) => v.split(/[,·]/))
            .map((v) => v.trim())
            .filter(Boolean),
          reviewed: true,
        },
      });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="작업계획 수정"
      subtitle={publicDemo ? "예시 편집 체험입니다. 변경 이력도 새로고침하면 초기화됩니다." : "수정 전 내용과 제출 원문은 변경 이력에 남습니다."}
      busy={busy}
      onClose={onClose}
    >
      <fieldset disabled={busy} className="modal-body">
        <PlanFields week={plan.week} item={item} onChange={setItem} />
        {planIssues({ ...item, reviewed: true }).length > 0 && (
          <div className="warning-box">
            {planIssues({ ...item, reviewed: true }).join(" · ")}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </fieldset>
      <footer className="modal-footer">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          닫기
        </button>
        <button
          className="button primary"
          disabled={busy || !item.task.trim()}
          onClick={save}
        >
          {busy ? "저장 중…" : "수정 저장"}
        </button>
      </footer>
    </Modal>
  );
}
export function ConfirmDialog({
  title,
  children,
  onClose,
  onConfirm,
  label = "확인",
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <div className="modal-body">
        {children}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="modal-footer">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          돌아가기
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "처리 중…" : label}
        </button>
      </footer>
    </Modal>
  );
}
