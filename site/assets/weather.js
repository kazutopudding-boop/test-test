// 現在地の天気（Open-Meteo）。位置はブラウザの位置情報 → だめなら IP からおおよその位置 → 東京。

import { h, getJSON, weekday } from './util.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const TOKYO = { lat: 35.6812, lng: 139.7671, name: '東京', note: '位置情報が使えないため東京を表示しています' };

// WMO の天気コード → 日本語と絵文字
const WEATHER = [
  [[0], '快晴', '☀️', '🌙'],
  [[1], '晴れ', '🌤️', '🌙'],
  [[2], '晴れ時々くもり', '⛅', '☁️'],
  [[3], 'くもり', '☁️', '☁️'],
  [[45, 48], '霧', '🌫️', '🌫️'],
  [[51, 53, 55, 56, 57], '霧雨', '🌦️', '🌧️'],
  [[61, 80], '小雨', '🌦️', '🌧️'],
  [[63, 66, 81], '雨', '🌧️', '🌧️'],
  [[65, 67, 82], '強い雨', '🌧️', '🌧️'],
  [[71, 77, 85], '小雪', '🌨️', '🌨️'],
  [[73, 75, 86], '雪', '❄️', '❄️'],
  [[95], '雷雨', '⛈️', '⛈️'],
  [[96, 99], 'ひょうを伴う雷雨', '⛈️', '⛈️'],
];

