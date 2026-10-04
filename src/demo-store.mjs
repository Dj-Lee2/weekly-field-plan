// Public demo: deliberately no API, localStorage, cookies or IndexedDB.
import {emptyState,applyCommand,nextWeek} from '../lib/domain.mjs';
export const publicDemo=true;
export function subscribeStorage(){return () => {}; }
export const offline=true;
export const storageLabel='예시 체험 · 새로고침 시 초기화';
export function uid(){return globalThis.crypto.randomUUID();}
let memoryState=applyCommand(emptyState(),{type:'loadExample',week:nextWeek(),requestId:uid(),expectedRevision:0},{now:new Date().toISOString(),id:uid()});
export async function loadState(){return structuredClone(memoryState);}
export async function sendCommand(state,payload,requestId=uid()){
 memoryState=applyCommand(memoryState,{...payload,requestId,expectedRevision:state.revision},{now:new Date().toISOString(),id:uid()});
 return structuredClone(memoryState);
}
