// Clues found during the night (story 2): gold when the player finds one, silver when Asha hands
// it over at the end of a mission. Kept in the profile; a small card pops up when one is found.

import type { ClueDef, ClueId } from './story.ts';
import type { Profile } from './profile.ts';

export type ClueKind = 'gold' | 'silver';

interface ClueText {
  gold: string;
  silver: string;
}

/** Given when the mission comes round; the player cannot miss them (decision 3). */
const ALWAYS_GOLD: ClueId[] = ['c9', 'c10'];

export class ClueBook {
  private clues: ClueDef[];
  private profile: Profile;
  private text: ClueText;
  private sound: (name: string) => void;
  private save: () => void;
  private card: HTMLDivElement;
  private queue: { def: ClueDef; kind: ClueKind }[] = [];
  private showing = false;
  /** Called when a clue is found (the board refreshes its badge, goals count it…). */
  onFound: ((id: ClueId, kind: ClueKind) => void) | null = null;

  constructor(root: HTMLElement, clues: ClueDef[], profile: Profile, text: ClueText, sound: (name: string) => void, save: () => void) {
    this.clues = clues;
    this.profile = profile;
    this.text = text;
    this.sound = sound;
    this.save = save;
    this.card = document.createElement('div');
    this.card.className = 'cq-cluecard';
    root.append(this.card);
  }

  def(id: string): ClueDef | undefined {
    return this.clues.find((c) => c.id === id);
  }

  state(id: string): ClueKind | null {
    return this.profile.clues[id] ?? null;
  }

  /** Clues found in a mission (by mission id). */
  forMission(missionId: string): ClueDef[] {
    return this.clues.filter((c) => c.mission === missionId);
  }

  /**
   * Finds a clue. A gold find upgrades a silver card; a silver one never replaces gold.
   * `popup: false` adds it quietly (the never-announced clues). Returns whether anything changed.
   */
  find(id: ClueId, kind: ClueKind, popup = true): boolean {
    const def = this.def(id);
    const now = this.profile.clues[id];
    if (!def || now === 'gold' || now === kind) return false;
    this.profile.clues[id] = kind;
    this.save();
    this.onFound?.(id, kind);
    if (popup) {
      this.queue.push({ def, kind });
      if (!this.showing) this.next();
    }
    return true;
  }

  /** Clues of a mission that Asha should hand over as silver at its end. */
  missedForAsha(missionId: string, quiet: ClueId[]): ClueDef[] {
    return this.forMission(missionId).filter((c) => !this.profile.clues[c.id] && !quiet.includes(c.id) && !ALWAYS_GOLD.includes(c.id));
  }

  /** Every clue of a mission found gold (the third star of a clue mission). */
  allGold(missionId: string): boolean {
    return this.forMission(missionId).every((c) => this.profile.clues[c.id] === 'gold');
  }

  /** A clue mission: one with clues the player can find or miss (decision 11). */
  isClueMission(missionId: string): boolean {
    return this.forMission(missionId).some((c) => !ALWAYS_GOLD.includes(c.id));
  }

  private next(): void {
    const n = this.queue.shift();
    if (!n) {
      this.showing = false;
      return;
    }
    this.showing = true;
    const { def, kind } = n;
    this.card.className = `cq-cluecard ${kind}`;
    this.card.textContent = '';
    const k = document.createElement('small');
    k.textContent = kind === 'gold' ? this.text.gold : this.text.silver;
    const t = document.createElement('b');
    t.textContent = def.title;
    const p = document.createElement('span');
    p.textContent = def.text;
    this.card.append(k, t, p);
    void this.card.offsetWidth;
    this.card.classList.add('show');
    this.sound(kind === 'gold' ? 'clueGold' : 'clueSilver');
    window.setTimeout(() => {
      this.card.classList.remove('show');
      window.setTimeout(() => this.next(), 350);
    }, 3200);
  }
}
