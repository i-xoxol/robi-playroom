import WebSocket from 'ws';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadKey } from './key.mjs';
import { Store, usageCost } from '../lib/core.mjs';

const key = loadKey(), model = 'gpt-realtime-2.1-mini';
const root = resolve(import.meta.dirname, '..'), folder = resolve(root, 'public/audio');
await mkdir(folder, { recursive: true });
const store = new Store(resolve(root, 'data/robot.db'));
const phrases = {
  welcome: 'Привіт! Я Робі. Разом пограємо й відкриємо щось нове!',
  count: 'Порахуй зірочки. Скільки їх?',
  correct: 'Так! У тебе вийшло!',
  'try-again': 'Спробуймо ще. Я поруч!',
  finished: 'Ми чудово пограли! Хочеш ще?',
  'safe-fallback': 'Давай краще дослідимо щось добре й безпечне.',
  'clue-apple': 'Росту на дереві. Я кругле, соковите, мене можна з’їсти. Що я?',
  'clue-moon': 'Уночі мене видно в небі. Я буваю круглий або схожий на ріжок. Що я?',
  'clue-turtle': 'Повільно ходжу, а мій міцний будиночок завжди на спині. Хто я?',
  'clue-rocket': 'Лечу дуже високо, аж у космос! На чому летять космонавти?',
  'clue-flower': 'У мене є пелюстки й стебло. Мене поливають, і я росту. Що я?',
  'clue-fish': 'Живу у воді. У мене є плавці й хвіст. Хто я?',
  'picture-moon': 'Сонце освітлює Місяць. Ми бачимо його світлу частину.',
  'picture-plant': 'Рослині потрібні вода, світло й повітря. Коріння допомагає отримувати воду.',
  'picture-rainbow': 'Краплинки води допомагають побачити різні кольори сонячного світла.',
  'picture-space': 'Зірки, планети, супутники — і дуже багато простору.',
  'qa-question': 'Чому листя зелене?',
  'qa-show-moon': 'Покажи мені Місяць.',
  'qa-weather': 'Яка погода завтра в Києві, в Україні?',
  'qa-start-game': 'Пограй зі мною в рахунок.',
  'ukrainian-only': 'Я розумію лише українську. Скажи українською, будь ласка.',
  'qa-english-question': 'Why is the sky blue?',
};
for (const [c,word] of Object.entries({blue:'синій',green:'зелений',pink:'рожевий',yellow:'жовтий'})) for (const [s,shape] of Object.entries({circle:'круг',triangle:'трикутник',square:'квадрат'})) phrases[`match-${c}-${s}`] = `Знайди ${word} ${shape}.`;

function wav(pcm) {
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + pcm.length,4); header.write('WAVEfmt ',8); header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(1,22); header.writeUInt32LE(24000,24); header.writeUInt32LE(48000,28); header.writeUInt16LE(2,32); header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(pcm.length,40); return Buffer.concat([header,pcm]);
}
async function generate(text, language = 'uk') {
  return new Promise((resolveResult,reject) => {
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 12000 });
    const pieces = []; let transcript = '', sent = false;
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('audio_timeout')); }, 45000);
    function fail(message) { clearTimeout(timer); ws.close(); reject(new Error(message)); }
    ws.on('error', () => fail('connection_failed'));
    ws.on('open', () => ws.send(JSON.stringify({ type:'session.update',session:{type:'realtime',output_modalities:['audio'],max_output_tokens:512,audio:{input:{turn_detection:null},output:{voice:'marin',format:{type:'audio/pcm',rate:24000}}},instructions:language === 'en' ? 'Read only the supplied English text verbatim in clear natural English. This is synthetic QA input. No additional words or sound effects.' : 'Ти український оповідач для дітей. Читай тільки наданий український текст дослівно. Говори природною українською, з чіткими наголосами, тепло, спокійно й трохи грайливо. Не додавай вступів, пояснень, музики чи інших звуків.'} })));
    ws.on('message', raw => {
      const e = JSON.parse(raw.toString());
      if (e.type === 'error') return fail(`api_${e.error?.code || 'error'}_${String(e.error?.message || '').slice(0,180)}`);
      if (e.type === 'session.updated' && !sent) { sent = true; ws.send(JSON.stringify({type:'response.create',response:{input:[],instructions:language === 'en' ? `Say exactly this English text, without any introduction or additional words: ${text}` : `Прочитай ДОСЛІВНО лише цей текст українською. Тепло і чітко, для дитини. Не додавай жодних слів: ${text}`,max_output_tokens:512}})); }
      if (e.type === 'response.output_audio.delta') pieces.push(Buffer.from(e.delta,'base64'));
      if (e.type === 'response.output_audio_transcript.delta') transcript += e.delta;
      if (e.type === 'response.done') { clearTimeout(timer); ws.close(); if (e.response.status !== 'completed' || !pieces.length) return reject(new Error('audio_generation_failed')); resolveResult({audio:wav(Buffer.concat(pieces)), transcript, usage:e.response.usage, id:e.response.id}); }
    });
  });
}
let generated = 0, total = 0;
for (const [name,text] of Object.entries(phrases)) {
  if (generated >= Number(process.env.ROBOT_AUDIO_LIMIT || 100)) break;
  const filename = resolve(folder, `${name}.wav`);
  try { await access(filename); continue; } catch {}
  const reserve = `prepare:${name}`;
  if (!store.reserve(reserve,.1)) throw new Error('Audio preparation budget exhausted');
  try {
    const result = await generate(text, name === 'qa-english-question' ? 'en' : 'uk'); await writeFile(filename,result.audio); const cost = usageCost(model,result.usage); store.settle(reserve,result.id,cost,'prepared_audio'); total += cost; generated++;
    console.log(JSON.stringify({name,bytes:result.audio.length,transcript:result.transcript,cost}));
  } catch (e) { store.settle(reserve,reserve,.1,'audio_uncertain'); throw e; }
}
console.log(JSON.stringify({generated,totalCost:total})); store.close();
