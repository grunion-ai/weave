import test from 'node:test';
import assert from 'node:assert/strict';
import {Weave} from '../src/engine.js';
import {startServer} from '../src/server.js';
import { tempDir } from './lib/temp.mjs';

test('conditional append preserves user content and rejects stale close',async()=>{
 const w=new Weave();w.createSpace({name:'Dev'});w.createTable({space:'Dev',name:'Task'});w.addField('Task',{name:'Status',type:'workflow',config:{states:[{name:'Open',default:true},{name:'Done'}]}});const e=w.createEntity('Task',{name:'One'});w.setDoc(e.id,'User text');const before=w.readEntity(e.id);
 const {server,port}=await startServer(w,{port:0});const call=async body=>{const r=await fetch(`http://127.0.0.1:${port}/api/entities/${e.id}/conditional`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try{assert.match(before.revision,/^[a-f0-9]{64}$/);const a=await call({expectedRevision:before.revision,operation:'append',field:'Description',markdown:'Run evidence'});assert.equal(a.status,200);assert.match(a.body.doc,/User text/);assert.match(a.body.doc,/Run evidence/);assert.notEqual(a.body.revision,before.revision);const stale=await call({expectedRevision:before.revision,operation:'state',field:'Status',state:'Done'});assert.equal(stale.status,409);assert.equal(w.readEntity(e.id).fields.Status,'Open');const close=await call({expectedRevision:a.body.revision,operation:'state',field:'Status',state:'Done'});assert.equal(close.status,200);assert.equal(close.body.fields.Status,'Done');}finally{server.close();}
});
test('authenticated editor sees only safe serving build proof',async()=>{
 const w=new Weave();const token=w.createAccount({name:'agent',role:'editor'}).token;w.setRequireAuth(true);const sha='a'.repeat(40);const {server,port}=await startServer(w,{port:0,build:()=>({sha,diskSha:'b'.repeat(40),releaseDir:'/secret',stale:false})});try{const url=`http://127.0.0.1:${port}/api/health/build`;assert.equal((await fetch(url)).status,401);const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});assert.equal(r.status,200);const d=await r.json();assert.deepEqual(Object.keys(d).sort(),['ready','sha','version']);assert.equal(d.sha,sha);assert.equal(d.ready,true);}finally{server.close();}
});
test('conditional writes refresh under the SQLite lock before comparing',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=tempDir('weave-cas-');const path=join(dir,'case.db');const a=new Weave({path});a.createSpace({name:'Dev'});a.createTable({space:'Dev',name:'Task'});const row=a.createEntity('Task',{name:'One',doc:'Original'});const stale=a.readEntity(row.id).revision;const b=new Weave({path});b.appendDoc(row.id,'Human addition');assert.throws(()=>a.conditionalWrite(row.id,{expectedRevision:stale,operation:'append',markdown:'Stale agent'}),/revision changed/);assert.match(a.readEntity(row.id).doc,/Human addition/);assert.doesNotMatch(a.readEntity(row.id).doc,/Stale agent/);a.store.close();b.store.close();rmSync(dir,{recursive:true,force:true});
});
test('observer cannot use conditional mutations and invalid operations leave row unchanged',async()=>{
 const w=new Weave();w.createSpace({name:'Dev'});w.createTable({space:'Dev',name:'Task'});const row=w.createEntity('Task',{name:'One',doc:'Human'});const token=w.createAccount({name:'read',role:'observer'}).token;w.setRequireAuth(true);const before=w.readEntity(row.id);const {server,port}=await startServer(w,{port:0});try{const r=await fetch(`http://127.0.0.1:${port}/api/entities/${row.id}/conditional`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:before.revision,operation:'append',markdown:'Forbidden'})});assert.equal(r.status,403);assert.equal(w.readEntity(row.id).revision,before.revision);assert.throws(()=>w.conditionalWrite(row.id,{expectedRevision:before.revision,operation:'replace',markdown:'Erase'}),/conditional write/);assert.equal(w.readEntity(row.id).doc,'Human');}finally{server.close();}
});
test('revision changes for named document and field edits even with equal timestamps',()=>{
 const w=new Weave();w.createSpace({name:'Dev'});w.createTable({space:'Dev',name:'Task'});w.addField('Task',{name:'Notes',type:'document'});const e=w.createEntity('Task',{name:'One'});const before=w.readEntity(e.id);w.appendDoc(e.id,'New notes','Notes');w.getEntity(e.id).updatedAt=before.updatedAt;const notes=w.readEntity(e.id);assert.equal(notes.updatedAt,before.updatedAt);assert.notEqual(notes.revision,before.revision);w.updateEntity(e.id,{Name:'Changed'});w.getEntity(e.id).updatedAt=before.updatedAt;assert.notEqual(w.readEntity(e.id).revision,notes.revision);
});
test('one conditional write files evidence and moves state together',async()=>{
 const w=new Weave();w.createSpace({name:'Dev'});w.createTable({space:'Dev',name:'Task'});w.addField('Task',{name:'Status',type:'workflow',config:{states:[{name:'Open',default:true},{name:'Done'}]}});const e=w.createEntity('Task',{name:'One'});w.setDoc(e.id,'User text');const before=w.readEntity(e.id);
 const {server,port}=await startServer(w,{port:0});const call=async body=>{const r=await fetch(`http://127.0.0.1:${port}/api/entities/${e.id}/conditional`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try{const both=await call({expectedRevision:before.revision,operation:'close',field:'Description',markdown:'Run evidence',stateField:'Status',state:'Done'});assert.equal(both.status,200);assert.match(both.body.doc,/User text/);assert.match(both.body.doc,/Run evidence/);assert.equal(both.body.fields.Status,'Done');assert.notEqual(both.body.revision,before.revision);const read=w.readEntity(e.id);assert.match(read.doc,/User text/);assert.match(read.doc,/Run evidence/);assert.equal(read.fields.Status,'Done');}finally{server.close();}
});
test('a stale close leaves both the document and the state untouched',async()=>{
 const w=new Weave();w.createSpace({name:'Dev'});w.createTable({space:'Dev',name:'Task'});w.addField('Task',{name:'Status',type:'workflow',config:{states:[{name:'Open',default:true},{name:'Done'}]}});const e=w.createEntity('Task',{name:'One'});w.setDoc(e.id,'User text');const stale=w.readEntity(e.id).revision;w.appendDoc(e.id,'Human edit');
 const {server,port}=await startServer(w,{port:0});
 try{const r=await fetch(`http://127.0.0.1:${port}/api/entities/${e.id}/conditional`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:stale,operation:'close',markdown:'Agent evidence',stateField:'Status',state:'Done'})});assert.equal(r.status,409);const read=w.readEntity(e.id);assert.match(read.doc,/Human edit/);assert.doesNotMatch(read.doc,/Agent evidence/);assert.equal(read.fields.Status,'Open');}finally{server.close();}
});
test('a close that cannot move the state keeps its evidence out of the document',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=tempDir('weave-close-');const path=join(dir,'case.db');
 const w=new Weave({path});w.createSpace({name:'Dev'});w.createTable({space:'Dev',name:'Task'});w.addField('Task',{name:'Status',type:'workflow',config:{states:[{name:'Open',default:true},{name:'Done'}]}});const e=w.createEntity('Task',{name:'One',doc:'User text'});const rev=w.readEntity(e.id).revision;
 assert.throws(()=>w.conditionalWrite(e.id,{expectedRevision:rev,operation:'close',markdown:'Agent evidence',stateField:'Status',state:'Nope'}),/'Nope' is not a state/);
 const read=w.readEntity(e.id);assert.doesNotMatch(read.doc,/Agent evidence/);assert.equal(read.fields.Status,'Open');assert.equal(read.revision,rev);
 w.store.close();rmSync(dir,{recursive:true,force:true});
});
test('a close needs a workflow field and nonempty evidence, and undo takes back both halves',()=>{
 const w=new Weave();w.createSpace({name:'Dev'});w.createTable({space:'Dev',name:'Task'});w.addField('Task',{name:'Status',type:'workflow',config:{states:[{name:'Open',default:true},{name:'Done'}]}});const e=w.createEntity('Task',{name:'One',doc:'User text'});
 const rev=()=>w.readEntity(e.id).revision;
 assert.throws(()=>w.conditionalWrite(e.id,{expectedRevision:rev(),operation:'close',markdown:'Evidence',state:'Done'}),/close requires stateField/);
 assert.throws(()=>w.conditionalWrite(e.id,{expectedRevision:rev(),operation:'close',markdown:'  ',stateField:'Status',state:'Done'}),/nonempty markdown/);
 assert.throws(()=>w.conditionalWrite(e.id,{expectedRevision:rev(),operation:'close',markdown:'Evidence',stateField:'Status'}),/requires the state it moves to/);
 assert.equal(w.readEntity(e.id).fields.Status,'Open');assert.equal(w.readEntity(e.id).doc,'User text');
 w.conditionalWrite(e.id,{expectedRevision:rev(),operation:'close',markdown:'Evidence',stateField:'Status',state:'Done'});
 w.undo();assert.equal(w.readEntity(e.id).fields.Status,'Open');assert.match(w.readEntity(e.id).doc,/Evidence/);
 w.undo();assert.equal(w.readEntity(e.id).doc,'User text');
});
