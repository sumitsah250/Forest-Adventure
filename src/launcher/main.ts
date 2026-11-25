// The site's front page and the installed app's home screen.
//
// Opens like a film: the letterbox bars part on Campus Quest's trailer, filmed in the game itself
// (scripts/capture-trailer.mjs), with the story clock and a caption following each shot through the night.
//
// In a browser it only offers to install the app (there is no play-in-browser option); below the trailer, the
// night's missions on a timeline and the install again. Opened as the installed app, it is just the trailer and
// the download: it downloads the enabled games' files to the device once (with progress), then offers Play; from
// then on the games load from the device. Which games are offered is set in src/games.ts.

import './launcher.css';
import { ENABLED_GAMES as GAMES, type GameEntry, type StoryBeat, type Trailer } from '../games.ts';
import { canPrompt, initPwa, install, isIos, isStandalone, onInstallChange, wasJustInstalled } from '../pwa.ts';
import TIMING from './trailer.json';

initPwa();

interface OfflineList {
  version: string;
  files: [path: string, hash: string, size: number][];
}

const ASSET_CACHE = 'hc-assets-v1';
const DONE_KEY = 'sumix.offline.version';
const single = GAMES.length === 1;
const appName = single ? GAMES[0].name : 'Sumix Games';
/** True for files the enabled games need. */
const wanted = (path: string) => GAMES.some((g) => g.assets.some((a) => (a.endsWith('/') ? path.startsWith(a) : path === a)));
const params = new URLSearchParams(location.search);
const appMode = isStandalone() || params.has('app');
const base = new URL('./', location.href);

const lead = GAMES[0];
const film: Trailer | undefined = GAMES.find((g) => g.trailer)?.trailer;
const beats: StoryBeat[] = single ? (lead.beats ?? []) : [];
const credit = GAMES.some((g) => g.id === 'campus')
  ? '<p>Campus map © OpenStreetMap contributors (ODbL). Building footprints © Microsoft (ODbL). Elevation: SRTM.</p><p>A fan game: the story is fictional, and the campus has not endorsed it.</p>'
  : '';
// The gate sign's top line, as painted on the gate in the game (src/campus/world.ts).
const GATE_LINE = 'त्रिभुवन विश्वविद्यालय · इन्जिनियरिङ अध्ययन संस्थान';

const DOWNLOAD_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v8.2M4.6 6.6 8 10l3.4-3.4M2.5 11.5v2h11v-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.8v10.4L13 8z" fill="currentColor"/></svg>';

// ------------------------------------------------------------------ page

const filmHtml = (t: Trailer) => `
      <div class="lx-film" aria-hidden="true">
        <div class="lx-film__slides">${t.scenes.map((s) => `<img src="${s.still}" alt="" decoding="async" loading="lazy" />`).join('')}</div>
        <img class="lx-film__poster" src="${t.poster}" alt="" fetchpriority="high" />
        <video class="lx-film__video" muted playsinline loop preload="none" disablepictureinpicture></video>
      </div>`;

const beatHtml = (b: StoryBeat) => `
        <li class="lx-beat" data-sky="${b.sky}">
          <p class="lx-beat__clock"><time>${b.clock}</time></p>
          <img class="lx-beat__still" src="${b.still}" alt="${b.alt}" width="1600" height="900" loading="lazy" decoding="async" />
          <div class="lx-beat__text">
            <h3 class="lx-beat__title">${b.title}</h3>
            <p class="lx-beat__place">${b.place}</p>
            <p>${b.text}</p>
          </div>
        </li>`;

// With several games each gets a card with its own Play; with one, Play sits under the trailer's install panel.
const cardHtml = (g: GameEntry) => `
        <article class="lx-card">
          <img class="lx-card__icon" src="${g.icon}" alt="" width="56" height="56" />
          <div>
            <h3 class="lx-card__name">${g.name}</h3>
            <p class="lx-card__blurb">${g.blurb}</p>
          </div>
          <a class="lx-play" href="${g.href}" aria-disabled="true">Play</a>
        </article>`;

