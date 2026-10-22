// 3D の地球儀（globe.gl）。ニュースの場所を点で表示し、選ぶとそこまで飛んでいく。

import { h, reducedMotion } from './util.js';

const TEXTURES = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.3/example/img/';

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * @param {HTMLElement} container 地球儀を入れる空の要素
 * @param {{ onSelectPlace: (key: string) => void }} options
 */
export function createGlobe(container, { onSelectPlace }) {
  const panel = container.parentElement;
  if (typeof window.Globe !== 'function' || !hasWebGL()) {
    panel.classList.add('is-unavailable');
    container.replaceChildren(h('p', { class: 'globe-message' }, 'この端末では地球儀を表示できませんでした。ニュースの一覧は下で見られます。'));
    return null;
  }

  let places = [];
  let here = null;
  let selectedKey = null;

  const globe = new window.Globe(container, { animateIn: !reducedMotion })
    .globeImageUrl(`${TEXTURES}earth-blue-marble.jpg`)
    .bumpImageUrl(`${TEXTURES}earth-topology.png`)
    .backgroundColor('rgba(0,0,0,0)')
    .atmosphereColor('#8ab8ff')
    .atmosphereAltitude(0.16)
    .htmlLat('lat')
    .htmlLng('lng')
    .htmlAltitude(0.01)
    .htmlElement('el')
    .htmlTransitionDuration(0)
    .ringLat('lat')
    .ringLng('lng')
    .ringColor(() => (t) => `rgba(255, 214, 160, ${1 - t})`)
    .ringMaxRadius(4.5)
    .ringPropagationSpeed(2.5)
    .ringRepeatPeriod(reducedMotion ? 0 : 900)
    .onGlobeReady(() => panel.classList.add('is-ready'));

  globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const controls = globe.controls();
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.35;
  // 触ったら自動回転を止める
  container.addEventListener('pointerdown', () => { controls.autoRotate = false; });
  globe.pointOfView({ lat: 28, lng: 138, altitude: 2.4 });

  new ResizeObserver(() => {
    globe.width(container.clientWidth).height(container.clientHeight);
  }).observe(container);

  // 画面の外にあるときは描画を止めて、電池を節約する
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) globe.resumeAnimation();
    else globe.pauseAnimation();
  }).observe(container);

  function markerFor(place) {
    const size = Math.round(12 + Math.min(place.count, 9) * 2.2);
    const el = h('button', {
      type: 'button',
      class: `marker${place.key === selectedKey ? ' is-selected' : ''}${place.approx ? ' is-approx' : ''}`,
      style: `--size:${size}px`,
      'aria-label': `${place.label}のニュース ${place.count}件`,
      title: `${place.label}（${place.count}件）`,
      onclick: (event) => {
        event.stopPropagation();
        onSelectPlace(place.key);
      },
    }, h('span', { class: 'marker-dot' }));
    return { lat: place.lat, lng: place.lng, el };
  }

  function redraw() {
    const markers = places.map(markerFor);
    if (here) {
      markers.push({
        lat: here.lat,
        lng: here.lng,
        el: h('span', { class: 'marker marker--here', title: `現在地: ${here.name}` }, h('span', { class: 'marker-dot' })),
      });
    }
    globe.htmlElementsData(markers);
    const selected = places.find((p) => p.key === selectedKey);
    globe.ringsData(selected ? [{ lat: selected.lat, lng: selected.lng }] : []);
  }

  return {
    /** @param {{key, lat, lng, label, count, approx}[]} next */
    setPlaces(next) {
      places = next;
      if (!places.some((p) => p.key === selectedKey)) selectedKey = null;
      redraw();
    },
    setHere(location) {
      here = location;
      redraw();
    },
    select(key, { fly = true } = {}) {
      selectedKey = key;
      redraw();
      const place = places.find((p) => p.key === key);
      if (place && fly) {
        controls.autoRotate = false;
        globe.pointOfView({ lat: place.lat, lng: place.lng, altitude: 1.6 }, reducedMotion ? 0 : 1600);
      }
    },
  };
}