function describe(code, isDay = 1) {
  const found = WEATHER.find(([codes]) => codes.includes(code));
  if (!found) return { label: '—', icon: '🌡️' };
  return { label: found[1], icon: isDay ? found[2] : found[3] };
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('位置情報に対応していません'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      reject,
      { timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

function placeName(geo) {
  const parts = [geo.principalSubdivision, geo.city || geo.locality].filter(Boolean);
  return [...new Set(parts)].join(' ') || geo.countryName || '';
}

async function findLocation() {
  try {
    const position = await getPosition();
    try {
      const geo = await getJSON(`${GEOCODE_URL}?latitude=${position.lat}&longitude=${position.lng}&localityLanguage=ja`);
      return { ...position, name: placeName(geo) || '現在地' };
    } catch {
      return { ...position, name: '現在地' };
    }
  } catch {
    // 位置情報が許可されなかったときは、接続元からおおよその場所を推定する
    try {
      const geo = await getJSON(`${GEOCODE_URL}?localityLanguage=ja`);
      if (Number.isFinite(geo.latitude)) {
        return { lat: geo.latitude, lng: geo.longitude, name: placeName(geo), note: 'おおよその位置です' };
      }
    } catch { /* 下の東京にする */ }
    return TOKYO;
  }
}

export function initWeather(root, { onLocation } = {}) {
  const place = h('span', { class: 'wx-place', text: '現在地を確認しています…' });
  const note = h('span', { class: 'wx-note', hidden: true });
  const body = h('div', { class: 'wx-body', 'aria-live': 'polite' });
  const retry = h('button', { type: 'button', class: 'button-quiet', onclick: () => load() },
    h('span', { 'aria-hidden': 'true' }, '↻ '), '現在地を更新');
  root.replaceChildren(
    h('div', { class: 'section-head' }, h('h2', { id: 'weather-title' }, '現在地の天気'), retry),
    h('p', { class: 'wx-where' }, h('span', { 'aria-hidden': 'true' }, '📍 '), place, note),
    body,
  );

  let loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    root.classList.add('is-loading');
    try {
      const where = await findLocation();
      place.textContent = where.name;
      note.textContent = where.note || '';
      note.hidden = !where.note;
      onLocation?.(where);
      const params = new URLSearchParams({
        latitude: where.lat.toFixed(3),
        longitude: where.lng.toFixed(3),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
        hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
        timezone: 'auto',
        forecast_days: '7',
        wind_speed_unit: 'ms',
      });
      render(body, await getJSON(`${FORECAST_URL}?${params}`));
    } catch (error) {
      body.replaceChildren(h('p', { class: 'empty' }, `天気を取得できませんでした（${error.message}）`));
    } finally {
      loading = false;
      root.classList.remove('is-loading');
    }
  }

  load();
  setInterval(() => document.visibilityState === 'visible' && load(), 30 * 60 * 1000);
}

function render(body, data) {
  const { current, hourly, daily } = data;
  const now = describe(current.weather_code, current.is_day);
  const round = (v) => Math.round(v);

  const hero = h('div', { class: 'wx-now' },
    h('span', { class: 'wx-icon', 'aria-hidden': 'true' }, now.icon),
    h('span', { class: 'wx-temp' }, round(current.temperature_2m), h('span', { class: 'wx-deg' }, '°C')),
    h('span', { class: 'wx-desc' },
      h('strong', {}, now.label),
      h('span', {}, `最高 ${round(daily.temperature_2m_max[0])}° / 最低 ${round(daily.temperature_2m_min[0])}°`)),
  );

  const stats = h('dl', { class: 'wx-stats' },
    stat('体感', `${round(current.apparent_temperature)}°`),
    stat('湿度', `${round(current.relative_humidity_2m)}%`),
    stat('風', `${current.wind_speed_10m.toFixed(1)} m/s`),
    stat('降水確率', `${daily.precipitation_probability_max[0] ?? '—'}%`),
  );

  // これから24時間（今の時刻から）
  const hourKey = current.time.slice(0, 13);
  const start = Math.max(0, hourly.time.findIndex((t) => t.slice(0, 13) >= hourKey));
  const hours = h('ol', { class: 'wx-hours', 'aria-label': '1時間ごとの予報' });
  for (let i = start; i < Math.min(start + 24, hourly.time.length); i++) {
    const w = describe(hourly.weather_code[i], hourly.is_day[i]);
    const rain = hourly.precipitation_probability[i];
    hours.append(h('li', {},
      h('span', { class: 'wx-hour' }, i === start ? '今' : `${Number(hourly.time[i].slice(11, 13))}時`),
      h('span', { class: 'wx-hour-icon', title: w.label, 'aria-label': w.label }, w.icon),
      h('span', { class: 'wx-hour-temp' }, `${round(hourly.temperature_2m[i])}°`),
      h('span', { class: 'wx-hour-rain' }, rain >= 10 ? `${rain}%` : ''),
    ));
  }

  // 週間予報。気温の幅を横棒で表す（7日間の最低〜最高を全体の幅とする）
  const lows = daily.temperature_2m_min;
  const highs = daily.temperature_2m_max;
  const floor = Math.min(...lows);
  const span = Math.max(...highs) - floor || 1;
  const days = h('ol', { class: 'wx-days', 'aria-label': '週間予報' });
  daily.time.forEach((day, i) => {
    const w = describe(daily.weather_code[i]);
    const left = ((lows[i] - floor) / span) * 100;
    const width = ((highs[i] - lows[i]) / span) * 100;
    days.append(h('li', {},
      h('span', { class: 'wx-day' }, i === 0 ? '今日' : i === 1 ? '明日' : weekday(day)),
      h('span', { class: 'wx-day-icon', title: w.label, 'aria-label': w.label }, w.icon),
      h('span', { class: 'wx-day-rain' }, `${daily.precipitation_probability_max[i] ?? '—'}%`),
      h('span', { class: 'wx-day-low' }, `${round(lows[i])}°`),
      h('span', { class: 'wx-range', 'aria-hidden': 'true' },
        h('span', { style: `left:${left}%;width:${Math.max(width, 4)}%` })),
      h('span', { class: 'wx-day-high' }, `${round(highs[i])}°`),
    ));
  });

  body.replaceChildren(
    h('div', { class: 'wx-top' }, hero, stats),
    hours,
    days,
  );
}

function stat(label, value) {
  return h('div', {}, h('dt', {}, label), h('dd', {}, value));
}
