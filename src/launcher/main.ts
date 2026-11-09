// The site's front page and the installed app's home screen.
//
// In a browser it only offers to install "Sumix Games"; nothing heavy loads. Opened as
// the installed app, it downloads every game file to the device once (with progress),
// then lets the player pick a game, which from then on loads from the device.

import './launcher.css';
import { canPrompt, initPwa, install, isIos, isStandalone, onInstallChange, wasJustInstalled } from '../pwa.ts';

initPwa();

interface OfflineList {
  version: string;
  files: [path: string, hash: string, size: number][];
}

const GAMES = [
  {
    href: 'forest.html?source=app',
    name: 'Poacher Panic',
    icon: 'icons/forest-512.png',
    tag: 'Mystery · Open world',
    blurb: 'A ranger has gone silent near Hollow Creek. Drive in, follow the clues, bring her home.',
  },
  {
    href: 'campus.html?source=app',
    name: 'Campus Quest',
    icon: 'icons/campus-512.png',
    tag: 'Adventure · Quiz',
    blurb: 'Explore IOE Pashchimanchal Campus, Pokhara. Solve each department’s challenge and graduate.',
  },
];

const ASSET_CACHE = 'hc-assets-v1';
const DONE_KEY = 'sumix.offline.version';
const params = new URLSearchParams(location.search);
const appMode = isStandalone() || params.has('app');
const base = new URL('./', location.href);

const root = document.getElementById('launcher') as HTMLDivElement;
root.innerHTML = `
  <main class="lx ${appMode ? 'lx--app' : 'lx--web'}">
    <div class="lx__sky" aria-hidden="true"></div>
    <header class="lx__brand"><img src="icons/app-192.png" alt="" width="34" height="34" /><span>Sumix Developers</span></header>
    <section class="lx__hero">
      <h1 class="lx__title"></h1>
      <p class="lx__lede"></p>
      <div class="lx__action" aria-live="polite"></div>
    </section>
    <section class="lx__games" aria-label="Games">
      ${GAMES.map(
        (g) => `
        <article class="lx-card">
          <img class="lx-card__icon" src="${g.icon}" alt="" width="72" height="72" />
          <div class="lx-card__body">
            <div class="lx-card__tag">${g.tag}</div>
            <h2 class="lx-card__name">${g.name}</h2>
            <p class="lx-card__blurb">${g.blurb}</p>
          </div>
          <a class="lx-card__play" href="${g.href}" aria-disabled="true">Play</a>
        </article>`,
      ).join('')}
    </section>
    <footer class="lx__foot">© Sumix Developers · Runs on your device · Plays offline once downloaded</footer>
  </main>`;

const title = root.querySelector('.lx__title') as HTMLHeadingElement;
const lede = root.querySelector('.lx__lede') as HTMLParagraphElement;
const action = root.querySelector('.lx__action') as HTMLDivElement;
const plays = [...root.querySelectorAll<HTMLAnchorElement>('.lx-card__play')];

const DOWNLOAD_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v8.2M4.6 6.6 8 10l3.4-3.4M2.5 11.5v2h11v-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;

function setPlayable(on: boolean, label = 'Play'): void {
  for (const a of plays) {
    a.setAttribute('aria-disabled', on ? 'false' : 'true');
    a.tabIndex = on ? 0 : -1;
    a.textContent = label;
  }
}
for (const a of plays) a.addEventListener('click', (e) => a.getAttribute('aria-disabled') === 'true' && e.preventDefault());

async function offlineList(): Promise<OfflineList | null> {
  try {
    const res = await fetch('offline.json', { cache: 'no-cache' });
    return res.ok ? ((await res.json()) as OfflineList) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ browser: install only

function webMode(): void {
  title.innerHTML = 'Two games.<br /><em>One install.</em>';
  lede.textContent = 'Install Sumix Games and it downloads both games to your device. After that they open full screen, load fast and play offline.';
  let sizeNote = '';
  void offlineList().then((list) => {
    if (!list) return;
    sizeNote = `Free · about ${mb(list.files.reduce((s, f) => s + f[2], 0))} download after installing`;
    render();
  });
  let unavailable = false;
  const render = () => {
    setPlayable(false);
    if (wasJustInstalled()) {
      action.innerHTML = `<div class="lx-done"><b>Installed ✓</b> Open <b>Sumix Games</b> from your home screen or app list. It downloads the games the first time it opens.</div>`;
      return;
    }
    if (canPrompt() || isIos) {
      action.innerHTML = `<button class="lx-btn" type="button">${DOWNLOAD_ICON}<span>${isIos ? 'Install on iPhone / iPad' : 'Install Sumix Games'}</span></button><div class="lx-note">${sizeNote}</div>`;
      (action.querySelector('button') as HTMLButtonElement).onclick = () => void install().then(render);
      return;
    }
    if (!unavailable) {
      action.innerHTML = `<button class="lx-btn" type="button" disabled><span class="lx-spin"></span><span>Getting ready…</span></button><div class="lx-note">${sizeNote}</div>`;
      return;
    }
    action.innerHTML = `
      <div class="lx-note lx-note--box">
        <b>Can’t install from this browser.</b> Open this page in <b>Chrome</b> or <b>Edge</b> (Android, Windows, Mac) or <b>Safari</b> (iPhone, iPad).
        Already installed? Open <b>Sumix Games</b> from your apps.
      </div>
      <button class="lx-link" type="button">Play in the browser instead</button>`;
    (action.querySelector('.lx-link') as HTMLButtonElement).onclick = () => {
      setPlayable(true);
      root.querySelector('.lx__games')?.scrollIntoView({ behavior: 'smooth' });
    };
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
    title.innerHTML = 'Pick a game.';
    lede.textContent = 'Everything is on your device. Games load from here, even without internet.';
    action.innerHTML = `<div class="lx-done"><b>Ready to play ✓</b> Both games are downloaded.</div>`;
    setPlayable(true);
  };

  title.innerHTML = 'Getting your<br /><em>games ready.</em>';
  lede.textContent = 'A one-time download. Keep the app open until it finishes; next time it opens straight away.';
  setPlayable(false, 'Downloading…');
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
  state.textContent = missing.length ? 'Downloading games' : 'Checking files';
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
  await Promise.all(Array.from({ length: 4 }, worker));
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