const root = document.getElementById('launcher') as HTMLDivElement;
root.innerHTML = `
  <main class="lx ${appMode ? 'lx--app' : 'lx--web'}">
    <section class="lx-hero ${film ? 'lx-hero--film' : ''}" aria-labelledby="lx-name">
      ${film ? filmHtml(film) : ''}
      <div class="lx-shutter lx-shutter--top" aria-hidden="true"></div>
      <div class="lx-shutter lx-shutter--bottom" aria-hidden="true"></div>
      <header class="lx-bar lx-bar--top">
        <p class="lx-studio">Sumix Developers presents</p>
        ${film ? '<p class="lx-clock" aria-hidden="true"><span class="lx-clock__hm"></span><span class="lx-clock__ap"></span></p>' : ''}
      </header>
      <div class="lx-hero__body">
        <h1 class="lx-name" id="lx-name">${single ? lead.name : 'Sumix Games'}</h1>
        ${single && lead.story ? `<p class="lx-story">${lead.story}</p>` : ''}
        ${single && lead.place ? `<p class="lx-place">${lead.place}</p>` : ''}
        <p class="lx-intro">${single ? (lead.intro ?? lead.blurb) : 'Install once and the games download to your device. They open full screen, load fast and play offline.'}</p>
        <div class="lx-get">
          <h2 class="lx-get__title"></h2>
          <p class="lx-get__lede"></p>
          <div class="lx-action" aria-live="polite"></div>
          ${single ? `<a class="lx-play" href="${lead.href}" aria-disabled="true">Play</a>` : ''}
        </div>
      </div>
      <footer class="lx-bar lx-bar--bottom">
        ${film ? `<p class="lx-caption" aria-hidden="true"></p>
        <button class="lx-toggle" type="button" aria-label="Pause the trailer">${PAUSE_ICON}</button>` : ''}
      </footer>
    </section>
    ${single ? '' : `<section class="lx-games" aria-label="Games">${GAMES.map(cardHtml).join('')}</section>`}
    ${appMode || !beats.length ? '' : `
    <section class="lx-night" aria-labelledby="lx-night">
      <div class="lx-night__head">
        <h2 id="lx-night">One night on campus</h2>
        <p>From the blackout at ${beats[0].clock} to sunrise over Machhapuchhre, mission by mission. Clear your name before the paper leaks at 9 AM.</p>
      </div>
      <ol class="lx-beats">${beats.map(beatHtml).join('')}
      </ol>
    </section>`}
    ${appMode ? '' : `
    <section class="lx-gate" aria-labelledby="lx-gate">
      ${film ? `<img class="lx-gate__bg" src="${film.scenes[0].still}" alt="" loading="lazy" decoding="async" />` : ''}
      <div class="lx-sign">
        ${single && lead.id === 'campus' ? `<p class="lx-sign__deva" lang="ne">${GATE_LINE}</p>` : ''}
        <h2 class="lx-sign__name" id="lx-gate">${appName}</h2>
        <p class="lx-sign__lede">Install it once. It downloads to your device, then opens full screen and plays offline.</p>
        <div class="lx-action" aria-live="polite"></div>
      </div>
    </section>`}
    <footer class="lx-foot">
      <p>© Sumix Developers. Runs on your device and plays offline once downloaded.</p>
      ${credit}
    </footer>
  </main>`;

const title = root.querySelector('.lx-get__title') as HTMLHeadingElement;
const lede = root.querySelector('.lx-get__lede') as HTMLParagraphElement;
const actions = [...root.querySelectorAll<HTMLDivElement>('.lx-action')];
const action = actions[0];
const plays = [...root.querySelectorAll<HTMLAnchorElement>('.lx-play')];

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;

/** Same state in every install panel (under the trailer and at the gate). */
function setAction(html: string, onInstall?: () => void): void {
  for (const a of actions) {
    a.innerHTML = html;
    const b = a.querySelector<HTMLButtonElement>('button[data-install]');
    if (b && onInstall) b.onclick = onInstall;
  }
}

