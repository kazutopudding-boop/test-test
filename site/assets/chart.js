// 株価の推移を描く SVG のグラフ（ライブラリなし）

import { h, formatNumber, formatSigned, formatDay } from './util.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** 小さな折れ線（株価カード用）。色は控えめにして、最新の点だけを強調する。 */
export function sparkline(values, { width = 120, height = 32 } = {}) {
  const root = svg('svg', {
    class: 'sparkline', viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true',
  });
  if (values.length < 2) return root;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 5;
  const x = (i) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2));
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  root.append(
    svg('path', { d, class: 'sparkline-line' }),
    svg('circle', { cx: x(values.length - 1), cy: y(values.at(-1)), r: 3.5, class: 'sparkline-dot' }),
  );
  return root;
}

/** きりのいい目盛りの値を返す（例: 2,800 / 2,850 / 2,900） */
function niceTicks(min, max, count = 4) {
  if (min === max) {
    const pad = Math.abs(min) * 0.01 || 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(v);
  return { ticks, step };
}

function decimalsFor(step) {
  return step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
}

/**
 * 1本の折れ線グラフ。指やマウスを動かすと、その日の値と前日比が出る。
 * 左右キーでも日付を動かせる。
 */
export class LineChart {
  constructor(container, { unit = '', decimals = 2, label = '価格の推移' } = {}) {
    this.container = container;
    this.unit = unit;
    this.decimals = decimals;
    this.points = [];
    this.active = null;
    this.frame = h('div', {
      class: 'chart-frame', tabindex: '0', role: 'img', 'aria-label': `${label}（左右キーで日付を移動）`,
    });
    this.tooltip = h('div', { class: 'chart-tooltip', hidden: true });
    this.frame.append(this.tooltip);
    container.replaceChildren(this.frame);

    this.frame.addEventListener('pointermove', (e) => this.pointAt(e));
    this.frame.addEventListener('pointerdown', (e) => this.pointAt(e));
    // 指で触ったときは、指を離しても値を出したままにする（別の場所を触ると消える）
    this.frame.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && this.setActive(null));
    this.frame.addEventListener('keydown', (e) => this.onKey(e));
    this.frame.addEventListener('blur', () => this.setActive(null));
    this.resizer = new ResizeObserver(() => this.draw());
    this.resizer.observe(this.frame);
  }

  set(points, { tone = 'flat', unit = this.unit, decimals = this.decimals, label } = {}) {
    this.points = points;
    this.tone = tone;
    this.unit = unit;
    this.decimals = decimals;
    if (label) this.frame.setAttribute('aria-label', `${label}（左右キーで日付を移動）`);
    this.active = null;
    this.draw();
  }

  draw() {
    this.svg?.remove();
    const width = this.frame.clientWidth;
    const height = this.frame.clientHeight;
    if (!width || this.points.length < 2) return;

    const margin = { top: 14, right: 64, bottom: 28, left: 8 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const values = this.points.map((p) => p[1]);
    const pad = (Math.max(...values) - Math.min(...values)) * 0.08;
    const lo = Math.min(...values) - pad;
    const hi = Math.max(...values) + pad;
    const { ticks, step } = niceTicks(lo, hi);
    const x = (i) => margin.left + (i / (this.points.length - 1)) * plotW;
    const y = (v) => margin.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;
    this.geometry = { x, y, margin, plotW, width };

    const root = svg('svg', { width, height, class: `chart chart--${this.tone}`, 'aria-hidden': 'true' });
    const tickDecimals = Math.max(decimalsFor(step), 0);
    const lastY = y(values.at(-1));

    // 横の目盛り線と値（右側）。最新値のラベルと重なるものは省く
    for (const tick of ticks) {
      const ty = y(tick);
      root.append(svg('line', { x1: margin.left, x2: margin.left + plotW, y1: ty, y2: ty, class: 'chart-grid' }));
      if (Math.abs(ty - lastY) > 14) {
        const label = svg('text', { x: margin.left + plotW + 8, y: ty, class: 'chart-tick', 'dominant-baseline': 'middle' });
        label.textContent = formatNumber(tick, tickDecimals);
        root.append(label);
      }
    }

    // 日付の目盛り（5つくらい）
    const count = Math.min(5, this.points.length);
    for (let k = 0; k < count; k++) {
      const i = Math.round((k / (count - 1)) * (this.points.length - 1));
      const label = svg('text', {
        x: x(i), y: height - 8, class: 'chart-tick',
        'text-anchor': k === 0 ? 'start' : k === count - 1 ? 'end' : 'middle',
      });
      label.textContent = formatDay(this.points[i][0]).replace(/\(.\)/, '');
      root.append(label);
    }

    const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const bottom = margin.top + plotH;
    root.append(
      svg('path', { d: `${line}L${x(values.length - 1)},${bottom}L${x(0)},${bottom}Z`, class: 'chart-area' }),
      svg('path', { d: line, class: 'chart-line' }),
      svg('circle', { cx: x(values.length - 1), cy: lastY, r: 4, class: 'chart-dot' }),
    );

    // 最新値のラベル（右端）
    const tag = svg('g', { class: 'chart-last', transform: `translate(${margin.left + plotW + 4},${lastY})` });
    const text = formatNumber(values.at(-1), this.decimals);
    const tagWidth = Math.min(margin.right - 4, 10 + text.length * 7.2);
    tag.append(svg('rect', { x: 0, y: -10, width: tagWidth, height: 20, rx: 4 }));
    const tagText = svg('text', { x: tagWidth / 2, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    tagText.textContent = text;
    tag.append(tagText);
    root.append(tag);

    this.cross = svg('line', { y1: margin.top, y2: bottom, class: 'chart-cross', visibility: 'hidden' });
    this.marker = svg('circle', { r: 4, class: 'chart-dot', visibility: 'hidden' });
    root.append(this.cross, this.marker);
    this.svg = root;
    this.frame.prepend(root);
    if (this.active != null) this.setActive(this.active);
  }

  pointAt(event) {
    if (!this.geometry || this.points.length < 2) return;
    const rect = this.frame.getBoundingClientRect();
    const { margin, plotW } = this.geometry;
    const ratio = (event.clientX - rect.left - margin.left) / plotW;
    this.setActive(Math.round(Math.min(1, Math.max(0, ratio)) * (this.points.length - 1)));
  }

  onKey(event) {
    const last = this.points.length - 1;
    const keys = { ArrowLeft: -1, ArrowRight: 1 };
    if (event.key in keys) {
      this.setActive(Math.min(last, Math.max(0, (this.active ?? last) + keys[event.key])));
    } else if (event.key === 'Home') this.setActive(0);
    else if (event.key === 'End') this.setActive(last);
    else if (event.key === 'Escape') this.setActive(null);
    else return;
    event.preventDefault();
  }

  setActive(index) {
    this.active = index;
    if (!this.cross) return;
    if (index == null) {
      this.cross.setAttribute('visibility', 'hidden');
      this.marker.setAttribute('visibility', 'hidden');
      this.tooltip.hidden = true;
      return;
    }
    const { x, y, width } = this.geometry;
    const [day, value] = this.points[index];
    const cx = x(index);
    this.cross.setAttribute('x1', cx);
    this.cross.setAttribute('x2', cx);
    this.cross.setAttribute('visibility', 'visible');
    this.marker.setAttribute('cx', cx);
    this.marker.setAttribute('cy', y(value));
    this.marker.setAttribute('visibility', 'visible');

    const before = index > 0 ? this.points[index - 1][1] : null;
    const change = before ? h('span', { class: `tip-change ${value >= before ? (value > before ? 'up' : 'flat') : 'down'}` },
      `前日比 ${formatSigned(value - before, this.decimals)} (${formatSigned(((value - before) / before) * 100, 2)}%)`) : null;
    this.tooltip.replaceChildren(...[
      h('strong', { class: 'tip-value' }, formatNumber(value, this.decimals), this.unit && h('small', {}, this.unit)),
      h('span', { class: 'tip-date' }, formatDay(day)),
      change,
    ].filter(Boolean));
    this.tooltip.hidden = false;
    const tipWidth = this.tooltip.offsetWidth;
    const left = Math.min(Math.max(cx - tipWidth / 2, 0), width - tipWidth);
    this.tooltip.style.left = `${left}px`;
  }
}
