import test from 'node:test';
import assert from 'node:assert/strict';
import { getWeather, weatherCondition } from '../lib/weather.mjs';
const city = { name: 'Київ', admin1: 'Київ', country_code: 'UA', latitude: 50.45, longitude: 30.52, feature_code: 'PPLC' };
test('weather resolves only a city and returns tomorrow in the forecast local timezone', async () => {
  const urls = [], request = async url => {
    urls.push(new URL(url)); return { ok: true, json: async () => urls.length === 1 ? { results: [city] } : { timezone: 'Europe/Kyiv', daily: { time: ['2026-10-25','2026-10-26'], temperature_2m_max: [10,12.3], temperature_2m_min: [3,4.2], precipitation_probability_max: [20,70], weather_code: [0,61] } } };
  };
  const result = await getWeather({ city: 'Київ', country: 'UA', day: 'tomorrow' }, request);
  assert.equal(result.date, '2026-10-26'); assert.equal(result.high,12); assert.equal(result.rainChance,70); assert.equal(result.condition.text,'Дощ');
  assert.equal(urls[1].hostname,'api.open-meteo.com'); assert.equal(urls[1].searchParams.get('timezone'),'auto'); assert.ok(!('latitude' in result));
});
test('ambiguous cities require clarification without requesting a forecast', async () => {
  let requests = 0;
  const result = await getWeather({city:'Rochester',day:'tomorrow'}, async () => { requests++; return {ok:true,json:async()=>({results:[{...city,name:'Rochester',admin1:'New York',country_code:'US'},{...city,name:'Rochester',admin1:'Minnesota',country_code:'US'}]})}; });
  assert.equal(result.status,'ambiguous'); assert.equal(requests,1); assert.equal(result.choices.length,2);
});
test('weather rejects addresses, URLs, coordinates and invalid days before any request', async () => {
  let requests=0; const request=async()=>{requests++;};
  for (const city of ['123 Main Street','https://example.com','50.45,30.52','Моя школа']) await assert.rejects(()=>getWeather({city,day:'tomorrow'},request));
  await assert.rejects(()=>getWeather({city:'Київ',day:'next-month'},request)); assert.equal(requests,0);
});
test('missing temperatures do not become a fabricated zero-degree forecast', async () => {
  let n=0; await assert.rejects(()=>getWeather({city:'Київ',day:'today'},async()=>({ok:true,json:async()=>++n===1?{results:[city]}:{daily:{time:['2026-10-25'],temperature_2m_max:[null],temperature_2m_min:[3],weather_code:[0]}}})),/weather_unavailable/);
  assert.equal(weatherCondition(95).icon,'storm');
});
