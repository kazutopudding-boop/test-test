// 株価（指数・注目銘柄）のカードと、選んだ銘柄のグラフ

import { h, formatNumber, formatSigned, formatDateTime, formatDay, direction } from './util.js';
import { sparkline, CandleChart, toCandle } from './chart.js';

const RANGES = [
  ['1か月', 22],
  ['3か月', 66],
  ['6か月', Infinity],
];
const SHOW_FIRST = 8;

function price(quote, value = quote.price) {
  return [formatNumber(value, quote.decimals), quote.unit && h('small', { class: 'unit' }, quote.unit)];
}

function delta(quote) {
  return h('span', { class: `delta ${direction(quote.change)}` },
    `${formatSigned(quote.change, quote.decimals)} (${formatSigned(quote.changePct, 2)}%)`);
}

/** 個別株の銘柄コード（7203 / NVDA）。指数や為替は記号が分かりにくいので出さない。 */
function ticker(symbol) {
  return /[\^=]/.test(symbol) ? '' : symbol.replace(/\.T$/, '');
}

export function initStocks(root) {
  const indices = h('div', { class: 'tiles tiles--indices' });
  const tabs = h('div', { class: 'filters', role: 'group', 'aria-label': '市場' });
  const note = h('p', { class: 'stocks-note' });
  const grid = h('div', { class: 'tiles' });
  const more = h('button', { type: 'button', class: 'button-quiet more', hidden: true });
  const detail = h('section', { class: 'stock-detail', 'aria-live': 'polite', 'aria-label': '選んだ銘柄の推移' });
  root.querySelector('.stocks-body').append(
    h('h3', { class: 'sub-title' }, 'マーケット指標'),
    indices,
    h('div', { class: 'sub-head' }, h('h3', { class: 'sub-title' }, '注目の銘柄'), tabs),
    note, grid, more, detail,
  );

  let data = null;
  let market = 'jp';
  let showAll = false;
  let selected = '^N225';
  let range = '3か月';
  const chartBox = h('div', { class: 'chart-box' });
  const chart = new CandleChart(chartBox);

  function all() {
    return data ? [...data.indices, ...data.jp, ...data.us] : [];
  }

  function tile(quote) {
    const lastMonth = quote.history.slice(-22).map((row) => toCandle(row).close);
    return h('button', {
      type: 'button',
      class: `tile${quote.symbol === selected ? ' is-selected' : ''}`,
      'aria-pressed': String(quote.symbol === selected),
      onclick: () => {
        selected = quote.symbol;
        render();
        if (matchMedia('(max-width: 720px)').matches) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
    },
    h('span', { class: 'tile-name' },
      h('span', { class: 'tile-label' }, quote.name),
      quote.trending && h('span', { class: 'badge', title: '米国の Yahoo!ファイナンスで話題の銘柄' }, '話題')),
    ticker(quote.symbol) && h('span', { class: 'tile-symbol' }, ticker(quote.symbol)),
    h('span', { class: 'tile-price' }, price(quote)),
    delta(quote),
    sparkline(lastMonth),
    quote.stale && h('span', { class: 'tile-stale' }, '前回のデータ'));
  }

  function renderDetail() {
    const quote = all().find((q) => q.symbol === selected) ?? data.indices[0] ?? data.jp[0];
    if (!quote) {
      detail.replaceChildren();
      return;
    }
    const days = RANGES.find(([name]) => name === range)[1];
    const start = Math.max(0, quote.history.length - days);
    const rows = quote.history.slice(start);
    // 期間の変化は、期間が始まる前日の終値と最新の終値を比べる
    const before = start > 0 ? toCandle(quote.history[start - 1]).close : toCandle(rows[0]).open;
    const last = rows.length ? toCandle(rows.at(-1)).close : before;
    const periodChange = before ? ((last - before) / before) * 100 : 0;

    detail.replaceChildren(
      h('div', { class: 'detail-head' },
        h('div', {},
          h('h4', { class: 'detail-name' }, quote.name,
            ticker(quote.symbol) && h('span', { class: 'tile-symbol' }, ticker(quote.symbol))),
          h('p', { class: 'detail-price' }, price(quote)),
          h('p', { class: 'detail-delta' }, h('span', { class: 'detail-label' }, '前日比'), delta(quote)),
          h('p', { class: 'detail-time' },
            quote.time ? `${formatDateTime(quote.time)} 時点` : '',
            quote.stale ? '（更新できなかったため前回のデータ）' : '')),
        h('div', { class: 'detail-controls' },
          h('div', { class: 'filters', role: 'group', 'aria-label': '期間' },
            RANGES.map(([name]) => h('button', {
              type: 'button', class: 'chip-button', 'aria-pressed': String(name === range),
              onclick: () => { range = name; renderDetail(); },
            }, name))),
          h('p', { class: 'detail-period' }, `${range}で `,
            h('span', { class: `delta ${direction(periodChange)}` }, `${formatSigned(periodChange, 2)}%`)))),
      chartBox,
      table(quote, rows),
    );
    chart.set(rows, {
      unit: quote.unit, decimals: quote.decimals, before: start > 0 ? before : null,
      label: `${quote.name}の${range}のローソク足`,
    });
  }

  function table(quote, history) {
    const candles = history.slice(-21).map(toCandle);
    const d = quote.decimals;
    const rows = candles.slice(1).reverse().map((c, i, arr) => {
      const before = (arr[i + 1] ?? candles[0]).close;
      return h('tr', {},
        h('th', { scope: 'row' }, formatDay(c.day)),
        h('td', {}, formatNumber(c.open, d)),
        h('td', {}, formatNumber(c.high, d)),
        h('td', {}, formatNumber(c.low, d)),
        h('td', {}, formatNumber(c.close, d)),
        h('td', { class: `delta ${direction(c.close - before)}` },
          `${formatSigned(((c.close - before) / before) * 100, 2)}%`));
    });
    return h('details', { class: 'detail-table' },
      h('summary', {}, '表で見る（直近20日）'),
      h('table', {},
        h('thead', {}, h('tr', {}, ...['日付', '始値', '高値', '安値', '終値', '前日比'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows)));
  }

  function render() {
    if (!data) return;
    indices.replaceChildren(...data.indices.map(tile));
    tabs.replaceChildren(...[['jp', '日本株'], ['us', '米国株']].map(([key, name]) => h('button', {
      type: 'button', class: 'chip-button', 'aria-pressed': String(key === market),
      onclick: () => { market = key; showAll = false; render(); },
    }, name)));
    const list = data[market];
    note.textContent = market === 'us'
      ? '「話題」は米国の Yahoo!ファイナンスで話題の銘柄。ほかは前日比の値動きが大きい順です。'
      : '代表的な銘柄を、前日比の値動きが大きい順に並べています。';
    grid.replaceChildren(...(showAll ? list : list.slice(0, SHOW_FIRST)).map(tile));
    more.hidden = list.length <= SHOW_FIRST;
    more.textContent = showAll ? '少なく表示' : `すべて表示（${list.length}銘柄）`;
    more.onclick = () => { showAll = !showAll; render(); };
    renderDetail();
  }

  return {
    update(next) {
      data = { indices: next.indices ?? [], jp: next.jp ?? [], us: next.us ?? [] };
      if (!all().some((q) => q.symbol === selected)) selected = all()[0]?.symbol;
      if (!all().length) {
        note.textContent = '株価のデータがまだありません。';
        return;
      }
      render();
    },
    error(message) {
      if (!data) note.textContent = `株価を読み込めませんでした（${message}）`;
    },
  };
}
