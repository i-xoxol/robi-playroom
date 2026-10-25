import test from 'node:test';
import assert from 'node:assert/strict';
import {trustedMutation,forwardedOverHttp} from '../lib/request-security.mjs';
const good='https://robot.example.com', allowedOrigins=[good];
const check=(headers,rest={})=>trustedMutation({headers,allowedOrigins,...rest});

test('trusted origins and exact Referer fallback work for Safari',()=>{
  assert.equal(check({origin:good}),true);
  assert.equal(check({referer:good+'/games/robot-pal/'}),true);
  assert.equal(check({origin:'null',referer:good+'/games/robot-pal/'}),true);
  assert.equal(check({origin:'https://attacker.invalid',referer:good+'/'}),false);
  assert.equal(check({referer:good+'.attacker.invalid/'}),false);
  assert.equal(check({referer:'https://robot.example.com@attacker.invalid/'}),false);
  assert.equal(check({referer:'not a URL'}),false);
});
test('missing or opaque origin requires a configured CSRF defense',()=>{
  assert.equal(check({}),false); assert.equal(check({origin:'null'}),false);
  assert.equal(check({}, {csrfValid:true}),true);
  assert.equal(check({origin:'null'}, {csrfValid:true}),true);
  assert.equal(check({origin:'https://attacker.invalid'}, {csrfValid:true}),false);
  assert.equal(check({'sec-fetch-site':'cross-site'}, {csrfValid:true}),false);
});
test('login fallback requires the custom AJAX header plus non-simple JSON',()=>{
  const headers={'content-type':'application/json','x-robi-request':'same-origin'};
  assert.equal(check(headers,{login:true}),true);
  assert.equal(check({...headers,origin:'null'},{login:true}),true);
  assert.equal(check(headers,{login:false}),false);
  assert.equal(check({'content-type':'application/json'},{login:true}),false);
  assert.equal(check({...headers,'content-type':'text/plain'},{login:true}),false);
  assert.equal(check({...headers,origin:'https://attacker.invalid'},{login:true}),false);
  assert.equal(check({...headers,referer:'https://attacker.invalid/'},{login:true}),false);
});
test('only explicit original HTTP transport triggers canonical HTTPS redirect',()=>{
  assert.equal(forwardedOverHttp({'x-forwarded-proto':'http'}),true);
  assert.equal(forwardedOverHttp({'cf-visitor':'{"scheme":"http"}'}),true);
  assert.equal(forwardedOverHttp({'x-forwarded-proto':'https'}),false);
  assert.equal(forwardedOverHttp({}),false);
});
