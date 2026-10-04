import test from 'node:test';
import assert from 'node:assert/strict';
let reads=0;
for(const name of ['localStorage','sessionStorage','indexedDB'])Object.defineProperty(globalThis,name,{configurable:true,get(){reads++;throw Error('persistent storage forbidden')}});
globalThis.fetch=()=>{throw Error('network forbidden')};
const store=await import('../src/demo-store.mjs');
test('public demo starts with labeled synthetic examples without storage or network',async()=>{const state=await store.loadState();assert.equal(store.publicDemo,true);assert.equal(state.members.length,4);assert.equal(state.plans.length,2);assert.ok(state.plans.every(p=>p.task.includes('예시')));assert.equal(reads,0);});
test('demo edits exist only inside the module; returned state cannot mutate the store',async()=>{const initial=await store.loadState();initial.members[0].name='outside mutation';assert.notEqual((await store.loadState()).members[0].name,'outside mutation');const next=await store.sendCommand(await store.loadState(),{type:'addMember',name:'메모리 체험'},'demo-add');assert.equal(next.members.length,5);assert.equal((await store.loadState()).members.length,5);const fresh=await import('../src/demo-store.mjs?fresh-page');assert.equal((await fresh.loadState()).members.length,4);assert.equal(reads,0);});