function setPlayable(on: boolean, label = 'Play'): void {
  for (const a of plays) {
    a.setAttribute('aria-disabled', on ? 'false' : 'true');
    a.tabIndex = on ? 0 : -1;
    a.textContent = label;
  }
}
for (const a of plays) a.addEventListener('click', (e) => a.getAttribute('aria-disabled') === 'true' && e.preventDefault());

// ------------------------------------------------------------------ the trailer, the clock and the captions

if (film) playTrailer(film);

function playTrailer(t: Trailer): void {
  const hero = root.querySelector('.lx-hero') as HTMLElement;
  const box = root.querySelector('.lx-film') as HTMLDivElement;
  const video = root.querySelector('.lx-film__video') as HTMLVideoElement;
  const slides = [...root.querySelectorAll<HTMLImageElement>('.lx-film__slides img')];
  const hm = root.querySelector('.lx-clock__hm') as HTMLSpanElement;
  const ap = root.querySelector('.lx-clock__ap') as HTMLSpanElement;
  const caption = root.querySelector('.lx-caption') as HTMLParagraphElement;
  const toggle = root.querySelector('.lx-toggle') as HTMLButtonElement;

  // Shot start times from the film, matched to the captions by shot name.
  const starts = t.scenes.map((s) => TIMING.shots.find((x) => x.name === s.shot)?.start ?? 0);
  const sceneAt = (sec: number) => starts.reduce((n, st, i) => (sec >= st ? i : n), 0);
  const minutes = (clock: string) => {
    const [, h, m, p] = /(\d+):(\d+)\s*([AP]M)/.exec(clock) ?? [, '0', '0', 'AM'];
    return ((Number(h) % 12) + (p === 'PM' ? 12 : 0)) * 60 + Number(m);
  };
  const showClock = (m: number) => {
    const h = Math.floor(m / 60) % 24;
    hm.textContent = `${h % 12 || 12}:${String(m % 60).padStart(2, '0')}`;
    ap.textContent = h < 12 ? 'AM' : 'PM';
  };

  // The clock runs forward through the night to each shot's time, like the game's own spinning clock.
  let shown = minutes(t.scenes[0].clock);
  let spin = 0;
  let scene = -1;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enter = (i: number) => {
    if (i === scene) return;
    const back = i < scene;
    scene = i;
    caption.classList.remove('is-on');
    window.setTimeout(() => {
      caption.textContent = t.scenes[scene].line;
      caption.classList.add('is-on');
    }, 180);
    hero.dataset.scene = t.scenes[i].shot;
    let to = minutes(t.scenes[i].clock);
    cancelAnimationFrame(spin);
    if (back || reduce) {
      // Looping back to the start: no spinning all the way round to the evening again.
      shown = to;
      showClock(shown);
      return;
    }
    if (to < shown) to += 24 * 60;
    const from = shown;
    const t0 = performance.now();
    const run = (now: number) => {
      const k = Math.min(1, (now - t0) / 900);
      shown = Math.round(from + (to - from) * (1 - (1 - k) ** 3)) % (24 * 60);
      showClock(shown);
      if (k < 1) spin = requestAnimationFrame(run);
    };
    spin = requestAnimationFrame(run);
  };
  showClock(shown);

  // The film where the browser plays WebM (VP9); elsewhere, or on Data Saver, its stills one after another
  // on the same clock. Reduced motion: nothing moves until the visitor presses play.
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  let mode: 'video' | 'slides' = video.canPlayType('video/webm; codecs="vp9"') !== '' && !conn?.saveData ? 'video' : 'slides';
  let userPaused = reduce;
  let visible = true;
  let slideT = TIMING.posterAt;
  let slideTimer = 0;
  let lastTick = 0;

  const slideTick = () => {
    const now = performance.now();
    slideT = (slideT + (now - lastTick) / 1000) % TIMING.duration;
    lastTick = now;
    const i = sceneAt(slideT);
    slides.forEach((s, k) => s.classList.toggle('is-on', k === i));
    enter(i);
  };
  const sync = () => {
    const go = visible && !userPaused;
    toggle.innerHTML = userPaused ? PLAY_ICON : PAUSE_ICON;
    toggle.setAttribute('aria-label', userPaused ? 'Play the trailer' : 'Pause the trailer');
    if (mode === 'video') {
      if (go && video.paused) {
        video.preload = 'auto';
        // Blocked autoplay (an iPhone in Low Power Mode) or no decoder after all: the stills instead.
        video.play().catch((e: unknown) => e instanceof DOMException && e.name !== 'AbortError' && toSlides());
      } else if (!go && !video.paused) video.pause();
    } else if (go && !slideTimer) {
      lastTick = performance.now();
      slideTimer = window.setInterval(slideTick, 200);
    } else if (!go && slideTimer) {
      clearInterval(slideTimer);
      slideTimer = 0;
    }
  };
  const toSlides = () => {
    if (mode === 'slides') return;
    mode = 'slides';
    slideT = video.currentTime || TIMING.posterAt;
    video.removeAttribute('src');
    video.remove();
    box.classList.remove('is-playing');
    startSlides();
  };
  const startSlides = () => {
    box.classList.add('is-slides');
    for (const s of slides) s.loading = 'eager';
    lastTick = performance.now();
    slideTick();
    sync();
  };

  if (mode === 'video') {
    video.poster = t.poster;
    video.src = t.video;
    // Starts where the poster was taken, so the poster gives way to the same picture.
    video.addEventListener('loadedmetadata', () => (video.currentTime = TIMING.posterAt), { once: true });
    video.addEventListener('playing', () => box.classList.add('is-playing'));
    video.addEventListener('timeupdate', () => enter(sceneAt(video.currentTime)));
    video.addEventListener('error', toSlides);
    enter(sceneAt(TIMING.posterAt));
    sync();
  } else startSlides();

  toggle.addEventListener('click', () => {
    userPaused = !userPaused;
    sync();
  });
  // Off screen (scrolled past) it stops, and picks up again on the way back.
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    sync();
  }, { threshold: 0.15 }).observe(hero);
}

