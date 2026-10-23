// 株価（指数・注目銘柄）のカードと、選んだ銘柄のローソク足

import { h, formatNumber, formatSigned, formatDateTime, formatDay, direction } from './util.js';
import { sparkline, CandleChart, toCandle } from './chart.js';
import { LiveFeed } from './live.js';

// 期間の切り替え。5秒足・1分足は Finnhub 接続中の米国株だけ（届いた取引からその場で作る）。
// 1日・5日は15分足、それより長い期間は日足
const RANGES = [
  { name: '5秒足', tick: 5 },
  { name: '1分足', tick: 60 },
  { name: '1日', intraday: 'day' },
  { name: '5日', intraday: 'all' },
  { name: '1か月', days: 22 },
  { name: '3か月', days: 66 },
  { name: '6か月', days: Infinity },
];
const BAR_SECONDS = 15 * 60;
const TICK_SIZES = [5, 60];
const MAX_TICK_BARS = 120; // 5秒足なら直近10分、1分足なら直近2時間
const clockSeconds = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hourMinute = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' });
const WEEKDAYS = '日月火水木金土';
/** UNIX 秒 → "10/22(水) 23:45"（見ている人の時刻で表示） */
function barLabel(t) {
  const d = new Date(t * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]}) ${hourMinute.format(d)}`;
}
/** その足が取引所の時刻で何日の取引か */
function sessionDay(t, offset) {
  return new Date((t + offset) * 1000).toISOString().slice(0, 10);
}
const DAILY_FORMAT = { chart: {}, rowLabel: formatDay, header: '日付', changeLabel: '前日比', tableTitle: '表で見る（直近20日）' };
const INTRADAY_FORMAT = {
  rowLabel: barLabel, header: '日時', changeLabel: '前の足から', tableTitle: '表で見る（直近20本・15分足）',
};
const SHOW_FIRST = 8;
const clockFormat = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

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

/** リアルタイムの日足を、1時間ごとに作られたデータ（quote）に重ねる */
function applyLive(quote, candle) {
  const row = [candle.day, candle.open, candle.high, candle.low, candle.close];
  const last = quote.history.at(-1);
  if (last && last[0] === candle.day) quote.history[quote.history.length - 1] = row;
  else if (!last || last[0] < candle.day) quote.history.push(row);
  else return; // 古い日の値は使わない
  const previous = candle.prevClose
    ?? (quote.history.length >= 2 ? toCandle(quote.history.at(-2)).close : quote.prev);
  quote.price = candle.close;
  quote.prev = previous;
  quote.change = candle.close - previous;
  quote.changePct = previous ? ((candle.close - previous) / previous) * 100 : 0;
  quote.time = new Date(candle.time).toISOString();
  quote.live = true;
  delete quote.stale;
}

export function initStocks(root) {
  const indices = h('div', { class: 'tiles tiles--indices' });
  const tabs = h('div', { class: 'filters', role: 'group', 'aria-label': '市場' });
  const note = h('p', { class: 'stocks-note' });
  const grid = h('div', { class: 'tiles' });
  const more = h('button', { type: 'button', class: 'button-quiet more', hidden: true });
  const detail = h('section', { class: 'stock-detail', 'aria-label': '選んだ銘柄の推移' });
  const livePanel = h('div', { class: 'live-panel' });
  root.querySelector('.stocks-body').append(
    livePanel,
    h('h3', { class: 'sub-title' }, 'マーケット指標'),
    indices,
    h('div', { class: 'sub-head' }, h('h3', { class: 'sub-title' }, '注目の銘柄'), tabs),
    note, grid, more, detail,
  );

  let data = null;
  let market = 'jp';
  let showAll = false;
  let selected = '^N225';
  let range = '1日';
  const chartBox = h('div', { class: 'chart-box' });
  const chart = new CandleChart(chartBox);
  let detailParts = null;

  function all() {
    return data ? [...data.indices, ...data.jp, ...data.us] : [];
  }

  // ---------- リアルタイム（米国株） ----------

  const liveCandles = new Map(); // 銘柄 → 最新の日足（データを読み直しても重ね直せるよう覚えておく）
  const liveBars = new Map(); // 銘柄 → (15分足の開始時刻 → 足) 受け取った取引から作った15分足
  const tickBars = new Map(); // 銘柄 → { 5: (開始時刻 → 足), 60: (開始時刻 → 足) } 5秒足と1分足

  /** 取引1件を、size 秒ごとの足の集まり（開始時刻 → 足）に足し込む */
  function addToBars(bars, size, time, value) {
    const start = Math.floor(time / 1000 / size) * size;
    const bar = bars.get(start);
    bars.set(start, bar
      ? [start, bar[1], Math.max(bar[2], value), Math.min(bar[3], value), value]
      : [start, value, value, value, value]);
  }

  function addTrade(symbol, time, value) {
    if (!liveBars.has(symbol)) liveBars.set(symbol, new Map());
    addToBars(liveBars.get(symbol), BAR_SECONDS, time, value);
    if (!tickBars.has(symbol)) tickBars.set(symbol, Object.fromEntries(TICK_SIZES.map((size) => [size, new Map()])));
    for (const size of TICK_SIZES) {
      const bars = tickBars.get(symbol)[size];
      addToBars(bars, size, time, value);
      // 古い足から捨てて、本数を一定に保つ（Map は入れた順に並ぶ）
      while (bars.size > MAX_TICK_BARS) bars.delete(bars.keys().next().value);
    }
  }

  function isLiveSymbol(symbol) {
    return feed.connected && Boolean(data?.us.some((q) => q.symbol === symbol));
  }

  /** 受け取った取引の15分足を、1時間ごとのデータの15分足に重ねる */
  function applyLiveBars(quote) {
    const bars = quote.intraday?.bars;
    const live = liveBars.get(quote.symbol);
    if (!bars || !live) return;
    for (const bar of [...live.values()].sort((a, b) => a[0] - b[0])) {
      const i = bars.findLastIndex((b) => b[0] === bar[0]);
      if (i >= 0) {
        const old = bars[i];
        bars[i] = [old[0], old[1], Math.max(old[2], bar[2]), Math.min(old[3], bar[3]), bar[4]];
      } else if (!bars.length || bar[0] > bars.at(-1)[0]) {
        bars.push(bar);
      }
    }
  }
  const changed = new Set();
  let liveState = 'idle';
  let liveMessage = '';
  let lastTrade = null;
  const feed = new LiveFeed({
    onCandle(symbol, candle) {
      liveCandles.set(symbol, candle);
      addTrade(symbol, candle.time, candle.close);
      changed.add(symbol);
      lastTrade = Math.max(lastTrade ?? 0, candle.time);
    },
    onStatus(state, message) {
      const wasLive = liveState === 'live';
      liveState = state;
      liveMessage = message;
      if (state === 'idle' || state === 'error') {
        liveCandles.clear();
        liveBars.clear();
        tickBars.clear();
        lastTrade = null;
        if (RANGES.find((r) => r.name === range)?.tick) range = '1日';
      }
      // つながったら、米国株を選んでいれば5秒足に切り替える
      if (state === 'live' && !wasLive && isLiveSymbol(selected)) range = '5秒足';
      renderLivePanel();
      if (data) renderDetail();
    },
  });

  const keyInput = h('input', {
    type: 'password', id: 'finnhub-key', class: 'live-key', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Finnhub の APIキー', 'aria-describedby': 'live-help',
  });
  const liveButton = h('button', { type: 'button', class: 'chip-button' });
  const liveBadge = h('span', { class: 'live-badge', hidden: true }, 'LIVE');
  const liveStatus = h('p', { class: 'live-status', role: 'status' });
  keyInput.addEventListener('keydown', (e) => e.key === 'Enter' && liveButton.click());
  liveButton.addEventListener('click', () => {
    if (feed.connected) {
      feed.disconnect();
      refresh(); // リアルタイムの値を外して、1時間ごとのデータに戻す
      return;
    }
    const key = keyInput.value.trim();
    if (!key || !data?.us.length) return;
    keyInput.value = ''; // 入力欄にも残さない
    feed.connect(key, data.us.map((q) => q.symbol));
  });
  livePanel.append(
    h('div', { class: 'live-head' },
      h('label', { for: 'finnhub-key', class: 'live-title' }, '米国株をリアルタイムで見る'),
      liveBadge),
    h('div', { class: 'live-form' }, keyInput, liveButton),
    liveStatus,
    h('p', { class: 'live-help', id: 'live-help' },
      'キーは保存しません（ページを閉じるか再読み込みすると消えます）。キーは ',
      h('a', { href: 'https://finnhub.io/register', target: '_blank', rel: 'noopener noreferrer' }, 'Finnhub'),
      ' に無料登録すると管理画面に表示されます。日本株と指数は1時間ごとの更新のままです。'),
  );

  function renderLivePanel() {
    const connected = feed.connected;
    keyInput.hidden = connected;
    liveButton.textContent = connected ? '切断' : '接続';
    liveBadge.hidden = liveState !== 'live';
    livePanel.classList.toggle('is-live', liveState === 'live');
    if (liveState === 'live') {
      liveStatus.textContent = lastTrade
        ? `接続中: 米国株${data?.us.length ?? 0}銘柄を毎秒更新 · 最後の取引 ${clockFormat.format(lastTrade)}`
        : '接続中: 取引が入るとすぐ反映します（米国市場の取引時間は日本時間の夜〜早朝です）';
    } else {
      liveStatus.textContent = liveState === 'idle' ? '' : liveMessage;
    }
    liveStatus.classList.toggle('is-error', liveState === 'error');
  }
  renderLivePanel();

  // 届いた値は1秒に1回まとめて画面に出す（「毎秒更新」）
  setInterval(() => {
    if (!data || !changed.size) return;
    for (const symbol of changed) {
      const quote = data.us.find((q) => q.symbol === symbol);
      const candle = liveCandles.get(symbol);
      if (!quote || !candle) continue;
      const before = quote.price;
      applyLive(quote, candle);
      applyLiveBars(quote);
      refreshTile(quote, Math.sign(quote.price - before));
      if (quote.symbol === selected) refreshDetail(quote);
    }
    changed.clear();
    renderLivePanel();
  }, 1000);

  // ---------- カード ----------

  function tileContent(quote) {
    const lastMonth = quote.history.slice(-22).map((row) => toCandle(row).close);
    return [
      h('span', { class: 'tile-name' },
        h('span', { class: 'tile-label' }, quote.name),
        quote.live && h('span', { class: 'live-badge' }, 'LIVE'),
        quote.trending && h('span', { class: 'badge', title: '米国の Yahoo!ファイナンスで話題の銘柄' }, '話題')),
      ticker(quote.symbol) && h('span', { class: 'tile-symbol' }, ticker(quote.symbol)),
      h('span', { class: 'tile-price' }, price(quote)),
      delta(quote),
      sparkline(lastMonth),
      quote.stale && h('span', { class: 'tile-stale' }, '前回のデータ'),
    ].filter(Boolean);
  }

  function tile(quote) {
    return h('button', {
      type: 'button',
      class: `tile${quote.symbol === selected ? ' is-selected' : ''}`,
      'aria-pressed': String(quote.symbol === selected),
      dataset: { symbol: quote.symbol },
      onclick: () => {
        selected = quote.symbol;
        // 接続中に米国株を選んだら、最初は5秒足で見せる（期間を自分で変えていたらそのまま）
        if (range === '1日' && isLiveSymbol(quote.symbol)) range = '5秒足';
        render();
        if (matchMedia('(max-width: 720px)').matches) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
    }, tileContent(quote));
  }

  /** ボタン自体は残して中身だけ入れ替える（キーボードで選んでいる位置が外れないように） */
  function refreshTile(quote, move) {
    const el = root.querySelector(`.tile[data-symbol="${CSS.escape(quote.symbol)}"]`);
    if (!el) return;
    el.replaceChildren(...tileContent(quote));
    if (move) el.querySelector('.tile-price').classList.add(move > 0 ? 'flash-up' : 'flash-down');
  }

  // ---------- 選んだ銘柄の詳細 ----------

  /** その銘柄で選べる期間（5秒足・1分足は Finnhub 接続中の米国株だけ） */
  function rangesFor(quote) {
    return RANGES.filter((r) => !r.tick || isLiveSymbol(quote.symbol));
  }

  function detailNumbers(quote) {
    let choice = rangesFor(quote).find((r) => r.name === range);
    if (!choice) {
      range = '1日';
      choice = RANGES.find((r) => r.name === range);
    }
    if (choice.tick) {
      const rows = [...(tickBars.get(quote.symbol)?.[choice.tick]?.values() ?? [])].sort((a, b) => a[0] - b[0]);
      const base = rows.length ? rows[0][1] : null;
      const lastClose = rows.length ? rows.at(-1)[4] : null;
      const periodChange = base && lastClose != null ? ((lastClose - base) / base) * 100 : 0;
      const time = (t) => clockSeconds.format(new Date(t * 1000));
      const format = {
        rowLabel: time, header: '時刻', changeLabel: '前の足から',
        tableTitle: `表で見る（直近20本・${range}）`,
        periodLabel: '表示中の足で ',
        emptyNote: '取引が届くと、ここに足が増えていきます（米国市場の取引時間外は動きません）',
        chart: { labelOf: time, tickOf: time, changeLabel: '前の足から' },
      };
      return { rows, before: null, periodChange, format };
    }
    if (choice.intraday) {
      const { bars = [], offset = 0 } = quote.intraday ?? {};
      let rows = bars;
      // 1日: いちばん新しい取引日の足だけ。変化は前日終値と比べる。5日: 最初の足の始値と比べる
      let base = rows.length ? rows[0][1] : null;
      if (choice.intraday === 'day' && bars.length) {
        const lastDay = sessionDay(bars.at(-1)[0], offset);
        rows = bars.filter((b) => sessionDay(b[0], offset) === lastDay);
        base = quote.prev;
      }
      const lastClose = rows.length ? rows.at(-1)[4] : null;
      const periodChange = base && lastClose != null ? ((lastClose - base) / base) * 100 : 0;
      const format = {
        ...INTRADAY_FORMAT,
        chart: {
          labelOf: barLabel,
          tickOf: choice.intraday === 'day' ? (t) => hourMinute.format(new Date(t * 1000)) : (t) => formatDay(sessionDay(t, offset)).replace(/\(.\)/, ''),
          changeLabel: INTRADAY_FORMAT.changeLabel,
        },
      };
      return { rows, before: choice.intraday === 'day' ? base : null, periodChange, format };
    }
    // ここから日足
    const days = choice.days;
    const start = Math.max(0, quote.history.length - days);
    const rows = quote.history.slice(start);
    // 期間の変化は、期間が始まる前日の終値と最新の終値を比べる
    const before = start > 0 ? toCandle(quote.history[start - 1]).close : toCandle(rows[0]).open;
    const last = rows.length ? toCandle(rows.at(-1)).close : before;
    const periodChange = before ? ((last - before) / before) * 100 : 0;
    return { rows, before: start > 0 ? before : null, periodChange, format: DAILY_FORMAT };
  }

  function timeText(quote) {
    if (quote.live) return `${clockFormat.format(new Date(quote.time))} 時点（リアルタイム）`;
    return [quote.time ? `${formatDateTime(quote.time)} 時点` : '', quote.stale ? '（更新できなかったため前回のデータ）' : ''].join('');
  }

  function renderDetail() {
    const quote = all().find((q) => q.symbol === selected) ?? data.indices[0] ?? data.jp[0];
    if (!quote) {
      detail.replaceChildren();
      detailParts = null;
      return;
    }
    const { rows, before, periodChange, format } = detailNumbers(quote);
    detailParts = {
      price: h('p', { class: 'detail-price' }, price(quote)),
      delta: h('span', {}, delta(quote)),
      time: h('p', { class: 'detail-time' }, timeText(quote)),
      period: h('span', { class: `delta ${direction(periodChange)}` }, `${formatSigned(periodChange, 2)}%`),
      table: table(quote, rows, format),
      chartNote: h('p', { class: 'chart-note', hidden: rows.length > 0 }, format.emptyNote ?? '日中の値動きのデータがまだありません（次の更新で表示されます）'),
      periodLabel: h('span', {}, format.periodLabel ?? `${range}で `),
    };
    detail.replaceChildren(
      h('div', { class: 'detail-head' },
        h('div', {},
          h('h4', { class: 'detail-name' }, quote.name,
            ticker(quote.symbol) && h('span', { class: 'tile-symbol' }, ticker(quote.symbol))),
          detailParts.price,
          h('p', { class: 'detail-delta' }, h('span', { class: 'detail-label' }, '前日比'), detailParts.delta),
          detailParts.time),
        h('div', { class: 'detail-controls' },
          h('div', { class: 'filters', role: 'group', 'aria-label': '期間' },
            rangesFor(quote).map(({ name, tick }) => h('button', {
              type: 'button', class: `chip-button${tick ? ' chip-button--live' : ''}`, 'aria-pressed': String(name === range),
              onclick: () => { range = name; renderDetail(); },
            }, name))),
          h('p', { class: 'detail-period' }, detailParts.periodLabel, detailParts.period))),
      detailParts.chartNote,
      chartBox,
      detailParts.table,
    );
    chart.set(rows, {
      unit: quote.unit, decimals: quote.decimals, before, ...format.chart,
      label: `${quote.name}の${range}のローソク足`,
    });
  }

  /** リアルタイム更新: 数字・グラフ・表だけを差し替える（開いている表やグラフで選んだ日付はそのまま） */
  function refreshDetail(quote) {
    if (!detailParts) return;
    const { rows, before, periodChange, format } = detailNumbers(quote);
    detailParts.chartNote.hidden = rows.length > 0;
    detailParts.price.replaceChildren(...price(quote).filter(Boolean));
    detailParts.delta.replaceChildren(delta(quote));
    detailParts.time.textContent = timeText(quote);
    detailParts.period.className = `delta ${direction(periodChange)}`;
    detailParts.period.textContent = `${formatSigned(periodChange, 2)}%`;
    const newTable = table(quote, rows, format);
    newTable.open = detailParts.table.open;
    detailParts.table.replaceWith(newTable);
    detailParts.table = newTable;
    chart.set(rows, { unit: quote.unit, decimals: quote.decimals, before, keepActive: true, ...format.chart });
  }

  function table(quote, history, format) {
    const candles = history.slice(-21).map(toCandle);
    const d = quote.decimals;
    const rows = candles.slice(1).reverse().map((c, i, arr) => {
      const before = (arr[i + 1] ?? candles[0]).close;
      return h('tr', {},
        h('th', { scope: 'row' }, format.rowLabel(c.day)),
        h('td', {}, formatNumber(c.open, d)),
        h('td', {}, formatNumber(c.high, d)),
        h('td', {}, formatNumber(c.low, d)),
        h('td', {}, formatNumber(c.close, d)),
        h('td', { class: `delta ${direction(c.close - before)}` },
          `${formatSigned(((c.close - before) / before) * 100, 2)}%`));
    });
    return h('details', { class: 'detail-table' },
      h('summary', {}, format.tableTitle),
      h('table', {},
        h('thead', {}, h('tr', {}, ...[format.header, '始値', '高値', '安値', '終値', format.changeLabel].map((t) => h('th', { scope: 'col' }, t)))),
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

  // 切断したときに、1時間ごとのデータへ戻すための元データ
  let original = null;
  function refresh() {
    if (original) api.update(original);
  }

  const api = {
    update(next) {
      original = next;
      // 重ねたリアルタイムの値が元データに残らないよう、写しを使う
      const copy = (list) => (list ?? []).map((q) => ({
        ...q,
        history: q.history.slice(),
        intraday: q.intraday && { ...q.intraday, bars: q.intraday.bars.slice() },
      }));
      data = { indices: copy(next.indices), jp: copy(next.jp), us: copy(next.us) };
      // 1時間ごとのデータを読み直しても、受け取り済みのリアルタイムの値は重ね直す
      for (const quote of data.us) {
        const candle = liveCandles.get(quote.symbol);
        if (candle) applyLive(quote, candle);
        applyLiveBars(quote);
      }
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
  return api;
}
