// Opt-in paid checks using synthetic text, never a child's speech.
import WebSocket from 'ws';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadKey } from './key.mjs';
import { Store, usageCost } from '../lib/core.mjs';
import { sessionConfig, VoiceService } from '../lib/realtime.mjs';
const key=loadKey(), model='gpt-realtime-2.1-mini', root=resolve(import.meta.dirname,'..'), store=new Store(resolve(root,'data/robot.db'));
const cases=[
  {input:'Яка погода завтра?',expect:(text,f)=>f.length===0&&/міст/i.test(text)},
  {input:'Яка погода завтра в Києві, в Україні?',expect:(text,f)=>f.some(x=>x.name==='get_weather'&&x.args.day==='tomorrow')},
  {input:'Пограй зі мною в рахунок.',expect:(text,f)=>f.length===1&&f[0].name==='start_game'},
  {input:'Покажи мені Місяць.',expect:(text,f)=>f.some(x=>x.name==='show_picture'&&x.args.picture==='moon')},
  {input:'Чому котики муркочуть?',expect:(text,f)=>text.length>20&&!f.some(x=>x.name==='show_picture')},
  {input:'Перевір в інтернеті, які місії НАСА зараз досліджують Марс.',expect:(text,f)=>f.some(x=>x.name==='look_up_fact')},
  {input:'What is the weather tomorrow?',expect:(text,f)=>f.length===0&&/розумію лише українську/i.test(text)},
];
const results=[];
for(const [i,item] of cases.entries()) {
  const reservation=`context-qa:${Date.now()}:${i}`; if(!store.reserve(reservation,.1)) throw new Error('QA budget exhausted');
  const result=await new Promise((done,reject)=>{
    const ws=new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`,{headers:{Authorization:`Bearer ${key}`},handshakeTimeout:10000});
    let text='',sent=false; const timer=setTimeout(()=>{ws.terminate();reject(new Error('timeout'));},30000);
    ws.on('error',()=>{clearTimeout(timer);reject(new Error('connection_failed'));});
    ws.on('open',()=>ws.send(JSON.stringify({type:'session.update',session:{...sessionConfig(model),output_modalities:['text']}})));
    ws.on('message',raw=>{
      const e=JSON.parse(raw.toString()); if(e.type==='error'){clearTimeout(timer);ws.close();reject(new Error(e.error?.code||'api_error'));return;}
      if(e.type==='session.updated'&&!sent){sent=true;ws.send(JSON.stringify({type:'response.create',response:{conversation:'none',input:[{type:'message',role:'user',content:[{type:'input_text',text:item.input}]}],output_modalities:['text'],max_output_tokens:512}}));}
      if(e.type==='response.output_text.delta')text+=e.delta;
      if(e.type==='response.done') {
        clearTimeout(timer);ws.close();store.settle(reservation,e.response.id,usageCost(model,e.response.usage),'context_qa');
        const functions=(e.response.output||[]).filter(x=>x.type==='function_call').map(x=>({name:x.name,args:JSON.parse(x.arguments||'{}')}));
        done({input:item.input,text,functions,passed:item.expect(text,functions)});
      }
    });
  }).catch(error=>{store.settle(reservation,reservation,.1,'context_qa_uncertain');throw error;});
  results.push(result); console.log(JSON.stringify(result));
}
// One actual allowlisted search verifies the Responses integration, not just tool selection.
const service=new VoiceService({store,key});
const search=await service.search({owner:'synthetic-qa'},'Які місії NASA зараз досліджують Марс?');
results.push({input:'Live allowlisted web search',passed:search.sources.length>0&&search.answer.length>30,sources:search.sources});
await mkdir(resolve(root,'qa-output'),{recursive:true});
await writeFile(resolve(root,'qa-output/context-qa.json'),JSON.stringify(results,null,2));store.close();
console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,total:results.length})); if(results.some(r=>!r.passed))process.exitCode=1;
