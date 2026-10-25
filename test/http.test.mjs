import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { passwordHash } from '../lib/core.mjs';

test('HTTP auth, CSRF, parent controls and all paid routes are protected', async t => {
  const dir=mkdtempSync(resolve(tmpdir(),'robi-http-')), port=18095, base=`http://127.0.0.1:${port}`, prefix='/games/robot-pal';
  const child=spawn(process.execPath,['server.mjs'],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,PORT:String(port),NODE_ENV:'development',PUBLIC_ORIGIN:base,ROBOT_DB:resolve(dir,'test.db'),ROBOT_PASSWORD_HASH:passwordHash('http-test'),OPENAI_API_KEY:'',CHILD_VOICE_ZDR_APPROVED:'false'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill(); await new Promise(r=>child.once('exit',r)); rmSync(dir,{recursive:true,force:true});});
  await new Promise((resolveReady,reject)=>{child.stdout.on('data',d=>{if(String(d).includes('Robi ready')) resolveReady();});child.once('error',reject);setTimeout(()=>reject(new Error('server startup timeout')),10000).unref();});
  let r=await fetch(base+prefix+'/'); assert.equal(r.status,200); const login=await r.text(); assert.ok(login.includes('login-form')); assert.ok(login.includes('apple-touch-icon-180.png')); assert.ok(login.includes('apple-mobile-web-app-title'));
  r=await fetch(base+prefix+'/manifest.webmanifest'); assert.equal(r.status,200); assert.match(r.headers.get('content-type'),/manifest\+json/); const manifest=await r.json(); assert.equal(manifest.short_name,'Робі'); assert.equal(manifest.display,'standalone'); assert.equal(manifest.start_url,prefix+'/');
  for (const [name,size] of [['apple-touch-icon-152',152],['apple-touch-icon-167',167],['apple-touch-icon-180',180],['icon-192',192],['icon-512',512]]) {
    r=await fetch(base+prefix+`/icons/${name}.png`); assert.equal(r.status,200); assert.equal(r.headers.get('content-type'),'image/png'); const png=Buffer.from(await r.arrayBuffer()); assert.equal(png.toString('ascii',1,4),'PNG'); assert.equal(png.readUInt32BE(16),size); assert.equal(png.readUInt32BE(20),size); assert.equal(png[25],2);
  }
  for (const path of ['/app.js','/api/state','/audio/welcome.wav','/api/events']) assert.equal((await fetch(base+prefix+path)).status,401);
  r=await fetch(base+prefix+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.invalid'},body:'{"password":"http-test"}'}); assert.equal(r.status,403);
  r=await fetch(base+prefix+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:'{"password":"wrong"}'}); assert.equal(r.status,401);
  r=await fetch(base+prefix+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:'{"password":"http-test"}'}); assert.equal(r.status,200); const cookie=r.headers.get('set-cookie').split(';')[0]; assert.match(r.headers.get('set-cookie'),/HttpOnly/); assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);
  r=await fetch(base+prefix+'/api/state',{headers:{Cookie:cookie}}); const state=await r.json(); assert.equal(state.voice.childApproved,false); assert.equal(state.model,'gpt-realtime-2.1-mini'); assert.equal(state.budget.limit,20);
  const headers={'Content-Type':'application/json',Origin:base,Cookie:cookie,'X-CSRF-Token':state.csrf};
  assert.equal((await fetch(base+prefix+'/api/voice',{method:'POST',headers:{...headers,'X-CSRF-Token':'invalid'},body:'{}'})).status,403);
  assert.equal((await fetch(base+prefix+'/api/voice',{method:'POST',headers,body:'{"sdp":"v=0"}'})).status,403);
  assert.equal((await fetch(base+prefix+'/api/parent/settings',{method:'POST',headers,body:'{"budget":1000}'})).status,400);
  assert.equal((await fetch(base+prefix+'/api/parent/settings',{method:'POST',headers,body:'{"model":"unapproved"}'})).status,400);
  r=await fetch(base+prefix+'/api/progress',{method:'POST',headers,body:'{"game":"count","correct":true}'}); assert.equal(r.status,200); assert.equal((await r.json()).progress[0].correct,1);
  assert.equal((await fetch(base+prefix+'/server.mjs',{headers:{Cookie:cookie}})).status,404);
  assert.equal((await fetch(base+prefix+'/%2eenv',{headers:{Cookie:cookie}})).status,404);
  r=await fetch(base+prefix+'/api/logout',{method:'POST',headers,body:'{}'}); assert.equal(r.status,200);
  assert.equal((await fetch(base+prefix+'/api/state',{headers:{Cookie:cookie}})).status,401);
});