// ------------------------------------------------------------------ browser: install only

async function offlineList(): Promise<OfflineList | null> {
  try {
    const res = await fetch('offline.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const list = (await res.json()) as OfflineList;
    return { version: `${list.version}:${GAMES.map((g) => g.id).join(',')}`, files: list.files.filter((f) => wanted(f[0])) };
  } catch {
    return null;
  }
}

function webMode(): void {
  let sizeNote = 'Free';
  void offlineList().then((list) => {
    if (!list) return;
    sizeNote = `Free · about ${mb(list.files.reduce((s, f) => s + f[2], 0))} to download after installing`;
    render();
  });
  let unavailable = false;
  const render = () => {
    setPlayable(false);
    if (wasJustInstalled()) {
      setAction(`<div class="lx-done"><b>Installed ✓</b> Open <b>${appName}</b> from your home screen or app list. It downloads ${single ? 'the game' : 'the games'} the first time it opens.</div>`);
      return;
    }
    if (canPrompt() || isIos) {
      setAction(`<button class="lx-btn" type="button" data-install>${DOWNLOAD_ICON}<span>${isIos ? 'Install on iPhone or iPad' : `Install ${appName}`}</span></button><p class="lx-note">${sizeNote}</p>`, () => void install().then(render));
      return;
    }
    if (!unavailable) {
      setAction(`<button class="lx-btn" type="button" disabled><span class="lx-spin"></span><span>Getting ready…</span></button><p class="lx-note">${sizeNote}</p>`);
      return;
    }
    // Install only: no "play in the browser" fallback, so the game always runs from the
    // device (downloaded once) instead of being served again on every visit.
    setAction(`
      <div class="lx-note lx-note--box">
        <b>This browser can’t install apps.</b> Open this page in <b>Chrome</b> or <b>Edge</b> (Android, Windows, Mac) or <b>Safari</b> (iPhone, iPad).
        Already installed? Open <b>${appName}</b> from your apps.
      </div>`);
  };
  onInstallChange(render);
  window.setTimeout(() => {
    unavailable = true;
    render();
  }, 3500);
  render();
}

// ------------------------------------------------------------------ installed app: download, then play

function appMode_(): void {
  const panel = () => {
    action.innerHTML = `
      <div class="lx-dl">
        <div class="lx-dl__head"><b class="lx-dl__state">Preparing download</b><span class="lx-dl__pct">0%</span></div>
        <div class="lx-dl__bar"><span></span></div>
        <div class="lx-dl__meta"></div>
      </div>`;
  };
  const ready = () => {
    title.textContent = single ? 'Ready to play' : 'Pick a game';
    lede.textContent = single ? `${appName} is on your device. It loads from here, even without internet.` : 'Everything is on your device. Games load from here, even without internet.';
    action.innerHTML = `<div class="lx-done"><b>Downloaded ✓</b> ${single ? 'Tap Play to start.' : 'All games are on this device.'}</div>`;
    setPlayable(true);
  };

  title.textContent = single ? 'Getting the game ready' : 'Getting your games ready';
  // No need to wait: the service worker stores every file the game loads under the same key as this download, so
  // playing now saves what it uses and the next launch only fetches what is still missing.
  lede.textContent = 'A one-time download so it plays offline. You can start now: whatever is still missing loads as you play.';
  setPlayable(true, 'Play now');
  panel();

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await downloadAll();
      ready();
    } catch (err) {
      const storage = err instanceof DOMException && err.name === 'QuotaExceededError';
      (action.querySelector('.lx-dl__state') as HTMLElement).textContent = storage ? 'Not enough storage space' : 'Download paused';
      const meta = action.querySelector('.lx-dl__meta') as HTMLElement;
      meta.innerHTML = `${storage ? 'Free up some space on this device, then' : 'Check your internet connection, then'} <button class="lx-link" type="button">try again</button>. Finished files are kept.`;
      (meta.querySelector('button') as HTMLButtonElement).onclick = () => {
        panel();
        void run();
      };
    } finally {
      running = false;
    }
  };
  window.addEventListener('online', () => void run());
  void run();
}

