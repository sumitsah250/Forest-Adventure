import './style.css';
import { Game } from './core/game.ts';
import { installTestHooks } from './core/testHooks.ts';
import { Session } from './game/session.ts';
import { createLoadingScreen } from './ui/loadingScreen.ts';
import { initPwa } from './pwa.ts';

initPwa();

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

const loading = createLoadingScreen(ui, 'forest');

const game = new Game(canvas);
(window as unknown as { __game: Game }).__game = game;
const session = new Session(game, ui);
(window as unknown as { __session: Session }).__session = session;

async function boot(): Promise<void> {
  await game.init((f, text) => loading.set(f * 0.92, text));
  await session.init((f, text) => loading.set(f, text));
  void loading.done();
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
  loading.fail(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
  (window as unknown as { __error: string }).__error = String(err);
});
