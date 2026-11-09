// Installable-app support: registers the service worker (production builds only),
// offers an "Install app" button where the browser allows it, and keeps the screen
// awake while the game is open.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** Called whenever install availability changes (prompt ready, used, or app installed). */
export function onInstallChange(f: () => void): void {
  listeners.add(f);
}

/** True when the browser's own install prompt is ready to show. */
export function canPrompt(): boolean {
  return deferred !== null;
}

/** True once the app was installed during this visit. */
export function wasJustInstalled(): boolean {
  return justInstalled;
}

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initPwa(): void {
  const test = new URLSearchParams(location.search).has('test');
  if ('serviceWorker' in navigator && import.meta.env.PROD && !test) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err: unknown) => console.warn('Service worker not registered', err));
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    justInstalled = true;
    notify();
  });
  if (!test) keepAwake();
}

/** Stops phones dimming and locking the screen mid-game. */
function keepAwake(): void {
  const wl = (navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<unknown> } }).wakeLock;
  if (!wl) return;
  const request = () => {
    if (document.visibilityState === 'visible') wl.request('screen').catch(() => undefined);
  };
  request();
  document.addEventListener('visibilitychange', request);
  // Some browsers only grant the lock after a user gesture.
  window.addEventListener('pointerdown', request, { once: true });
}

/**
 * A button that installs the game as an app. Hidden until the browser says the page
 * can be installed (or always shown on iOS Safari, where installing is manual).
 */
export function installButton(className: string, label = 'Install app'): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `${className} pwa-install`;
  b.type = 'button';
  b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v8.2M4.6 6.6 8 10l3.4-3.4M2.5 11.5v2h11v-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${label}</span>`;
  const update = () => {
    b.hidden = isStandalone() || !(deferred || isIos);
  };
  update();
  listeners.add(update);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    void install();
  });
  return b;
}

/** Shows the browser's install prompt, or the Add to Home Screen steps on iOS. */
export async function install(): Promise<'accepted' | 'dismissed' | 'manual' | 'unavailable'> {
  if (deferred) {
    const d = deferred;
    deferred = null;
    await d.prompt();
    const { outcome } = await d.userChoice;
    notify();
    return outcome;
  }
  if (isIos) {
    iosSheet();
    return 'manual';
  }
  return 'unavailable';
}

function iosSheet(): void {
  const s = document.createElement('div');
  s.className = 'pwa-sheet';
  s.innerHTML = `<div class="pwa-sheet__box" role="dialog" aria-label="Install on iPhone or iPad">
      <b>Play it like an app</b>
      <p>In Safari, tap the <span class="pwa-share" aria-label="Share">
        <svg viewBox="0 0 16 16"><path d="M8 1.5v8M5 4.5l3-3 3 3M4 7H3v7.5h10V7h-1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        Share button, then choose <b>Add to Home Screen</b>. It opens full screen and loads faster next time.</p>
      <button type="button">Got it</button>
    </div>`;
  s.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target === s || (e.target as HTMLElement).closest('button')) s.remove();
  });
  document.body.appendChild(s);
}
