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

/** 日足の1行（[日付, 始値, 高値, 安値, 終値] か、古いデータの [日付, 終値]）を読みやすい形にする */
export function toCandle(row) {
  const [day, ...values] = row;
  const close = values.at(-1);
  const [open, high, low] = values.length >= 4 ? values : [close, close, close];
  return { day, open, high, low, close };
}

/**
 * ローソク足のグラフ。始値より終値が高い日（陽線）は赤、低い日（陰線）は青。
 * 指やマウスを動かすと、その日の四本値と前日比が出る。左右キーでも日付を動かせる。
 */
export class CandleChart {
  constructor(container, { unit = '', decimals = 2, label = '株価の推移' } = {}) {
    this.container = container;
    this.unit = unit;
    this.decimals = decimals;
    this.candles = [];
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

  /** @param rows 日足の行。before は表示範囲の前日の終値（最初の足の前日比に使う） */
  /**
   * labelOf / tickOf: 足の日付（"2026-10-22" か UNIX 秒）を、ツールチップ用・目盛り用の文字にする関数。
   * changeLabel: ツールチップで1つ前の足と比べた変化の呼び名（日足なら「前日比」）
   */
  set(rows, {
    unit = this.unit, decimals = this.decimals, label, before = null, keepActive = false,
    labelOf = (day) => `${formatDay(day)} 終値`, tickOf = (day) => formatDay(day).replace(/\(.\)/, ''),
    changeLabel = '前日比',
  } = {}) {
    this.candles = rows.map(toCandle);
    Object.assign(this, { labelOf, tickOf, changeLabel });
    this.before = before;
    this.unit = unit;
    this.decimals = decimals;
    if (label) this.frame.setAttribute('aria-label', `${label}（左右キーで日付を移動）`);
    // リアルタイム更新のときは、指で選んでいる日付をそのまま残す
    if (!keepActive || this.active >= this.candles.length) this.active = null;
    this.draw();
  }

  previousClose(index) {
    return index > 0 ? this.candles[index - 1].close : this.before;
  }

  draw() {
    this.svg?.remove();
    const width = this.frame.clientWidth;
    const height = this.frame.clientHeight;
    const candles = this.candles;
    if (!width || !candles.length) return;

    const last = candles.at(-1);
    const lastText = formatNumber(last.close, this.decimals);
    // 右側の目盛りと最新値のラベルが入る幅を、数字の長さから決める
    const tagWidth = Math.ceil(12 + lastText.length * 7.2);
    const margin = { top: 14, right: Math.max(56, tagWidth + 6), bottom: 28, left: 8 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const max = Math.max(...candles.map((c) => c.high));
    const min = Math.min(...candles.map((c) => c.low));
    const pad = (max - min) * 0.06 || Math.abs(max) * 0.005 || 1;
    const lo = min - pad;
    const hi = max + pad;
    const { ticks, step } = niceTicks(lo, hi);
    const slot = plotW / candles.length;
    const x = (i) => margin.left + (i + 0.5) * slot;
    const y = (v) => margin.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;
    this.geometry = { x, margin, plotW, width, slot };

    const root = svg('svg', { width, height, class: 'chart', 'aria-hidden': 'true' });
    const tickDecimals = Math.max(decimalsFor(step), 0);
    const lastY = y(last.close);

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
    const count = Math.min(5, candles.length);
    for (let k = 0; k < count; k++) {
      const i = count > 1 ? Math.round((k / (count - 1)) * (candles.length - 1)) : 0;
      const label = svg('text', {
        x: x(i), y: height - 8, class: 'chart-tick',
        'text-anchor': count === 1 ? 'middle' : k === 0 ? 'start' : k === count - 1 ? 'end' : 'middle',
      });
      label.textContent = this.tickOf(candles[i].day);
      root.append(label);
    }

    this.cross = svg('line', { y1: margin.top, y2: margin.top + plotH, class: 'chart-cross', visibility: 'hidden' });
    root.append(this.cross);

    // ローソク足: ひげ（高値〜安値）と胴体（始値〜終値）。胴体は足の間隔の7割、最大14px
    const body = Math.max(1, Math.min(14, slot * 0.7));
    const candleGroup = svg('g', {});
    candles.forEach((c, i) => {
      const tone = c.close > c.open ? 'up' : c.close < c.open ? 'down' : 'flat';
      const cx = x(i);
      const top = y(Math.max(c.open, c.close));
      const g = svg('g', { class: `candle candle--${tone}` });
      g.append(
        svg('line', { x1: cx, x2: cx, y1: y(c.high), y2: y(c.low), class: 'candle-wick' }),
        svg('rect', {
          x: cx - body / 2, y: top, width: body,
          height: Math.max(1, y(Math.min(c.open, c.close)) - top), class: 'candle-body',
        }),
      );
      candleGroup.append(g);
    });
    root.append(candleGroup);

    // 最新値のラベル（右端）。色は前日比の向き
    const before = this.previousClose(candles.length - 1);
    const lastTone = before == null ? 'flat' : last.close > before ? 'up' : last.close < before ? 'down' : 'flat';
    const tag = svg('g', { class: `chart-last chart-last--${lastTone}`, transform: `translate(${margin.left + plotW + 4},${lastY})` });
    tag.append(svg('rect', { x: 0, y: -10, width: tagWidth, height: 20, rx: 4 }));
    const tagText = svg('text', { x: tagWidth / 2, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    tagText.textContent = lastText;
    tag.append(tagText);
    root.append(tag);

    this.svg = root;
    this.frame.prepend(root);
    if (this.active != null) this.setActive(this.active);
  }

  pointAt(event) {
    if (!this.geometry || !this.candles.length) return;
    const rect = this.frame.getBoundingClientRect();
    const { margin, slot } = this.geometry;
    const index = Math.floor((event.clientX - rect.left - margin.left) / slot);
    this.setActive(Math.min(this.candles.length - 1, Math.max(0, index)));
  }

  onKey(event) {
    const last = this.candles.length - 1;
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
      this.tooltip.hidden = true;
      return;
    }
    const { x, width } = this.geometry;
    const c = this.candles[index];
    const cx = x(index);
    this.cross.setAttribute('x1', cx);
    this.cross.setAttribute('x2', cx);
    this.cross.setAttribute('visibility', 'visible');

    const before = this.previousClose(index);
    const d = this.decimals;
    const change = before ? h('span', { class: `tip-change ${c.close > before ? 'up' : c.close < before ? 'down' : 'flat'}` },
      `${this.changeLabel} ${formatSigned(c.close - before, d)} (${formatSigned(((c.close - before) / before) * 100, 2)}%)`) : null;
    this.tooltip.replaceChildren(...[
      h('strong', { class: 'tip-value' }, formatNumber(c.close, d), this.unit && h('small', {}, this.unit)),
      h('span', { class: 'tip-date' }, this.labelOf(c.day)),
      h('span', { class: 'tip-ohlc' },
        `始 ${formatNumber(c.open, d)}　高 ${formatNumber(c.high, d)}　安 ${formatNumber(c.low, d)}`),
      change,
    ].filter(Boolean));
    this.tooltip.hidden = false;
    const tipWidth = this.tooltip.offsetWidth;
    const left = Math.min(Math.max(cx - tipWidth / 2, 0), width - tipWidth);
    this.tooltip.style.left = `${left}px`;
  }
}
