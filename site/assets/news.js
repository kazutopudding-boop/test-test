// ニュースの一覧と地球儀をつなぐ部分

import { h, safeUrl, formatAgo } from './util.js';

const CATEGORIES = ['すべて', '国内', '国際', '経済'];
const NEW_MINUTES = 60;

function placeKey(loc) {
  return `${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}`;
}

function placeLabel(loc) {
  if (loc.approx) return `${loc.name}（場所は推定）`;
  return loc.country && loc.country !== '日本' && loc.country !== loc.name ? `${loc.name}（${loc.country}）` : loc.name;
}

/** 同じ場所のニュースを1つの点にまとめる */
function groupByPlace(items) {
  const groups = new Map();
  for (const item of items) {
    if (!item.loc) continue;
    const key = placeKey(item.loc);
    const group = groups.get(key) ?? { key, lat: item.loc.lat, lng: item.loc.lng, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    // 名前は、推定ではない一番多い呼び方にする
    const named = group.items.filter((i) => !i.loc.approx);
    const source = named.length ? named : group.items;
    const counts = new Map();
    for (const item of source) counts.set(placeLabel(item.loc), (counts.get(placeLabel(item.loc)) ?? 0) + 1);
    const label = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    return { ...group, label, count: group.items.length, approx: named.length === 0 };
  });
}

export function initNews(root, globe) {
  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'ニュースの分類' });
  const status = h('p', { class: 'news-status' });
  const top = h('div', { class: 'top-story' });
  const list = h('ol', { class: 'news-list' });
  const card = root.querySelector('#globe-card');
  const legendCount = root.querySelector('#globe-count');
  root.querySelector('.news-filters').append(filters);
  root.querySelector('.news-feed').append(status, top, list);

  let items = [];
  let filter = 'すべて';
  let selectedId = null;
  let places = [];

  function visible() {
    return filter === 'すべて' ? items : items.filter((i) => i.category === filter);
  }

  function renderFilters() {
    filters.replaceChildren(...CATEGORIES.map((name) => {
      const count = name === 'すべて' ? items.length : items.filter((i) => i.category === name).length;
      return h('button', {
        type: 'button',
        class: 'chip-button',
        'aria-pressed': String(name === filter),
        onclick: () => {
          filter = name;
          if (selectedId && !visible().some((i) => i.id === selectedId)) selectedId = null;
          render();
        },
      }, name, h('span', { class: 'chip-count' }, count));
    }));
  }

  function badges(item) {
    const out = [];
    if (/速報/.test(item.title)) out.push(h('span', { class: 'badge badge--alert' }, '速報'));
    if (item.published && Date.now() - new Date(item.published) < NEW_MINUTES * 60000) {
      out.push(h('span', { class: 'badge' }, 'NEW'));
    }
    return out;
  }

  function meta(item) {
    const parts = [item.source, formatAgo(item.published)].filter(Boolean);
    if (item.related > 1) parts.push(`関連記事 ${item.related - 1}件`);
    return parts.join(' · ');
  }

  function row(item, { hero = false } = {}) {
    const url = safeUrl(item.url);
    const selected = item.id === selectedId;
    const where = item.loc ? placeLabel(item.loc) : '場所不明';
    return h(hero ? 'div' : 'li', { class: `news-item${hero ? ' news-item--hero' : ''}${selected ? ' is-selected' : ''}`, dataset: { id: item.id } },
      h('button', {
        type: 'button',
        class: 'news-select',
        'aria-pressed': String(selected),
        'aria-describedby': hero ? 'top-story-label' : null,
        onclick: () => select(item.id),
      },
      h('span', { class: 'news-tags' },
        h('span', { class: `chip chip--${item.category}` }, item.category),
        ...badges(item),
        h('span', { class: `news-place${item.loc ? '' : ' is-unknown'}` }, h('span', { 'aria-hidden': 'true' }, '📍'), where)),
      h('span', { class: 'news-title' }, item.title),
      h('span', { class: 'news-meta' }, meta(item))),
      url && h('a', {
        class: 'news-open', href: url, target: '_blank', rel: 'noopener noreferrer',
        'aria-label': `記事を開く: ${item.title}`, title: '記事を開く',
      }, '↗'),
    );
  }

  function renderList() {
    const shown = visible();
    const headline = filter === 'すべて' ? items.find((i) => i.rank === 1) : null;
    top.replaceChildren(...(headline ? [
      h('p', { class: 'top-story-label', id: 'top-story-label' }, 'いちばんのニュース'),
      row(headline, { hero: true }),
    ] : []));
    list.replaceChildren(...shown.filter((i) => i !== headline).map((item) => row(item)));
    if (!shown.length) list.replaceChildren(h('li', { class: 'empty' }, 'この分類のニュースはありません'));
  }

  function renderCard() {
    const item = items.find((i) => i.id === selectedId);
    if (!item) {
      card.hidden = true;
      return;
    }
    const group = item.loc ? places.find((p) => p.key === placeKey(item.loc)) : null;
    const others = group ? group.items.filter((i) => i.id !== item.id).slice(0, 3) : [];
    const link = (i, cls) => {
      const url = safeUrl(i.url);
      return url
        ? h('a', { class: cls, href: url, target: '_blank', rel: 'noopener noreferrer' }, i.title)
        : h('span', { class: cls }, i.title);
    };
    card.replaceChildren(...[
      h('div', { class: 'globe-card-head' },
        h('span', { class: 'globe-card-place' }, h('span', { 'aria-hidden': 'true' }, '📍 '),
          group ? `${group.label} · ${group.count}件` : '場所を特定できませんでした'),
        h('button', { type: 'button', class: 'globe-card-close', 'aria-label': '閉じる', onclick: () => select(null) }, '×')),
      link(item, 'globe-card-title'),
      h('p', { class: 'globe-card-meta' }, meta(item)),
      others.length && h('ul', { class: 'globe-card-others', 'aria-label': '同じ場所のほかのニュース' },
        others.map((i) => h('li', {}, h('button', { type: 'button', onclick: () => select(i.id) }, i.title)))),
    ].filter(Boolean));
    card.hidden = false;
  }

  function render() {
    renderFilters();
    places = groupByPlace(visible());
    if (legendCount) legendCount.textContent = places.length ? `${places.length}か所` : '';
    globe?.setPlaces(places);
    const item = items.find((i) => i.id === selectedId);
    globe?.select(item?.loc ? placeKey(item.loc) : null, { fly: false });
    renderList();
    renderCard();
  }

  function select(id, { fly = true } = {}) {
    selectedId = id;
    const item = items.find((i) => i.id === id);
    for (const el of root.querySelectorAll('.news-item')) {
      const on = el.dataset.id === id;
      el.classList.toggle('is-selected', on);
      el.querySelector('.news-select').setAttribute('aria-pressed', String(on));
    }
    globe?.select(item?.loc ? placeKey(item.loc) : null, { fly });
    renderCard();
  }

  return {
    update(data) {
      items = (data.items ?? []).filter((i) => i && i.title);
      if (!items.some((i) => i.id === selectedId)) selectedId = null;
      status.textContent = items.length ? '' : 'ニュースがまだありません。';
      render();
    },
    error(message) {
      if (!items.length) status.textContent = `ニュースを読み込めませんでした（${message}）`;
    },
    /** 地球儀の点が押されたとき: その場所で一番上のニュースを選ぶ */
    selectPlace(key) {
      const group = places.find((p) => p.key === key);
      if (group) select(group.items[0].id, { fly: true });
    },
  };
}