async function downloadAll(): Promise<void> {
  const list = await offlineList();
  if (!list) {
    // Offline: fine if a previous launch finished the download.
    if (store(DONE_KEY)) return;
    throw new Error('offline');
  }
  void (navigator.storage as StorageManager | undefined)?.persist?.();
  const cache = await caches.open(ASSET_CACHE);
  const key = (path: string, hash: string) => new URL(`${path}?v=${hash}`, base).href;
  const total = list.files.reduce((s, f) => s + f[2], 0);
  let done = 0;
  const missing: OfflineList['files'] = [];
  for (const f of list.files) {
    if (await cache.match(key(f[0], f[1]), { ignoreVary: true })) done += f[2];
    else missing.push(f);
  }

  const state = action.querySelector('.lx-dl__state') as HTMLElement;
  const pct = action.querySelector('.lx-dl__pct') as HTMLElement;
  const bar = action.querySelector('.lx-dl__bar span') as HTMLElement;
  const meta = action.querySelector('.lx-dl__meta') as HTMLElement;
  let queued = false;
  const paint = () => {
    queued = false;
    const f = total ? done / total : 1;
    pct.textContent = `${Math.floor(f * 100)}%`;
    bar.style.transform = `scaleX(${f})`;
    meta.textContent = `${mb(done)} of ${mb(total)}`;
  };
  const update = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(paint);
    }
  };
  state.textContent = missing.length ? (single ? `Downloading ${appName}` : 'Downloading games') : 'Checking files';
  paint();

  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const [path, hash, size] = missing[next++];
      for (let attempt = 1; ; attempt++) {
        try {
          // The header tells the service worker to stay out of the way; this page stores the file itself.
          const res = await fetch(new URL(path, base), { cache: 'no-cache', headers: { 'x-sumix-download': '1' } });
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
          await cache.put(key(path, hash), res);
          break;
        } catch (err) {
          if ((err instanceof DOMException && err.name === 'QuotaExceededError') || attempt >= 3) throw err;
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      }
      done += size;
      update();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  paint();
  store(DONE_KEY, list.version);
}

/** localStorage that tolerates being unavailable (private mode). */
function store(k: string, v?: string): string | null {
  try {
    if (v !== undefined) localStorage.setItem(k, v);
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

if (appMode) appMode_();
else webMode();
