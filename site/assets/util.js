// 画面づくりで共通して使う小さな道具

/** 要素を作る。外から来た文字（ニュースの見出しなど）は必ず textContent で入れる。 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style') el.style.cssText = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** http(s) のリンクだけを通す（javascript: などを防ぐ） */
export function safeUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

export async function getJSON(url, { timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const numberFormats = new Map();
export function formatNumber(value, decimals = 0) {
  if (!numberFormats.has(decimals)) {
    numberFormats.set(
      decimals,
      new Intl.NumberFormat('ja-JP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    );
  }
  return numberFormats.get(decimals).format(value);
}

/** +1.23 / −0.45 / ±0 のように符号つきで表示する */
export function formatSigned(value, decimals = 0) {
  const text = formatNumber(Math.abs(value), decimals);
  if (Number(text.replace(/,/g, '')) === 0) return `±${text}`;
  return `${value > 0 ? '+' : '−'}${text}`;
}

export function direction(value) {
  return value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
}

const timeFormat = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
export function formatDateTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : timeFormat.format(date);
}

/** 「5分前」「3時間前」「10/21 18:30」 */
export function formatAgo(iso, now = Date.now()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((now - date.getTime()) / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}時間前`;
  return timeFormat.format(date);
}

const WEEKDAYS = '日月火水木金土';
/** "2026-10-21" → "10/21(水)" */
export function formatDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${weekday})`;
}

export function weekday(day) {
  const [y, m, d] = day.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}
