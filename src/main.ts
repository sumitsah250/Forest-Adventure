import './style.css';
import { Game } from './core/game.ts';
import { installTestHooks } from './core/testHooks.ts';
import { Session } from './game/session.ts';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

const loading = document.createElement('div');
loading.className = 'loading';
loading.innerHTML = `
  <div class="studio-tag">Sumix Developers presents</div>
  <div class="loading__title">POACHER PANIC</div>
  <div class="loading__bar"><span></span></div>
  <div class="loading__label">Preparing</div>`;
ui.appendChild(loading);
const bar = loading.querySelector('.loading__bar span') as HTMLSpanElement;
const label = loading.querySelector('.loading__label') as HTMLDivElement;

const game = new Game(canvas);
(window as unknown as { __game: Game }).__game = game;
const session = new Session(game, ui);
(window as unknown as { __session: Session }).__session = session;

async function boot(): Promise<void> {
  await game.init((f, text) => {
    bar.style.width = `${Math.round(f * 92)}%`;
    label.textContent = text;
  });
  await session.init((f, text) => {
    bar.style.width = `${Math.round(f * 100)}%`;
    label.textContent = text;
  });
  bar.style.width = '100%';
  loading.remove();
  game.start();
  if (!params.has('test')) {
    session.showTitle();
    canvas.addEventListener('click', () => {
      if (session.screens.current === 'none') game.input.requestPointerLock();
    });
  } else {
    if (params.has('title')) session.showTitle();
    else session.begin(params.has('continue'));
    installTestHooks(game, session);
  }
  (window as unknown as { __ready: boolean }).__ready = true;
}

boot().catch((err: unknown) => {
  console.error(err);
  label.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  (window as unknown as { __error: string }).__error = String(err);
});
