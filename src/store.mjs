import { emptyState, applyCommand } from "../lib/domain.mjs";
export const publicDemo = false;
export function subscribeStorage(refresh) {
  const handler = (event) => { if (event.key === "weekly-field-plan-draft-v1") refresh(); };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
const KEY = "weekly-field-plan-draft-v1";
const pendingRequests = new Map();
export const offline =
  globalThis.__OFFLINE_DRAFT__ === true || location.protocol === "file:";
export const storageLabel = offline
  ? "이 브라우저에 저장"
  : "서버에 저장";
export function uid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}
function localRead() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    throw new Error(
      "브라우저 저장소를 사용할 수 없습니다. 다른 브라우저에서 열거나 ZIP의 로컬 서버를 실행해 주세요.",
    );
  }
  if (!raw) return emptyState();
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    throw new Error(
      "저장된 초안이 손상되어 열지 못했습니다. 기존 데이터는 지우지 않았습니다.",
    );
  }
  if (
    state.schemaVersion !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    !["members", "plans", "noWork", "snapshots", "history", "receipts"].every(
      (k) => Array.isArray(state[k]),
    )
  )
    throw new Error(
      "호환되지 않는 초안입니다. 기존 데이터는 지우지 않았습니다.",
    );
  return state;
}
export async function loadState() {
  if (offline) return localRead();
  const response = await fetch("/api/state", { cache: "no-store" });
  if (!response.ok)
    throw new Error(
      "저장 서버에 연결하지 못했습니다. 로그인 상태를 확인하거나 다시 시도해 주세요.",
    );
  const result = await response.json();
  return result.state || result;
}
export async function sendCommand(state, payload, requestId = uid()) {
  const command = { ...payload, requestId, expectedRevision: state.revision };
  if (offline) {
    const current = localRead();
    const next = applyCommand(current, command, {
      now: new Date().toISOString(),
      id: uid(),
    });
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      throw new Error(
        "저장 공간 부족 또는 브라우저 제한으로 저장하지 못했습니다. 기존 데이터는 유지됩니다.",
      );
    }
    return next;
  }
  const key = JSON.stringify(payload);
  const envelope = pendingRequests.get(key) || command;
  pendingRequests.set(key, envelope);
  let response, result;
  try {
    response = await fetch("/api/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
    });
    result = await response.json();
  } catch {
    throw new Error(
      "서버 응답을 받지 못했습니다. 같은 내용으로 다시 저장하면 중복 없이 결과를 확인합니다. 내용을 바꾸기 전 현재 목록을 확인해 주세요.",
    );
  }
  if (!response.ok) {
    if (response.status < 500) pendingRequests.delete(key);
    const e = new Error(
      result.message ||
        result.error?.message ||
        (typeof result.error === "string"
          ? result.error
          : "요청을 저장하지 못했습니다."),
    );
    e.status = response.status;
    throw e;
  }
  pendingRequests.delete(key);
  return result.state;
}
