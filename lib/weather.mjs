// City-level forecasts only. Never accept an arbitrary URL, address or coordinates.
export function weatherCondition(code) {
  if (code === 0) return { text: 'Ясно', icon: 'sun' };
  if ([1,2].includes(code)) return { text: 'Мінлива хмарність', icon: 'partly-cloudy' };
  if (code === 3) return { text: 'Хмарно', icon: 'cloud' };
  if ([45,48].includes(code)) return { text: 'Туман', icon: 'fog' };
  if ([51,53,55,56,57].includes(code)) return { text: 'Мряка', icon: 'rain' };
  if ([61,63,65,66,67,80,81,82].includes(code)) return { text: 'Дощ', icon: 'rain' };
  if ([71,73,75,77,85,86].includes(code)) return { text: 'Сніг', icon: 'snow' };
  if ([95,96,99].includes(code)) return { text: 'Можлива гроза', icon: 'storm' };
  return { text: 'Мінлива погода', icon: 'cloud' };
}
const cityName = value => typeof value === 'string' && value.length >= 2 && value.length <= 60 && /^[\p{L}\p{M} .’'ʼ-]+$/u.test(value) && !/адрес|вулиц|street|road|avenue|телефон|phone|школ|school|парол|password/i.test(value);
async function json(url, request) {
  const r = await request(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!r.ok) throw new Error('weather_unavailable');
  return r.json();
}
export async function getWeather({ city, country = '', region = '', day }, request = fetch) {
  if (!cityName(city) || (region && !cityName(region)) || (country && !/^[A-Z]{2}$/.test(country)) || !['today','tomorrow'].includes(day)) throw new Error('invalid_weather_query');
  const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geoUrl.search = new URLSearchParams({ name: city + (region ? `, ${region}` : ''), language: 'uk', count: '5', ...(country ? { countryCode: country } : {}) });
  const geo = await json(geoUrl, request);
  let places = (geo.results || []).filter(p => /^PPL/.test(p.feature_code || ''));
  const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('uk');
  const exact = places.filter(p => normalize(p.name) === normalize(city));
  if (exact.length) places = exact;
  const capitals = places.filter(p => p.feature_code === 'PPLC');
  if (country && capitals.length === 1) places = capitals;
  if (!places.length) return { status: 'not_found', message: 'Місто не знайдено. Уточни назву або країну, без адреси.' };
  const choices = [...new Map(places.map(p => [`${p.name}|${p.admin1}|${p.country_code}`, p])).values()];
  if (choices.length > 1) return { status: 'ambiguous', choices: choices.map(p => ({ city: p.name, region: p.admin1 || '', country: p.country_code })), message: 'Уточни країну або область зі списку, без адреси.' };
  const place = choices[0];
  if (!Number.isFinite(place.latitude) || Math.abs(place.latitude) > 90 || !Number.isFinite(place.longitude) || Math.abs(place.longitude) > 180) throw new Error('weather_unavailable');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max', timezone: 'auto', forecast_days: '2', temperature_unit: 'celsius' });
  const data = await json(url, request), i = day === 'tomorrow' ? 1 : 0, daily = data.daily || {};
  const high = daily.temperature_2m_max?.[i], low = daily.temperature_2m_min?.[i], rain = daily.precipitation_probability_max?.[i], date = daily.time?.[i], code = daily.weather_code?.[i];
  if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(code) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('weather_unavailable');
  return { status: 'ok', city: place.name, region: place.admin1 || '', country: place.country_code, day, date, timezone: data.timezone,
    high: Math.round(high), low: Math.round(low), rainChance: Number.isFinite(rain) ? Math.max(0, Math.min(100, Math.round(rain))) : null,
    condition: weatherCondition(code), source: { title: 'Open-Meteo · CC BY 4.0', url: 'https://open-meteo.com/' }, note: 'Це прогноз. Погода може змінитися.' };
}
