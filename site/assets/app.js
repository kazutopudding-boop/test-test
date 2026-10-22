// ページ全体の起動。データ（data/*.json）は GitHub Actions が1時間ごとに作り直す。

import { getJSON, formatDateTime } from './util.js';
import { initWeather } from './weather.js';
import { createGlobe } from './globe.js';
import { initNews } from './news.js';
import { initStocks } from './stocks.js';

let news;
const globe = createGlobe(document.getElementById('globe'), {
  onSelectPlace: (key) => news.selectPlace(key),
});
news = initNews(document.getElementById('news'), globe);
const stocks = initStocks(document.getElementById('stocks'));
initWeather(document.getElementById('weather'), { onLocation: (where) => globe?.setHere(where) });

const updated = document.getElementById('updated');

async function refresh() {
  const [newsData, stockData] = await Promise.allSettled([
    getJSON('data/news.json'),
    getJSON('data/stocks.json'),
  ]);
  if (newsData.status === 'fulfilled') news.update(newsData.value);
  else news.error(newsData.reason.message);
  if (stockData.status === 'fulfilled') stocks.update(stockData.value);
  else stocks.error(stockData.reason.message);

  const stamp = newsData.value?.updated ?? stockData.value?.updated;
  updated.textContent = stamp ? `ニュース・株価の更新: ${formatDateTime(stamp)}` : '';
}

refresh();
// 開いたままでも新しいデータに入れ替わるよう、10分ごとに読み直す
setInterval(() => document.visibilityState === 'visible' && refresh(), 10 * 60 * 1000);
