// Developer panel (campus.html?story=2&debug=1). Not built at all without debug=1.
//   jump to any mission or interlude · clues all gold / silver / clear · minutes to spare
//   weather and time of day · skip the current cutscene · FPS and draw calls
// Also exposes window.__debug (the same API) for scripts/smoke-test.mjs.
// Developer-only, so its labels are not part of the story text.

export interface DebugApi {
  missions: string[];
  interludes: string[];
  jump(index: number): void;
  interlude(index: number): void;
  clues(kind: 'gold' | 'silver' | 'clear'): void;
  minutes(n: number): void;
  weather(w: 'auto' | 'clear' | 'drizzle' | 'storm'): void;
  sky(s: 'auto' | 'dusk' | 'night' | 'predawn' | 'dawn'): void;
  skipCutscene(): void;
  stats(): { calls: number; triangles: number; mission: string };
}

export class DebugPanel {
  private box: HTMLDivElement;
  private stat: HTMLDivElement;
  private api: DebugApi;
  private frames = 0;
  private since = 0;

  constructor(root: HTMLElement, api: DebugApi) {
    this.api = api;
    (window as unknown as { __debug: DebugApi }).__debug = api;
    const box = document.createElement('div');
    box.className = 'cq-debug';
    const opts = (list: string[], prefix: string) => list.map((m, i) => `<option value="${i}">${prefix}${i + 1} · ${m}</option>`).join('');
    box.innerHTML = `
      <button class="cq-debug__toggle" type="button">DEBUG</button>
      <div class="cq-debug__body">
        <div class="cq-debug__stat"></div>
        <label>Mission <select data-k="mission">${opts(api.missions, 'M')}</select><button data-a="jump">Go</button></label>
        <label>Interlude <select data-k="interlude">${api.interludes.length ? opts(api.interludes, 'I') : '<option>none yet</option>'}</select><button data-a="interlude">Go</button></label>
        <div>Clues <button data-a="gold">all gold</button><button data-a="silver">all silver</button><button data-a="clear">clear</button></div>
        <label>Minutes to spare <input data-k="minutes" type="number" min="0" max="99" value="30"><button data-a="minutes">Set</button></label>
        <label>Weather <select data-k="weather"><option>auto</option><option>clear</option><option>drizzle</option><option>storm</option></select></label>
        <label>Time <select data-k="sky"><option>auto</option><option>dusk</option><option>night</option><option>predawn</option><option>dawn</option></select></label>
        <div><button data-a="skip">Skip cutscene</button></div>
      </div>`;
    root.append(box);
    this.box = box;
    this.stat = box.querySelector('.cq-debug__stat') as HTMLDivElement;
    const val = (k: string) => (box.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement).value;
    box.querySelector('.cq-debug__toggle')!.addEventListener('click', () => box.classList.toggle('open'));
    box.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (!a) return;
      if (a === 'jump') api.jump(Number(val('mission')));
      else if (a === 'interlude' && api.interludes.length) api.interlude(Number(val('interlude')));
      else if (a === 'gold' || a === 'silver' || a === 'clear') api.clues(a);
      else if (a === 'minutes') api.minutes(Number(val('minutes')));
      else if (a === 'skip') api.skipCutscene();
    });
    box.addEventListener('change', (e) => {
      const k = (e.target as HTMLElement).dataset.k;
      if (k === 'weather') api.weather(val('weather') as Parameters<DebugApi['weather']>[0]);
      if (k === 'sky') api.sky(val('sky') as Parameters<DebugApi['sky']>[0]);
    });
    // Keys typed into the panel must not move the player or advance dialogue.
    box.addEventListener('keydown', (e) => e.stopPropagation());
  }

  /** Once per frame: counts frames, refreshes the readout twice a second. */
  frame(now: number): void {
    this.frames += 1;
    if (now - this.since < 500) return;
    const fps = (this.frames * 1000) / (now - this.since || 1);
    this.frames = 0;
    this.since = now;
    (this.box.firstElementChild as HTMLElement).dataset.fps = `${Math.round(fps)} fps`;
    if (!this.box.classList.contains('open')) return;
    const s = this.api.stats();
    this.stat.textContent = `${fps.toFixed(0)} fps · ${s.calls} draw calls · ${(s.triangles / 1000).toFixed(0)}k tris · ${s.mission}`;
  }
}
