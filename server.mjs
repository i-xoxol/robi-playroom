import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store, PREFIX, MODELS, INTERESTS, passwordMatches } from './lib/core.mjs';
import { VoiceService } from './lib/realtime.mjs';
import { trustedMutation, forwardedOverHttp } from './lib/request-security.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 8093), host = process.env.HOST || '127.0.0.1';
const publicOrigin = process.env.PUBLIC_ORIGIN || 'https://robot.example.com';
const development = process.env.NODE_ENV === 'development';
const passHash = process.env.ROBOT_PASSWORD_HASH;
if (!passHash) throw new Error('ROBOT_PASSWORD_HASH is required');
const store = new Store(process.env.ROBOT_DB || resolve(root, 'data/robot.db'));
store.recoverReservations();
const streams = new Map(), adultTests = new Map();
function emit(owner, event) { for (const res of streams.get(owner) || []) if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); }
const voice = new VoiceService({ store, key: process.env.OPENAI_API_KEY || '', childApproved: process.env.CHILD_VOICE_ZDR_APPROVED === 'true', parentAuthorized: process.env.CHILD_VOICE_PARENT_AUTHORIZED === 'true', emit });

const commonHeaders = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY',
  'permissions-policy': 'microphone=(self), camera=(), geolocation=()', 'cache-control': 'no-store',
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' https://api.openai.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};
// Safari can fetch install metadata without the login cookie. Only these public,
// non-personal assets bypass authentication; game code and API routes do not.
const installAssets = new Map([
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ...['apple-touch-icon-152','apple-touch-icon-167','apple-touch-icon-180','icon-192','icon-512'].map(name => [`/icons/${name}.png`, [`icons/${name}.png`, 'image/png']]),
]);
function reply(res, status, body, type = 'application/json; charset=utf-8', headers = {}) { res.writeHead(status, { ...commonHeaders, 'content-type': type, ...headers }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body); }
function cookie(token, expire = false) { return `robot_session=${expire ? '' : token}; Path=${PREFIX}/; HttpOnly; ${development ? '' : 'Secure; '}SameSite=Strict; Max-Age=${expire ? 0 : 30 * 86400}`; }
async function readBody(req, limit = 26000) {
  const parts = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('body_too_large'); parts.push(chunk); }
  return Buffer.concat(parts).toString('utf8');
}
function state(session) {
  return { csrf: session.csrf, model: store.get('model'), budget: store.budget(), progress: store.progress(), interests: store.interests(), interestLabels: INTERESTS,
    talkMode: store.get('talkMode'), interestsEnabled: store.get('interestsEnabled'), parentUnlocked: store.parent(session),
    voice: { configured: !!voice.key, enabled: store.get('voiceEnabled'), childApproved: voice.childApproved, zdrApproved: voice.childApproved, parentAuthorized: voice.parentAuthorized, childVoiceEnabled: voice.childVoiceEnabled(),
      adultTest: (adultTests.get(session.hash) || 0) > Date.now() && store.parent(session), active: voice.active?.owner === session.hash } };
}
const errors = { session_busy: 'Робі вже розмовляє на іншому пристрої.', budget_exhausted: 'На цей місяць розмови завершено. Пограймо!', voice_unavailable: 'Голос ще не налаштовано.', child_voice_not_approved: 'Голос дитини ще недоступний. Дорослий може відкрити тест у налаштуваннях.', response_busy: 'Зачекай, я ще думаю.', session_missing: 'Натисни кнопку, щоб з’єднатися знову.', not_recording: 'Натисни кнопку ще раз.' };

