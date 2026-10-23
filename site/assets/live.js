// Finnhub を使った米国株のリアルタイム更新。
// APIキーはこのファイルの中の変数にだけ置き、localStorage・Cookie・URL には保存しない。
// ページを閉じるか再読み込みすると消える。

const REST_URL = 'https://finnhub.io/api/v1/quote';
const SOCKET_URL = 'wss://ws.finnhub.io';
const NEW_YORK_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** ミリ秒の時刻 → ニューヨーク時間の日付 "2026-10-22" */
export function newYorkDay(ms) {
  return NEW_YORK_DAY.format(new Date(ms));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 米国株の値動きを受け取る。
 * onCandle(symbol, { day, open, high, low, close, prevClose, time }) が値の変わるたびに呼ばれる。
 * onStatus(state, message) で接続の状態を知らせる（state: idle / connecting / live / error）。
 */
export class LiveFeed {
  constructor({ onCandle, onStatus }) {
    this.onCandle = onCandle;
    this.onStatus = onStatus;
    this.key = null;
    this.socket = null;
    this.candles = new Map();
    this.retries = 0;
  }

  get connected() {
    return this.key != null;
  }

  async connect(key, symbols) {
    this.disconnect();
    this.key = key;
    this.symbols = symbols;
    this.onStatus('connecting', '接続しています…');
    try {
      // まず今日の始値・高値・安値・現在値と前日終値を取る（キーが正しいかの確認も兼ねる）
      for (const symbol of symbols) {
        if (this.key !== key) return;
        await this.loadQuote(symbol);
        await wait(120); // 無料プランの回数制限（1分に60回）を超えないように
      }
    } catch (error) {
      if (this.key === key) {
        this.key = null;
        this.onStatus('error', error.message);
      }
      return;
    }
    this.openSocket();
  }

  disconnect() {
    this.key = null;
    this.candles.clear();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    clearTimeout(this.retryTimer);
    this.onStatus('idle', '');
  }

  async loadQuote(symbol) {
    const res = await fetch(`${REST_URL}?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(this.key)}`);
    if (res.status === 401 || res.status === 403) throw new Error('APIキーが正しくないようです');
    if (res.status === 429) throw new Error('Finnhub の回数制限に達しました。1分ほど待ってからもう一度接続してください');
    if (!res.ok) throw new Error(`Finnhub から読み込めませんでした（${res.status}）`);
    const q = await res.json();
    if (!q || !q.c || !q.t) return; // データがない銘柄は飛ばす
    const candle = {
      day: newYorkDay(q.t * 1000),
      open: q.o || q.c, high: q.h || q.c, low: q.l || q.c, close: q.c,
      prevClose: q.pc || null, time: q.t * 1000,
    };
    this.candles.set(symbol, candle);
    this.onCandle(symbol, { ...candle });
  }

  openSocket() {
    const key = this.key;
    const socket = new WebSocket(`${SOCKET_URL}?token=${encodeURIComponent(key)}`);
    this.socket = socket;
    socket.onopen = () => {
      this.retries = 0;
      for (const symbol of this.symbols) socket.send(JSON.stringify({ type: 'subscribe', symbol }));
      this.onStatus('live', '');
    };
    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'trade') {
        for (const trade of message.data ?? []) this.applyTrade(trade);
      } else if (message.type === 'error') {
        this.onStatus('error', `Finnhub: ${message.msg}`);
      }
    };
    socket.onclose = () => {
      if (this.key !== key) return;
      // 切れたら少し待ってつなぎ直す（何度も失敗したらあきらめる）
      this.retries += 1;
      if (this.retries > 5) {
        this.key = null;
        this.onStatus('error', '接続が切れました。もう一度「接続」を押してください');
        return;
      }
      this.onStatus('connecting', 'つなぎ直しています…');
      this.retryTimer = setTimeout(() => this.key === key && this.openSocket(), 3000 * this.retries);
    };
  }

  applyTrade({ s: symbol, p: price, t: time }) {
    if (!symbol || !price || !time) return;
    const day = newYorkDay(time);
    const old = this.candles.get(symbol);
    let candle;
    if (old && old.day === day && time < old.time) {
      // 遅れて届いた取引は、高値・安値だけに使う
      candle = { ...old, high: Math.max(old.high, price), low: Math.min(old.low, price) };
    } else if (old && old.day === day) {
      candle = { ...old, high: Math.max(old.high, price), low: Math.min(old.low, price), close: price, time };
    } else {
      // 新しい日の最初の取引: 前の日の終値が前日終値になる
      candle = { day, open: price, high: price, low: price, close: price, prevClose: old?.close ?? null, time };
    }
    this.candles.set(symbol, candle);
    this.onCandle(symbol, { ...candle });
  }
}
