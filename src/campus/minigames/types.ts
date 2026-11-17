// The shared shape of every mini-game (Bubble Level, Chiya Rush, Table Tennis, Drone Hack,
// Pull-Start, Signal Tuner, Bug Hunt). Each runs inside the standard puzzle card (runMini in
// ../minigames.ts), lasts 30 to 60 seconds, and reports a result.
//
//   start(ctx)   build its DOM / canvas inside ctx.body, read its settings
//   update(dt)   once per frame while it runs (no allocations here)
//   done         true once it has an outcome
//   finish()     the outcome; called once, after `done`
//   key(e)       keyboard (optional); touch and mouse are handled by the game's own elements
//   dispose()    stop listeners (optional)

export interface MiniContext {
  body: HTMLElement;
  sound: (name: string) => void;
  /** Keys held right now (by KeyboardEvent.code). */
  held: Set<string>;
  /** Mini-game specific settings (jammed tuner, the snippet of the day…). */
  opts: Record<string, unknown>;
}

export interface MiniResult {
  ok: boolean;
  /** Shown under the result ("Level held for 3 seconds."). */
  note: string;
  score?: number;
}

export interface MiniGame {
  start(ctx: MiniContext): void;
  update(dt: number): void;
  readonly done: boolean;
  finish(): MiniResult;
  key?(e: KeyboardEvent): void;
  dispose?(): void;
}