const server = http.createServer(async (req, res) => {
  try {
    const expectedHost = new URL(publicOrigin).host;
    if (![expectedHost, `127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host || '')) return reply(res, 403, { error: 'Forbidden host' });
    const url = new URL(req.url, publicOrigin), path = decodeURIComponent(url.pathname);
    if (path === PREFIX) return reply(res, 308, '', 'text/plain', { location: `${PREFIX}/` });
    if (!path.startsWith(`${PREFIX}/`) || path.includes('\0') || path.includes('\\') || path.split('/').some(x => x.startsWith('.'))) return reply(res, 404, { error: 'Not found' });
    const relative = path.slice(PREFIX.length), token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('robot_session='))?.slice(14);
    if (!development && publicOrigin.startsWith('https://') && forwardedOverHttp(req.headers)) {
      const location = `${publicOrigin}${url.pathname}${url.search}`;
      if (['GET','HEAD'].includes(req.method)) return reply(res,308,'','text/plain; charset=utf-8',{ location });
      return reply(res,403,{error:'Відкрийте майстерню через HTTPS та спробуйте ще раз.',code:'https_required',location});
    }
    const session = store.session(token);
    const mutation = !['GET', 'HEAD'].includes(req.method);
    const allowedOrigins = [publicOrigin, ...(development ? [`http://127.0.0.1:${port}`,`http://localhost:${port}`] : [])];
    const originOkay = !mutation || trustedMutation({headers:req.headers,allowedOrigins,csrfValid:!!session && req.headers['x-csrf-token'] === session.csrf,login:relative === '/api/login'});
    if (!originOkay) {
      console.warn('Request source rejected', { path:relative, origin:req.headers.origin === 'null' ? 'opaque' : req.headers.origin ? 'present' : 'absent', referer:req.headers.referer ? 'present' : 'absent' });
      return reply(res,403,{error:'Оновіть сторінку майстерні та спробуйте ще раз.',code:'origin_check_failed'});
    }
    if (relative === '/api/login' && req.method === 'POST') {
      const peer = req.socket.remoteAddress || 'local';
      if (!store.throttle(peer)) return reply(res, 429, { error: 'Забагато спроб. Спробуйте через 15 хвилин.' });
      const data = JSON.parse(await readBody(req, 2000));
      if (!passwordMatches(data.password, passHash)) { store.throttle(peer, true); return reply(res, 401, { error: 'Перевірте пароль.' }); }
      const auth = store.createSession(); return reply(res, 200, { ok: true }, undefined, { 'set-cookie': cookie(auth.token) });
    }
    if (['GET', 'HEAD'].includes(req.method) && installAssets.has(relative)) {
      const [file,type] = installAssets.get(relative), body = await readFile(resolve(root,'public',file));
      return reply(res,200,req.method === 'HEAD' ? '' : body,type,{'content-length':body.length,'cache-control':relative.endsWith('.webmanifest') ? 'no-cache' : 'public, max-age=86400'});
    }
    // The login page, install metadata and icons are public. Game code and paid routes require the cookie.
    if (!session) {
      if (relative === '/login.css' && ['GET', 'HEAD'].includes(req.method)) return reply(res, 200, await readFile(resolve(root, 'public/style.css')), 'text/css; charset=utf-8');
      if (relative === '/login.js' && ['GET', 'HEAD'].includes(req.method)) return reply(res, 200, await readFile(resolve(root, 'public/login.js')), 'text/javascript; charset=utf-8');
      if (relative === '/' && ['GET', 'HEAD'].includes(req.method)) return reply(res, 200, await readFile(resolve(root, 'public/login.html')), 'text/html; charset=utf-8');
      return reply(res, 401, { error: 'Потрібен пароль.', login: `${PREFIX}/` });
    }
    if (mutation && req.headers['x-csrf-token'] !== session.csrf) return reply(res, 403, { error: 'Invalid CSRF token' });
    if (relative === '/api/state' && req.method === 'GET') return reply(res, 200, state(session));
    if (relative === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { ...commonHeaders, 'content-type': 'text/event-stream', connection: 'keep-alive', 'x-accel-buffering': 'no' }); res.write(': ready\n\n');
      const set = streams.get(session.hash) || new Set(); set.add(res); streams.set(session.hash, set);
      const keep = setInterval(() => {
        if (!store.session(token)) res.end(); else res.write(': keepalive\n\n');
      }, 20000); keep.unref();
      req.on('close', () => { clearInterval(keep); set.delete(res); if (!set.size) streams.delete(session.hash); }); return;
    }
    if (relative === '/api/logout' && req.method === 'POST') { if (voice.active?.owner === session.hash) await voice.stop('logout'); store.logout(session); return reply(res, 200, { ok: true }, undefined, { 'set-cookie': cookie('', true) }); }
    if (relative === '/api/progress' && req.method === 'POST') {
      const data = JSON.parse(await readBody(req, 1000));
      if (!store.recordRound(data.game, data.correct)) return reply(res, 400, { error: 'Invalid game result' }); return reply(res, 200, { progress: store.progress() });
    }
    if (relative === '/api/parent/unlock' && req.method === 'POST') {
      if (!store.throttle('parent')) return reply(res, 429, { error: 'Спробуйте пізніше.' });
      const data = JSON.parse(await readBody(req, 2000));
      if (!passwordMatches(data.password, passHash)) { store.throttle('parent', true); return reply(res, 401, { error: 'Перевірте пароль.' }); }
      store.unlock(session); return reply(res, 200, { ok: true });
    }
    if (relative.startsWith('/api/parent/')) {
      if (!store.parent(session)) return reply(res, 403, { error: 'Введіть пароль дорослого.' });
      if (relative === '/api/parent/settings' && req.method === 'POST') {
        const data = JSON.parse(await readBody(req, 3000));
        if ('model' in data) { if (!MODELS.includes(data.model)) return reply(res, 400, { error: 'Invalid model' }); if (data.model !== store.get('model') && voice.active) await voice.stop('model_changed'); store.set('model', data.model); }
        if ('budget' in data) { if (typeof data.budget !== 'number' || !Number.isFinite(data.budget) || data.budget < 0 || data.budget > 20) return reply(res, 400, { error: 'Budget must be between $0 and $20' }); store.set('budget', data.budget); }
        if (typeof data.voiceEnabled === 'boolean') { store.set('voiceEnabled', data.voiceEnabled); if (!data.voiceEnabled) await voice.stop('disabled'); }
        if (['hold', 'tap'].includes(data.talkMode)) store.set('talkMode', data.talkMode);
        if (typeof data.interestsEnabled === 'boolean') store.set('interestsEnabled', data.interestsEnabled);
        if (Array.isArray(data.interests) && data.interests.length <= 8 && data.interests.every(x => x in INTERESTS)) { store.db.exec('DELETE FROM interests'); for (const id of data.interests) store.addInterest(id); }
        return reply(res, 200, state(session));
      }
      if (relative === '/api/parent/adult-test' && req.method === 'POST') { const data = JSON.parse(await readBody(req,1000)); if (data.enabled === false) { adultTests.delete(session.hash); if (voice.active?.owner === session.hash) await voice.stop('adult_test_ended'); } else adultTests.set(session.hash, Date.now() + 10 * 6e4); return reply(res, 200, state(session)); }
      if (relative === '/api/parent/erase' && req.method === 'POST') { store.eraseLearning(); return reply(res, 200, state(session)); }
      return reply(res, 404, { error: 'Not found' });
    }
    if (relative === '/api/voice' && req.method === 'POST') {
      const data = JSON.parse(await readBody(req));
      const adultTest = (adultTests.get(session.hash) || 0) > Date.now() && store.parent(session);
      return reply(res, 200, await voice.create(session.hash, data.sdp, adultTest));
    }
    if (relative === '/api/voice/interrupt' && req.method === 'POST') { const d = JSON.parse(await readBody(req, 1000)); voice.interrupt(session.hash, d.id); return reply(res, 200, { ok: true }); }
    if (relative === '/api/voice/start' && req.method === 'POST') { const d = JSON.parse(await readBody(req, 1000)); voice.start(session.hash, d.id); return reply(res, 200, { ok: true }); }
    if (relative === '/api/voice/finish' && req.method === 'POST') { const d = JSON.parse(await readBody(req, 1000)); return reply(res, 200, { committed: voice.finish(session.hash, d.id, !!d.cancel) }); }
    if (relative === '/api/voice/stop' && req.method === 'POST') { if (voice.active?.owner === session.hash) await voice.stop('finished'); return reply(res, 200, { ok: true }); }
    if (relative.startsWith('/api/')) return reply(res, 404, { error: 'Not found' });
    if (!['GET', 'HEAD'].includes(req.method)) return reply(res, 405, { error: 'Method not allowed' });
    const pathname = relative === '/' ? '/index.html' : relative;
    const base = await realpath(resolve(root, 'public')), candidate = await realpath(resolve(base, `.${pathname}`)).catch(() => '');
    if (!candidate.startsWith(base + sep) || !(await stat(candidate)).isFile()) return reply(res, 404, { error: 'Not found' });
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
    if (!types[extname(candidate)]) return reply(res, 404, { error: 'Not found' });
    const body = await readFile(candidate); return reply(res, 200, req.method === 'HEAD' ? '' : body, types[extname(candidate)]);
  } catch (error) {
    if (res.headersSent) return res.end();
    const code = error.message;
    if (errors[code]) return reply(res, ['budget_exhausted','session_busy','response_busy'].includes(code) ? 409 : 403, { error: errors[code], code });
    if (error instanceof SyntaxError || code === 'body_too_large' || code === 'invalid_sdp') return reply(res, 400, { error: 'Invalid request' });
    console.error('Robot request failed', { request: randomUUID(), code: /^upstream_/.test(code) ? code : 'internal' });
    return reply(res, 502, { error: 'Не вдалося з’єднатися. Спробуй ще раз.', code: /^upstream_/.test(code) ? code : 'unavailable' });
  }
});
server.requestTimeout = 35000; server.headersTimeout = 15000;
server.listen(port, host, () => console.log(`Robi ready at ${host}:${port}; voice ${voice.childVoiceEnabled() ? 'enabled' : 'locked'}; ZDR ${voice.childApproved ? 'verified' : 'unverified'}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => {
  await voice.stop('shutdown'); for (const set of streams.values()) for (const res of set) res.end(); server.close(() => { store.close(); process.exit(0); }); setTimeout(() => process.exit(0), 10000).unref();
});
