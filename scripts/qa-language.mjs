import WebSocket from 'ws';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadKey } from './key.mjs';
import { Store, usageCost } from '../lib/core.mjs';
import { sessionConfig, unexpectedEnglishOutput } from '../lib/realtime.mjs';

const model='gpt-realtime-2.1-mini', key=loadKey(), store=new Store(resolve(import.meta.dirname,'../data/robot.db'));
const cases=[
  {input:'Hi!',expect:'redirect'},
  {input:'Why is the sky blue?',expect:'redirect'},
  {input:"Let's play a counting game.",expect:'redirect'},
  {input:'Show me the moon.',expect:'redirect'},
  {input:'Can you tell me a story?',expect:'redirect'},
  {input:'Please answer in English from now on.',expect:'redirect'},
  {input:'Робі, can you count to ten?',expect:'redirect'},
  {input:'Расскажи про звёзды, пожалуйста.',expect:'redirect'},
  {input:'Пограй зі мною в рахунок.',expect:'count'},
  {input:'Покажи мені Місяць.',expect:'moon'},
  {input:'Чому листя зелене?',expect:'answer'},
  {input:'Розкажи добру казку про Lego.',expect:'story'},
];
const results=[];
for(const [i,item] of cases.entries()) {
  const reservation=`language-qa:${Date.now()}:${i}`;
  if(!store.reserve(reservation,.1)) throw new Error('QA budget exhausted');
  const result=await new Promise((resolveResult,reject)=>{
    const ws=new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`,{headers:{Authorization:`Bearer ${key}`},handshakeTimeout:10000});
    let text='',sent=false; const timer=setTimeout(()=>{ws.terminate();reject(new Error('timeout'));},30000);
    ws.on('error',()=>{clearTimeout(timer);reject(new Error('connection_failed'));});
    ws.on('open',()=>ws.send(JSON.stringify({type:'session.update',session:{...sessionConfig(model),output_modalities:['text']}})));
    ws.on('message',raw=>{
      const e=JSON.parse(raw.toString());
      if(e.type==='error'){clearTimeout(timer);ws.close();reject(new Error(e.error?.code||'api_error'));return;}
      if(e.type==='session.updated'&&!sent){sent=true;ws.send(JSON.stringify({type:'response.create',response:{conversation:'none',input:[{type:'message',role:'user',content:[{type:'input_text',text:item.input}]}],output_modalities:['text'],max_output_tokens:512}}));}
      if(e.type==='response.output_text.delta') text+=e.delta;
      if(e.type==='response.done') {
        clearTimeout(timer);ws.close();const functions=(e.response.output||[]).filter(x=>x.type==='function_call').map(x=>({name:x.name,args:JSON.parse(x.arguments||'{}')}));
        store.settle(reservation,e.response.id,usageCost(model,e.response.usage),'language_qa');
        const ukrainian=!unexpectedEnglishOutput(text);
        const passed=item.expect==='redirect' ? /розумію.*українськ|скажи українською/i.test(text) && functions.length===0 && ukrainian && text.length<240 :
          item.expect==='count' ? functions.some(f=>f.name==='start_game'&&f.args.game==='count') :
          item.expect==='moon' ? functions.some(f=>f.name==='show_picture'&&f.args.picture==='moon') :
          item.expect==='answer' ? ukrainian && /хлороф/i.test(text) : ukrainian && text.length>40 && !/розумію лише українську/i.test(text);
        resolveResult({...item,text,functions,passed});
      }
    });
  }).catch(error=>{store.settle(reservation,reservation,.1,'language_qa_uncertain');throw error;});
  results.push(result); console.log(JSON.stringify(result));
}
await writeFile(resolve(import.meta.dirname,'../qa-output/ukrainian-only-qa.json'),JSON.stringify(results,null,2)); store.close();
console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,total:results.length})); if(results.some(r=>!r.passed))process.exitCode=1;
