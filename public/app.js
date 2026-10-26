const BASE = '/games/robot-pal';
const $ = selector => document.querySelector(selector);
const board = $('#board-content'), feedback = $('#board-feedback'), robotSide = $('#robot-side'), bubble = $('#robot-bubble');
let state, sound = true, narration = null, currentGame = null, question = null, round = 0, roundCorrect = true, locked = false, roundRecorded = false;
let pc = null, dc = null, mic = null, voiceId = null, capture = false, holdIntent = false, connecting = false, disconnecting = false, releasing = false, events = null, toastTimer, nextTimer, gestureTimer;
let captureStart = 0, outputText = '', lastSources = [], preferredVoiceState = 'idle', audioOwner = 'local';
const audioOut = document.createElement('audio'); audioOut.autoplay = true; audioOut.setAttribute('playsinline', ''); document.body.append(audioOut);
function fitViewport() { document.documentElement.style.setProperty('--app-height', `${Math.floor(window.visualViewport?.scale === 1 ? window.visualViewport.height : window.innerHeight)}px`); }
fitViewport(); window.addEventListener('resize', fitViewport); window.visualViewport?.addEventListener('resize', fitViewport);

async function api(path, data, method = data === undefined ? 'GET' : 'POST') {
  const r = await fetch(`${BASE}/api${path}`, { method, mode: 'same-origin', credentials: 'same-origin', headers: { ...(data !== undefined ? { 'Content-Type': 'application/json', 'X-CSRF-Token': state?.csrf || '' } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const value = await r.json();
  if (r.status === 401) { location.reload(); throw new Error('Потрібен пароль.'); }
  if (!r.ok) throw new Error(value.error || 'Спробуй ще раз.'); return value;
}
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
function robotState(value) { preferredVoiceState = value; robotSide.dataset.state = value; }
function gesture(value) { clearTimeout(gestureTimer); robotSide.className = `robot-side gesture-${value}`; gestureTimer = setTimeout(() => { robotSide.className = 'robot-side'; }, 2200); }
function say(name, text = '') {
  audioOwner = 'local'; audioOut.muted = true;
  if (text) bubble.textContent = text;
  if (!sound || capture) return;
  narration?.pause(); narration = new Audio(`${BASE}/audio/${name}.wav`);
  const speaking = narration;
  narration.onplay = () => robotState('speaking'); narration.onended = narration.onerror = () => { if (narration === speaking && !capture) robotState('idle'); };
  narration.play().catch(() => robotState('idle'));
}
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function svg(content, view = '0 0 100 100') { return `<svg viewBox="${view}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${content}</svg>`; }
const art = {
  star: svg('<path d="m50 6 12 28 31 3-23 21 7 32-27-16-27 16 7-32L7 37l31-3Z" fill="#edc56e"/><path d="m50 17 8 20-8 7-13-4Z" fill="#f8db94"/><circle cx="40" cy="51" r="3" fill="#a67e34"/><circle cx="61" cy="51" r="3" fill="#a67e34"/><path d="M44 61q7 6 13-1" fill="none" stroke="#b18b3f" stroke-width="2.5" stroke-linecap="round"/>'),
  apple: svg('<path d="M52 29C17 9 8 45 21 74c11 25 28 10 31 10s22 14 32-11c14-35-2-58-32-44" fill="#df8f7c"/><path d="M51 30q-6-18 5-25" fill="none" stroke="#6c8062" stroke-width="6" stroke-linecap="round"/><path d="M56 20Q80 0 84 14 74 31 56 20" fill="#96b67c"/><path d="M30 37q-12 12-6 27" fill="none" stroke="#f7b5a0" stroke-width="5" stroke-linecap="round"/>'),
  moon: svg('<circle cx="50" cy="50" r="39" fill="#f0d99d"/><circle cx="35" cy="31" r="10" fill="#dcc48c"/><circle cx="68" cy="52" r="13" fill="#e2c98e"/><circle cx="39" cy="70" r="7" fill="#dfc58a"/><circle cx="55" cy="21" r="4" fill="#e1c98c"/><path d="M24 46q-3 7 0 13" stroke="#fff2cb" stroke-width="4" fill="none" stroke-linecap="round"/>'),
  turtle: svg('<ellipse cx="49" cy="56" rx="32" ry="26" fill="#7fa588"/><circle cx="82" cy="54" r="14" fill="#b6c69a"/><ellipse cx="29" cy="82" rx="10" ry="7" fill="#b6c69a"/><ellipse cx="65" cy="82" rx="10" ry="7" fill="#b6c69a"/><path d="m47 34 16 12-6 20H38l-8-19Z" stroke="#527f66" stroke-width="3" fill="#99b591"/><circle cx="86" cy="50" r="2.5" fill="#34584c"/><path d="M86 60q4 2 6-1" stroke="#6f946f" fill="none" stroke-width="2"/>'),
  rocket: svg('<path d="M42 68 33 91l17-8 17 8-9-23" fill="#efc06e"/><path d="M36 52Q12 61 18 79l22-8m24-19q24 9 18 27l-22-8" fill="#db9b83"/><path d="M50 5C29 22 30 53 38 72h24c8-19 9-50-12-67" fill="#a6c9c7"/><path d="M50 5Q39 14 35 26h30Q61 14 50 5" fill="#6b929c"/><circle cx="50" cy="42" r="12" fill="#f9f2d9"/><circle cx="50" cy="42" r="8" fill="#536f89"/><path d="M43 77q7 22 14 0" fill="#f5dd9b"/>'),
  flower: svg('<path d="M50 57v34M49 78Q22 59 21 77q9 15 28 10M51 70q27-20 28-1-8 15-28 13" stroke="#88a97a" stroke-width="6" fill="#a7bf8e" stroke-linecap="round"/><g fill="#e6b3a4"><circle cx="50" cy="20" r="16"/><circle cx="72" cy="36" r="16"/><circle cx="63" cy="61" r="16"/><circle cx="36" cy="61" r="16"/><circle cx="27" cy="36" r="16"/></g><circle cx="50" cy="41" r="17" fill="#efd08a"/><circle cx="45" cy="39" r="2" fill="#9d884d"/><circle cx="55" cy="39" r="2" fill="#9d884d"/>'),
  fish: svg('<path d="M70 45 94 23v55L70 59" fill="#e1b176"/><ellipse cx="43" cy="50" rx="35" ry="26" fill="#ebc68c"/><path d="M30 27q8-17 21-9l4 8M33 74l13 11 9-12" fill="#dca573"/><circle cx="24" cy="46" r="4" fill="#5f6c5b"/><path d="M14 58q6 5 11 0M48 43q-7 8 0 16" stroke="#c49b69" fill="none" stroke-width="3" stroke-linecap="round"/>'),
};
const colors = { blue: { hex: '#8cb9cf', word: 'синій', female: 'синю', gen: 'синій' }, green: { hex: '#9abb91', word: 'зелений', female: 'зелену' }, pink: { hex: '#dfa493', word: 'рожевий', female: 'рожеву' }, yellow: { hex: '#edcb7f', word: 'жовтий', female: 'жовту' } };
const shapes = { circle: 'круг', triangle: 'трикутник', square: 'квадрат' };
function shapeArt(shape, color) { const fill = colors[color].hex; return svg(shape === 'circle' ? `<circle cx="50" cy="50" r="34" fill="${fill}"/>` : shape === 'triangle' ? `<path d="M50 10 93 85H7Z" fill="${fill}" stroke-linejoin="round"/>` : `<rect x="15" y="15" width="70" height="70" rx="12" fill="${fill}"/>`); }
function shuffle(items) { const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function celebrate() { gesture('celebrate'); const el = $('#confetti'); el.replaceChildren(); for (let i = 0; i < 24; i++) { const bit = document.createElement('i'); bit.style.left = `${Math.random() * 100}%`; bit.style.background = ['#a2c8a9','#edc477','#dda08c','#9abcc3'][i % 4]; bit.style.animationDelay = `${Math.random() * .4}s`; el.append(bit); } setTimeout(() => el.replaceChildren(), 2500); }
function renderStars() { $('#stars-earned span').textContent = String((state?.progress || []).reduce((n, p) => n + p.correct, 0)); }
function home() {
  clearTimeout(nextTimer); currentGame = null; question = null; locked = false; feedback.textContent = '';
  $('.playroom').dataset.scene = 'conversation'; board.replaceChildren();
}
async function navigate(action) {
  if (capture || connecting || disconnecting || releasing) return;
  try {
    narration?.pause();
    if (voiceId) await api('/voice/interrupt', { id: voiceId });
    audioOwner = 'local'; audioOut.muted = true; robotState('idle'); action();
  } catch (e) { toast(e.message); }
}
function gameMenu() {
  home(); $('.playroom').dataset.scene = 'menu'; $('#board-title').textContent = 'ОБЕРИ ГРУ';
  bubble.textContent = 'У що пограємо? Торкнися назви гри.';
  board.innerHTML = '<h2>У що пограємо?</h2><div class="game-menu"><button data-game="count">Порахуймо</button><button data-game="match">Кольори й форми</button><button data-game="clues">Загадки</button></div>';
  board.querySelectorAll('[data-game]').forEach(button => button.addEventListener('click', () => startGame(button.dataset.game)));
}
const clues = [
  { id: 'apple', text: 'Росту на дереві. Я кругле, соковите, мене можна з’їсти. Що я?', name: 'Яблуко' },
  { id: 'moon', text: 'Уночі мене видно в небі. Я буваю круглий або схожий на ріжок. Що я?', name: 'Місяць' },
  { id: 'turtle', text: 'Повільно ходжу, а мій міцний будиночок завжди на спині. Хто я?', name: 'Черепаха' },
  { id: 'rocket', text: 'Лечу дуже високо, аж у космос! На чому летять космонавти?', name: 'Ракета' },
  { id: 'flower', text: 'У мене є пелюстки й стебло. Мене поливають, і я росту. Що я?', name: 'Квітка' },
  { id: 'fish', text: 'Живу у воді. У мене є плавці й хвіст. Хто я?', name: 'Рибка' },
];
function startGame(game, fromVoice = false) {
  if (!['count','match','clues'].includes(game)) return;
  clearTimeout(nextTimer); currentGame = game; round = 0;
  audioOwner = 'local'; audioOut.muted = true; robotState('idle');
  $('.playroom').dataset.scene = 'game'; $('#board-title').textContent = { count: 'РАХУЄМО', match: 'КОЛЬОРИ Й ФОРМИ', clues: 'ЗАГАДКИ' }[game];
  if (!fromVoice) gesture('point'); nextQuestion();
}
function nextQuestion() {
  if (!currentGame) return;
  if (round >= 5) {
    feedback.textContent = ''; board.innerHTML = `<div class="welcome-drawing">${art.star}</div><p class="eyebrow">П’ЯТЬ МАЛЕНЬКИХ ВІДКРИТТІВ</p><h2>Ми чудово пограли!</h2><p>Можемо пограти ще<br>або дослідити щось нове.</p><button class="game-next" id="again">Ще пограємо!</button>`;
    $('#again').addEventListener('click', () => startGame(currentGame)); celebrate(); say('finished', 'Ми чудово пограли! Хочеш ще?'); return;
  }
  round++; locked = false; roundCorrect = true; roundRecorded = false; feedback.textContent = '';
  const progress = `<div class="game-progress" aria-label="Завдання ${round} з 5">${Array.from({ length: 5 }, (_, i) => i < round ? '●' : '○').join(' ')}</div>`;
  if (currentGame === 'count') {
    const number = 1 + Math.floor(Math.random() * 10); question = number;
    const alternatives = shuffle(Array.from({ length: 10 }, (_, i) => i + 1).filter(n => n !== number)).slice(0,2);
    board.innerHTML = `${progress}<p class="eyebrow">РАХУЙМО РАЗОМ</p><h2>Скільки зірочок?</h2><div class="object-grid">${art.star.repeat(number)}</div><div class="answer-row">${shuffle([number, ...alternatives]).map(n => `<button class="answer-button" data-answer="${n}" aria-label="${n}">${n}</button>`).join('')}</div>`;
    say('count', 'Порахуй зірочки. Скільки їх?');
  } else if (currentGame === 'match') {
    const color = shuffle(Object.keys(colors))[0], shape = shuffle(Object.keys(shapes))[0]; question = `${color}-${shape}`;
    const other = shuffle(Object.keys(colors).flatMap(c => Object.keys(shapes).map(s => `${c}-${s}`)).filter(x => x !== question)).slice(0,2);
    board.innerHTML = `${progress}<p class="eyebrow">УВІМКНИ УВАЖНІ ОЧІ</p><h2>Знайди ${colors[color].word} ${shapes[shape]}</h2><p>Торкнися потрібної фігури.</p><div class="answer-row">${shuffle([question, ...other]).map(v => { const [c,s] = v.split('-'); return `<button class="answer-button shape-answer" data-answer="${v}" aria-label="${colors[c].word} ${shapes[s]}">${shapeArt(s,c)}</button>`; }).join('')}</div>`;
    say(`match-${question}`, `Знайди ${colors[color].word} ${shapes[shape]}.`);
  } else {
    const clue = shuffle(clues)[0]; question = clue.id;
    const options = shuffle([clue, ...shuffle(clues.filter(c => c.id !== clue.id)).slice(0,2)]);
    board.innerHTML = `${progress}<p class="eyebrow">ЗАГАДКА ВІД РОБІ</p><h2>Хто це? Що це?</h2><p class="clue-question">${clue.text}</p><div class="answer-row">${options.map(c => `<button class="answer-button clue-answer" data-answer="${c.id}" aria-label="${c.name}">${art[c.id]}<span>${c.name}</span></button>`).join('')}</div>`;
    say(`clue-${clue.id}`, clue.text);
  }
  board.querySelectorAll('[data-answer]').forEach(button => button.addEventListener('click', () => answer(button)));
}
async function answer(button) {
  if (locked) return;
  const correct = button.dataset.answer === String(question);
  if (!correct) { roundCorrect = false; button.classList.add('wrong'); button.disabled = true; feedback.textContent = 'Спробуймо ще. Я поруч!'; say('try-again', 'Спробуймо ще. Я поруч!'); return; }
  locked = true; button.classList.add('correct'); feedback.textContent = 'Так! Маленьке відкриття зроблено ✦'; gesture('celebrate'); say('correct', 'Так! У тебе вийшло!');
  if (!roundRecorded) {
    roundRecorded = true;
    try { const result = await api('/progress', { game: currentGame, correct: roundCorrect }); state.progress = result.progress; renderStars(); } catch { toast('Результат не зберігся. Можна грати далі.'); }
  }
  const next = document.createElement('button'); next.className = 'game-next'; next.textContent = round === 5 ? 'Подивимось, як пограли' : 'Наступне відкриття →'; next.addEventListener('click', nextQuestion); board.append(next);
}
const pictures = {
  moon: { title: 'Місяць позичає світло в Сонця', text: 'Сонце освітлює Місяць. Ми бачимо його світлу частину.', content: '<rect width="320" height="160" rx="25" fill="#e8ede4"/><circle cx="57" cy="78" r="28" fill="#ecc77a"/><path d="M105 59h87m-87 20h87m-87 20h87" stroke="#dfc991" stroke-width="3" stroke-dasharray="6 5"/><circle cx="242" cy="79" r="40" fill="#b9c6c3"/><path d="M242 39a40 40 0 0 0 0 80Z" fill="#f2dba5"/><circle cx="226" cy="64" r="8" fill="#e0c68b"/>' },
  space: { title: 'У космосі стільки цікавого!', text: 'Зірки, планети, супутники — і дуже багато простору.', content: '<rect width="320" height="160" rx="25" fill="#2b485c"/><circle cx="65" cy="78" r="31" fill="#a7c5ac"/><path d="M44 64q20-12 27 3t16 3M44 91q13-11 19 0t19 3" fill="none" stroke="#d9e4bd" stroke-width="8"/><circle cx="239" cy="49" r="24" fill="#ddbb91"/><ellipse cx="239" cy="49" rx="41" ry="10" transform="rotate(-25 239 49)" fill="none" stroke="#e4d2ad" stroke-width="5"/><g fill="#e5deb6"><circle cx="130" cy="32" r="2"/><circle cx="170" cy="100" r="3"/><circle cx="278" cy="116" r="2"/><circle cx="115" cy="130" r="2"/></g><path d="m171 43 3 8 9 1-7 6 2 9-7-5-8 4 2-8-6-6 9-1Z" fill="#e5deb6"/>' },
  rainbow: { title: 'Сонце, краплинки — веселка!', text: 'Краплинки води допомагають побачити різні кольори сонячного світла.', content: '<rect width="320" height="160" rx="25" fill="#e8f0e6"/><g fill="none" stroke-width="12"><path d="M70 140a90 90 0 0 1 180 0" stroke="#dfa190"/><path d="M83 140a77 77 0 0 1 154 0" stroke="#edbc81"/><path d="M96 140a64 64 0 0 1 128 0" stroke="#e9d493"/><path d="M109 140a51 51 0 0 1 102 0" stroke="#afc49c"/><path d="M122 140a38 38 0 0 1 76 0" stroke="#99c1c8"/></g><g fill="#fffdf5"><ellipse cx="71" cy="140" rx="35" ry="14"/><ellipse cx="246" cy="140" rx="35" ry="14"/></g>' },
  plant: { title: 'Маленьке зернятко росте', text: 'Рослині потрібні вода, світло й повітря. Коріння допомагає отримувати воду.', content: '<rect width="320" height="160" rx="25" fill="#edf0e1"/><path d="M0 127h320v33H0Z" fill="#c5b9a0"/><circle cx="47" cy="126" r="6" fill="#8c7c5b"/><path d="M106 127V98q-17-21-22-9 1 13 22 18m0-3q15-23 20-12 0 12-20 18" stroke="#86a07c" stroke-width="4" fill="#a8bd92"/><path d="M182 127V62q-32-26-35-7 4 19 35 17m0-1q33-29 37-9-4 17-37 20" stroke="#7d9e78" stroke-width="5" fill="#a8c08e"/><path d="M273 127V31q-35-24-40-5 3 21 40 16m0 25q36-32 39-12-3 21-39 23m0 18q-36-27-38-8 4 18 38 18" stroke="#749570" stroke-width="5" fill="#9db886"/>' },
  animals: { title: 'У кожного свій дивовижний світ', text: 'Хтось плаває, хтось літає, хтось носить будиночок на спині.', content: '' },
  shapes: { title: 'Форми ховаються всюди', text: 'Круг, трикутник, квадрат. На що вони схожі у твоїй кімнаті?', content: '<rect width="320" height="160" rx="25" fill="#eef0e3"/><circle cx="60" cy="80" r="34" fill="#8cb9cf"/><path d="m160 42 41 73h-82Z" fill="#edcb7f"/><rect x="226" y="47" width="67" height="67" rx="11" fill="#dfa493"/>' },
};
function showPicture(id) {
  if (!pictures[id]) return; currentGame = null; feedback.textContent = '';
  $('.playroom').dataset.scene = 'picture';
  const title = { moon: 'Місяць і сонячне світло', space: 'Космос', rainbow: 'Веселка', plant: 'Як росте рослина', animals: 'Рибка й черепаха', shapes: 'Круг, трикутник, квадрат' }[id];
  $('#board-title').textContent = 'ДИВИМОСЯ РАЗОМ';
  const p = pictures[id]; board.innerHTML = `<div class="picture-large">${id === 'animals' ? `<div class="object-grid">${art.fish}${art.turtle}</div>` : svg(p.content, '0 0 320 160')}</div><h2>${title}</h2>`;
  gesture('point');
}
function showWeather(f) {
  if (f.status !== 'ok') return;
  home(); $('.playroom').dataset.scene = 'weather'; $('#board-title').textContent = 'ПРОГНОЗ ПОГОДИ';
  const icon = { sun: '☀', 'partly-cloudy': '⛅', cloud: '☁', fog: '≋', rain: '🌧', snow: '❄', storm: '⛈' }[f.condition.icon] || '☁';
  const date = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${f.date}T12:00:00Z`));
  board.innerHTML = `<p class="eyebrow">${f.day === 'tomorrow' ? 'ЗАВТРА' : 'СЬОГОДНІ'} · ${escapeHTML(date)}</p><h2>${escapeHTML(f.city)}</h2><p class="weather-region">${escapeHTML(f.region)} · ${escapeHTML(f.country)}</p><div class="weather-icon" aria-hidden="true">${icon}</div><h2>${escapeHTML(f.condition.text)}</h2><div class="weather-temperature">${escapeHTML(f.high)}°C <small>вдень</small></div><p>Уночі ${escapeHTML(f.low)}°C${f.rainChance === null ? '' : ` · Опади ${escapeHTML(f.rainChance)}%`}</p><p class="weather-source">Open-Meteo · Прогноз може змінитися</p>`;
}
function voiceAllowed() { return state?.voice.configured && state.voice.enabled && (state.voice.childVoiceEnabled || state.voice.adultTest) && sound; }
function updateVoiceUI() {
  const allowed = voiceAllowed(); $('#talk-button').classList.toggle('listening', capture); $('#voice-dot').classList.toggle('online', !!voiceId); $('#disconnect-button').hidden = !voiceId;
  $('#talk-button').disabled = disconnecting;
  $('#talk-label').textContent = disconnecting ? 'Завершуємо…' : connecting ? 'З’єднуємося…' : capture ? (state.talkMode === 'tap' ? 'Я сказав!' : 'Я слухаю…') : voiceId ? (state.talkMode === 'tap' ? 'Почати говорити' : 'Тримай і говори') : 'Поговорити';
  $('#voice-status').textContent = capture ? 'Я уважно слухаю' : connecting ? 'Зараз будемо на зв’язку' : voiceId ? 'Ми на зв’язку!' : 'Є цікаве запитання?';
  $('#voice-help').textContent = !sound ? 'Увімкни звук, щоб розмовляти.' : !allowed ? 'Поки що пограймо! Голос увімкне дорослий.' : state.voice.adultTest && !state.voice.childVoiceEnabled ? 'Тест дорослого · лише синтетичні або дорослі запитання' : !voiceId ? 'Натисни, щоб покликати Робі.' : state.talkMode === 'tap' ? 'Натисни, скажи, натисни ще раз.' : 'Тримай кнопку. Скажи. Відпусти.';
  $('#talk-button').setAttribute('aria-pressed', String(capture));
}
async function connectVoice() {
  if (connecting || disconnecting || voiceId) return;
  if (!voiceAllowed()) { toast(sound ? 'Розмову може увімкнути дорослий у налаштуваннях.' : 'Спочатку увімкни звук.'); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) { toast('Цей браузер не підтримує голос. Спробуй Safari на оновленому iPad.'); return; }
  connecting = true; updateVoiceUI(); narration?.pause(); home(); robotState('idle'); audioOwner = 'remote'; audioOut.muted = false;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    mic.getAudioTracks().forEach(t => { t.enabled = false; });
    pc = new RTCPeerConnection(); pc.ontrack = e => { audioOut.srcObject = e.streams[0]; audioOut.play().catch(() => toast('Натисни «Поговорити», щоб увімкнути звук.')); };
    pc.onconnectionstatechange = () => { if (pc && ['failed','disconnected','closed'].includes(pc.connectionState)) disconnectVoice(); };
    mic.getAudioTracks().forEach(t => pc.addTrack(t, mic));
    dc = pc.createDataChannel('oai-events'); dc.onmessage = handleVoiceEvent;
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const result = await api('/voice', { sdp: offer.sdp }); voiceId = result.id;
    await pc.setRemoteDescription({ type: 'answer', sdp: result.sdp });
    bubble.textContent = 'Я тут! Натисни кнопку й розкажи, що тебе цікавить.';
    gesture('wave');
  } catch (e) { await disconnectVoice(); toast(e.name === 'NotAllowedError' ? 'Дозволь мікрофон у Safari, щоб розмовляти.' : e.message || 'Не вдалося з’єднатися.'); }
  finally { connecting = false; updateVoiceUI(); }
}
function handleVoiceEvent(message) {
  let e; try { e = JSON.parse(message.data); } catch { return; }
  if (audioOwner !== 'remote' || capture) return;
  if (e.type === 'response.created') { outputText = ''; narration?.pause(); robotState('thinking'); }
  if (e.type === 'response.output_audio_transcript.delta') { outputText += e.delta || ''; bubble.textContent = outputText; }
  if (e.type === 'output_audio_buffer.started') { robotState('speaking'); }
  if (e.type === 'output_audio_buffer.stopped' || e.type === 'output_audio_buffer.cleared') { if (!capture) robotState('idle'); }
}
async function beginCapture() {
  if (capture || connecting || disconnecting || releasing) return;
  if (!voiceId) { await connectVoice(); return; }
  try {
    narration?.pause(); await api('/voice/start', { id: voiceId });
    if (state.talkMode === 'hold' && !holdIntent) { await api('/voice/finish', { id: voiceId, cancel: true }); return; }
    capture = true; captureStart = Date.now(); home(); bubble.textContent = 'Я слухаю. Розкажи українською!'; audioOwner = 'remote'; audioOut.muted = false;
    mic.getAudioTracks().forEach(t => { t.enabled = true; }); robotState('listening'); updateVoiceUI();
  } catch (e) { toast(e.message); }
}
async function finishCapture(cancel = false) {
  if (!capture || releasing) return; releasing = true; capture = false;
  mic?.getAudioTracks().forEach(t => { t.enabled = false; }); updateVoiceUI();
  await new Promise(resolve => setTimeout(resolve, 160)); // Let the final RTP packets reach the input buffer before committing.
  try {
    const r = await api('/voice/finish', { id: voiceId, cancel: cancel || Date.now() - captureStart < 300 });
    robotState(r.committed ? 'thinking' : 'idle'); if (!r.committed) toast('Тримай кнопку, доки говориш.');
  } catch (e) { robotState('idle'); if (!cancel) toast(e.message); }
  releasing = false;
}
async function disconnectVoice(fromServer = false) {
  if (disconnecting) return; disconnecting = true;
  const hadSession = voiceId; voiceId = null; capture = false; releasing = false;
  mic?.getTracks().forEach(t => t.stop()); mic = null;
  if (pc) { pc.onconnectionstatechange = null; pc.close(); pc = null; }
  dc = null; audioOut.pause(); audioOut.srcObject = null; robotState('idle'); updateVoiceUI();
  if (hadSession && !fromServer) await api('/voice/stop', {}).catch(() => {});
  disconnecting = false; updateVoiceUI();
}
function subscribeEvents() {
  events = new EventSource(`${BASE}/api/events`);
  events.onmessage = ({ data }) => {
    let e; try { e = JSON.parse(data); } catch { return; }
    if (e.type === 'game') startGame(e.game, true);
    if (e.type === 'picture') showPicture(e.picture);
    if (e.type === 'weather') showWeather(e.forecast);
    if (e.type === 'gesture') gesture(e.gesture);
    if (e.type === 'usage') state.budget = e.budget;
    if (e.type === 'searching') { robotState('thinking'); bubble.textContent = 'Зараз пошукаю надійну відповідь…'; }
    if (e.type === 'sources') lastSources = e.sources;
    if (e.type === 'empty_audio') { robotState('idle'); toast('Не розчув. Скажи ще раз, будь ласка.'); }
    if (e.type === 'ukrainian_redirect') { robotState('idle'); say('ukrainian-only', 'Я розумію лише українську. Скажи українською, будь ласка.'); }
    if (e.type === 'capture_timeout') { capture = false; mic?.getAudioTracks().forEach(t => { t.enabled = false; }); updateVoiceUI(); robotState('idle'); toast('Зробімо паузу. Натисни ще раз, коли будеш готовий.'); }
  if (e.type === 'safe_fallback') { disconnectVoice(); say('safe-fallback', 'Давай краще дослідимо щось добре й безпечне.'); }
    if (e.type === 'voice_closed' && (!e.id || e.id === voiceId)) { disconnectVoice(true); if (['budget_exhausted','budget_or_disabled'].includes(e.reason)) toast('На сьогодні розмови завершено. Пограймо!'); }
    if (e.type === 'voice_error') toast('Робі не розчув. Спробуй ще раз.');
  };
}
const money = n => Number(n || 0).toFixed(2);
async function openParents() {
  try { state = await api('/state'); } catch (e) { toast(e.message); return; }
  renderParents(); const dialog = $('#parent-dialog'); if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open','');
}
function parentVoiceNotice() {
  if (state.voice.zdrApproved) return '<strong>Live voice is enabled.</strong> The server is configured with verified Zero Data Retention approval.';
  if (state.voice.parentAuthorized) return '<strong>Live voice enabled by parent.</strong> OpenAI Zero Data Retention has not been verified. OpenAI guidance calls for ZDR before processing under-13 personal data. Audio is sent to OpenAI during talk turns. <a href="https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance" target="_blank" rel="noopener noreferrer">Provider guidance</a>.';
  return '<strong>Child voice is locked.</strong> Zero Data Retention has not been verified and live child voice has not been authorized on this server. Adult voice testing is available below.';
}
async function loadParentMemory() {
  const target=$('#family-memory');if(!target)return;
  try{
    const data=await api('/parent/memory');if(!target.isConnected)return;
    target.innerHTML=`<h3>Family context & memory</h3><p>Family facts are private and parent controlled. Robi uses them in conversation; web searches never receive the profile. Weather receives only the city.</p><details><summary>Edit family facts</summary><form id="family-profile-form">${Object.entries(data.fields).map(([key,label])=>`<label for="family-${key}">${escapeHTML(label)}</label><input id="family-${key}" data-profile="${key}" maxlength="120" value="${escapeHTML(data.profile[key]||'')}" autocomplete="off">`).join('')}<button class="primary">Save family facts</button><p id="family-result" role="status"></p></form></details><div class="setting-row"><label for="memory-enabled">Remember useful things between conversations</label><input id="memory-enabled" type="checkbox" ${data.enabled?'checked':''}></div><p>Sol 6.1 · medium reviews short batches in the background. Voice still answers directly. Transcription and supervisor calls use the same app allowance. Full transcripts and recordings are not saved; brief memories are saved on this server. New people need your approval. Recent experiences expire after 30 days.</p><p>Supervisor: ${escapeHTML(data.supervisor.status)} · ${data.memories.length} of 36 memories</p><div class="memory-list">${data.memories.length?data.memories.map(m=>`<article class="memory-card"><p>${escapeHTML(m.text)}</p><small>${escapeHTML(m.category)} · ${m.status==='pending'?'Waiting for parent approval':'Active'} · ${new Date(m.updated).toLocaleDateString()}</small><div>${m.status==='pending'?`<button data-memory-approve="${m.id}">Approve</button>`:''}<button data-memory-delete="${m.id}">Forget</button></div></article>`).join(''):'<p>No learned memories yet. Family facts already work.</p>'}</div><button id="clear-memories" class="danger">Forget all learned memories</button><p>Forgetting learned memories keeps your family facts. You can edit or clear those separately above.</p>`;
    $('#family-profile-form').onsubmit=async e=>{e.preventDefault();try{await api('/parent/profile',{profile:Object.fromEntries([...target.querySelectorAll('[data-profile]')].map(x=>[x.dataset.profile,x.value]))});$('#family-result').textContent='Family facts saved.';}catch(error){$('#family-result').textContent=error.message;}};
    $('#memory-enabled').onchange=async e=>{try{await api('/parent/memory',{enabled:e.target.checked});await loadParentMemory();}catch(error){toast(error.message);e.target.checked=!e.target.checked;}};
    for(const button of target.querySelectorAll('[data-memory-delete],[data-memory-approve]'))button.onclick=async()=>{try{await api('/parent/memory',{id:Number(button.dataset.memoryDelete||button.dataset.memoryApprove),action:button.dataset.memoryApprove?'approve':'delete'});await loadParentMemory();}catch(error){toast(error.message);}};
    $('#clear-memories').onclick=async e=>{if(e.target.dataset.confirm!=='true'){e.target.dataset.confirm='true';e.target.textContent='Confirm — forget all learned memories';return;}try{await api('/parent/memory',{action:'clear'});await loadParentMemory();}catch(error){toast(error.message);}};
  }catch(error){if(target.isConnected)target.textContent='Memory settings could not load. Reopen parent settings to try again.';}
}
function renderParents() {
  const area = $('#parent-content');
  if (!state.parentUnlocked) {
    area.innerHTML = '<p>Введіть сімейний пароль, щоб змінити налаштування.</p><form id="parent-unlock"><label for="parent-password">Пароль дорослого</label><input id="parent-password" type="password" autocomplete="current-password" required><button class="primary">Відкрити налаштування</button><p class="form-error" id="parent-error" role="alert"></p></form>';
    $('#parent-unlock').addEventListener('submit', async e => { e.preventDefault(); try { await api('/parent/unlock', { password: $('#parent-password').value }); state = await api('/state'); renderParents(); } catch (err) { $('#parent-error').textContent = err.message; } }); return;
  }
  const budget = state.budget;
  area.innerHTML = `<div class="budget-number">$${money(budget.spent)} <small>із $${money(budget.limit)} за місяць</small></div><div class="budget-meter"><i style="width:${Math.min(100, budget.limit ? budget.spent / budget.limit * 100 : 0)}%"></i></div><p>Reserved for ongoing calls: $${money(budget.reserved)}. Voice, search, transcription and memory review count toward this app’s allowance.</p><div class="parent-note">${parentVoiceNotice()}<br>API key: ${state.voice.configured ? 'configured on the server' : 'not configured'}.</div><form id="parent-settings"><label for="model">Voice model</label><select id="model"><option value="gpt-realtime-2.1-mini">Realtime 2.1 Mini — default</option><option value="gpt-realtime-2.1">Realtime 2.1 — higher cost</option></select><label for="budget">Monthly app allowance ($0–$20)</label><input id="budget" type="number" min="0" max="20" step="1" value="${budget.limit}"><label for="talk-mode">Talk button</label><select id="talk-mode"><option value="hold">Hold to speak</option><option value="tap">Tap to start / tap to finish</option></select><div class="setting-row"><label for="voice-enabled">Enable paid voice</label><input id="voice-enabled" type="checkbox" ${state.voice.enabled ? 'checked' : ''}></div><div class="setting-row"><label for="interests-enabled">Remember non-sensitive interests</label><input id="interests-enabled" type="checkbox" ${state.interestsEnabled ? 'checked' : ''}></div><h3>Interests</h3><div class="interest-grid">${Object.entries(state.interestLabels).map(([id, label]) => `<label><input type="checkbox" name="interest" value="${id}" ${state.interests.includes(id) ? 'checked' : ''}> ${label}</label>`).join('')}</div><button class="primary">Save settings</button><p id="settings-result" role="status" class="form-error"></p></form><h3>Learning progress</h3><p>${state.progress.length ? state.progress.map(p => `${{count:'Counting',match:'Shapes & colors',clues:'Object clues'}[p.game]}: ${p.correct}/${p.rounds}`).join('<br>') : 'No completed rounds yet.'}</p><div class="parent-actions">${!state.voice.childVoiceEnabled ? '<button id="adult-test" '+(!state.voice.configured ? 'disabled' : '')+'>Start 10-minute adult voice test</button>' : ''}<button id="erase-learning" class="danger">Reset learning, interests & memories</button><button id="logout-button">Sign out this device</button></div><h3>Recent explanation sources</h3>${lastSources.length ? `<ul class="source-list">${lastSources.map(s => `<li><a href="${escapeHTML(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(s.title)}</a></li>`).join('')}</ul>` : '<p>Sources appear here after a factual lookup. They are not saved between sessions.</p>'}<p>Microphone audio is sent directly to OpenAI only while the talk button is active. Voice output streams as it is generated. Recordings and full conversation text are not saved by this app. Parent facts and short learned memories are saved privately and can be managed above. Parent access expires after 10 minutes.</p>`;
  $('#model').value = state.model; $('#talk-mode').value = state.talkMode; if ($('#adult-test')) $('#adult-test').textContent = state.voice.adultTest ? 'End adult voice test' : 'Start 10-minute adult voice test';
  $('#parent-settings').addEventListener('submit', async e => {
    e.preventDefault(); try { state = await api('/parent/settings', { model: $('#model').value, budget: Number($('#budget').value), talkMode: $('#talk-mode').value, voiceEnabled: $('#voice-enabled').checked, interestsEnabled: $('#interests-enabled').checked, interests: [...area.querySelectorAll('[name=interest]:checked')].map(x => x.value) }); $('#settings-result').textContent = 'Saved.'; updateVoiceUI(); } catch (err) { $('#settings-result').textContent = err.message; }
  });
  $('#adult-test')?.addEventListener('click', async () => { try { const enabled = !state.voice.adultTest; state = await api('/parent/adult-test', { enabled }); updateVoiceUI(); $('#parent-dialog').close(); toast(enabled ? 'Adult voice test enabled for 10 minutes. Use adult speech only.' : 'Adult voice test ended.'); } catch (e) { toast(e.message); } });
  $('#erase-learning').addEventListener('click', async () => {
    // The second click is a deliberate confirmation inside the already unlocked parent panel.
    const button = $('#erase-learning');
    if (button.dataset.confirm !== 'true') { button.dataset.confirm = 'true'; button.textContent = 'Confirm reset — click again'; return; }
    try { state = await api('/parent/erase', {}); renderStars(); renderParents(); toast('Learning progress, interests and learned memories reset. Family facts are kept.'); } catch (e) { toast(e.message); }
  });
  $('#logout-button').addEventListener('click', async () => { await disconnectVoice(); await api('/logout', {}); location.reload(); });
  const memories=document.createElement('section');memories.id='family-memory';memories.textContent='Loading family memory…';area.insertBefore(memories,$('#parent-settings'));void loadParentMemory();
}

$('#welcome-button').addEventListener('click', () => { $('#welcome-overlay').hidden = true; window.scrollTo(0,0); gesture('wave'); say('welcome', 'Привіт! Я Робі. Разом пограємо й відкриємо щось нове!'); });
$('#games-button').addEventListener('click', () => navigate(gameMenu));
$('#home-button').addEventListener('click', () => navigate(() => { home(); bubble.textContent = 'Я тут! Що тебе цікавить?'; }));
$('#sound-button').addEventListener('click', () => { sound = !sound; $('#sound-button').textContent = sound ? '♪' : '♫'; $('#sound-button').setAttribute('aria-pressed', String(sound)); $('#sound-button').setAttribute('aria-label', sound ? 'Вимкнути звук' : 'Увімкнути звук'); if (!sound) { narration?.pause(); disconnectVoice(); } updateVoiceUI(); });
$('#parent-button').addEventListener('click', openParents); $('#close-parent').addEventListener('click', () => $('#parent-dialog').close()); $('#disconnect-button').addEventListener('click', () => disconnectVoice());
const talkButton = $('#talk-button');
talkButton.addEventListener('pointerdown', e => {
  e.preventDefault(); if (state?.talkMode === 'tap') return; holdIntent = true; talkButton.setPointerCapture?.(e.pointerId); beginCapture();
});
talkButton.addEventListener('pointerup', () => { holdIntent = false; if (state?.talkMode !== 'tap') finishCapture(); });
talkButton.addEventListener('pointercancel', () => { holdIntent = false; finishCapture(true); });
talkButton.addEventListener('lostpointercapture', () => { if (state?.talkMode !== 'tap') { holdIntent = false; if (capture) finishCapture(true); } });
talkButton.addEventListener('click', () => { if (state?.talkMode === 'tap') capture ? finishCapture() : beginCapture(); });
talkButton.addEventListener('keydown', e => { if ([' ', 'Enter'].includes(e.key) && !e.repeat) { e.preventDefault(); if (state?.talkMode === 'tap') capture ? finishCapture() : beginCapture(); else { holdIntent = true; beginCapture(); } } });
talkButton.addEventListener('keyup', e => { if ([' ', 'Enter'].includes(e.key) && state?.talkMode !== 'tap') { e.preventDefault(); holdIntent = false; finishCapture(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) { holdIntent = false; narration?.pause(); disconnectVoice(); } });
const rotation = window.matchMedia('(orientation: portrait)');
const rotated = e => { if (e.matches) { holdIntent = false; narration?.pause(); disconnectVoice(); } };
if (rotation.addEventListener) rotation.addEventListener('change', rotated); else rotation.addListener(rotated);
window.addEventListener('pagehide', () => { mic?.getTracks().forEach(t => t.stop()); pc?.close(); if (voiceId && state) fetch(`${BASE}/api/voice/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: '{}', keepalive: true }).catch(() => {}); });
async function boot() {
  try { state = await api('/state'); home(); renderStars(); updateVoiceUI(); subscribeEvents(); } catch (e) { toast(e.message); }
}
boot();
