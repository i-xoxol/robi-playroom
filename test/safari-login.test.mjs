import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {passwordHash} from '../lib/core.mjs';

test('production login supports Safari header variants and redirects HTTP securely',async t=>{
  const dir=mkdtempSync(resolve(tmpdir(),'robi-safari-')),port=18096,base=`http://127.0.0.1:${port}`,prefix='/games/robot-pal',origin='https://robot.example.com';
  const child=spawn(process.execPath,['server.mjs'],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,PORT:String(port),NODE_ENV:'production',PUBLIC_ORIGIN:origin,ROBOT_DB:resolve(dir,'test.db'),ROBOT_PASSWORD_HASH:passwordHash('safari-test'),OPENAI_API_KEY:'',CHILD_VOICE_ZDR_APPROVED:'false',CHILD_VOICE_PARENT_AUTHORIZED:'false'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill();await new Promise(r=>child.once('exit',r));rmSync(dir,{recursive:true,force:true});});
  await new Promise((ready,reject)=>{child.stdout.on('data',d=>{if(String(d).includes('Robi ready'))ready();});child.once('error',reject);setTimeout(()=>reject(new Error('server startup timeout')),10000).unref();});
  const login=headers=>fetch(base+prefix+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{"password":"safari-test"}'});
  let r=await fetch(base+prefix+'/?launch=home',{headers:{'X-Forwarded-Proto':'http'},redirect:'manual'}); assert.equal(r.status,308);assert.equal(r.headers.get('location'),origin+prefix+'/?launch=home');
  r=await login({'X-Forwarded-Proto':'http','X-Robi-Request':'same-origin'});assert.equal(r.status,403);assert.equal((await r.json()).code,'https_required');
  r=await login({});assert.equal(r.status,403);
  r=await login({Origin:'https://attacker.invalid',Referer:origin+prefix+'/','X-Robi-Request':'same-origin'});assert.equal(r.status,403);
  for(const headers of [{Referer:origin+prefix+'/'},{Origin:'null',Referer:origin+prefix+'/'},{'X-Robi-Request':'same-origin'},{Origin:'null','X-Robi-Request':'same-origin'}]) {
    r=await login(headers);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Secure/);assert.equal(r.headers.get('access-control-allow-origin'),null);
  }
  r=await login({'X-Robi-Request':'same-origin'});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
  r=await fetch(base+prefix+'/api/state',{headers:{Cookie:cookie}});const {csrf}=await r.json();
  const authenticated={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf};
  for(const headers of [authenticated,{...authenticated,Origin:'null'}]) {
    r=await fetch(base+prefix+'/api/progress',{method:'POST',headers,body:'{"game":"count","correct":true}'});assert.equal(r.status,200);
  }
  r=await fetch(base+prefix+'/api/progress',{method:'POST',headers:{...authenticated,Origin:'https://attacker.invalid'},body:'{"game":"count","correct":true}'});assert.equal(r.status,403);
  r=await fetch(base+prefix+'/api/login',{method:'OPTIONS',headers:{Origin:'https://attacker.invalid','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-robi-request,content-type'}});assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
});
