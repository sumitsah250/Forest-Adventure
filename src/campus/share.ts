// The share card at the end of story 2 (docs/STORY_V2.md, section 6): a 1080 × 1350 image with
// the player's name, minutes to spare and total stars. Download it, or share it with the Web
// Share API where the browser can share files (most phones).
//
// All text comes from V2_TEXT.share (story/v2/text.ts).

import type { DialogueHost } from './dialogue.ts';

export interface ShareText {
  title: string;
  sub: string;
  download: string;
  share: string;
  close: string;
  headline: string;
  kicker: string;
  minutes: string;
  stars: string;
  remember: string;
  forget: string;
  footer: string;
  text: string;
  file: string;
}

export interface ShareOptions {
  text: ShareText;
  name: string;
  roll: string;
  minutes: number;
  stars: number;
  maxStars: number;
  /** MITRA's memory: 'remember', 'forget' or undefined. */
  choice?: string;
  /** The player's portrait (a square canvas), drawn in a circle. */
  face: HTMLCanvasElement | null;
  sound: (name: string) => void;
}

const W = 1080;
const H = 1350;

/** Draws the card. Exported for the smoke test and the debug panel. */
export function drawShareCard(o: ShareOptions): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const t = o.text;
  // Sunrise sky.
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0c1630');
  sky.addColorStop(0.42, '#3a2c5c');
  sky.addColorStop(0.66, '#d9725a');
  sky.addColorStop(0.8, '#f6c070');
  sky.addColorStop(1, '#f9dfa2');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // The sun, low behind the range.
  const sun = g.createRadialGradient(W * 0.68, H * 0.8, 10, W * 0.68, H * 0.8, 420);
  sun.addColorStop(0, 'rgba(255, 244, 210, 1)');
  sun.addColorStop(0.18, 'rgba(255, 214, 140, 0.9)');
  sun.addColorStop(1, 'rgba(255, 180, 110, 0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, W, H);
  // Peaks: a far pale range and a near dark one (with Machhapuchhre's fishtail).
  const ridge = (pts: number[], fill: string) => {
    g.beginPath();
    g.moveTo(0, H);
    for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i] * W, pts[i + 1] * H);
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  ridge([0, 0.86, 0.12, 0.8, 0.22, 0.83, 0.34, 0.74, 0.43, 0.79, 0.52, 0.66, 0.555, 0.7, 0.6, 0.64, 0.68, 0.76, 0.8, 0.72, 0.9, 0.79, 1, 0.75], 'rgba(238, 222, 236, 0.75)');
  ridge([0, 0.93, 0.15, 0.88, 0.3, 0.91, 0.45, 0.85, 0.6, 0.9, 0.75, 0.86, 0.9, 0.9, 1, 0.87], '#1f1a2c');
  // Text, with a soft shadow so it reads on the bright part of the sky.
  g.textAlign = 'center';
  g.shadowColor = 'rgba(0, 0, 0, 0.45)';
  g.shadowBlur = 14;
  g.shadowOffsetY = 3;
  g.fillStyle = 'rgba(255, 255, 255, 0.78)';
  g.font = '800 30px "Segoe UI", system-ui, sans-serif';
  g.fillText(t.kicker, W / 2, 110);
  g.fillStyle = '#ffd98a';
  g.font = '900 104px "Segoe UI", system-ui, sans-serif';
  g.fillText(t.headline, W / 2, 230);
  // Portrait.
  const cx = W / 2;
  const cy = 430;
  const r = 140;
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.closePath();
  g.fillStyle = '#20263a';
  g.fill();
  g.clip();
  if (o.face) g.drawImage(o.face, cx - r, cy - r, r * 2, r * 2);
  g.restore();
  g.lineWidth = 10;
  g.strokeStyle = '#ffd98a';
  g.beginPath();
  g.arc(cx, cy, r + 5, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = '800 64px "Segoe UI", system-ui, sans-serif';
  fitText(g, o.name || '—', cx, 660, W - 120);
  g.fillStyle = 'rgba(255, 255, 255, 0.72)';
  g.font = '600 34px Consolas, "Courier New", monospace';
  fitText(g, o.roll, cx, 712, W - 120);
  // Minutes to spare and stars.
  g.fillStyle = '#ffffff';
  g.font = '900 96px "Segoe UI", system-ui, sans-serif';
  g.fillText(t.minutes.replace('{n}', String(o.minutes)), cx, 850);
  g.fillStyle = '#ffffff';
  g.font = '800 54px "Segoe UI", system-ui, sans-serif';
  g.fillText(`★ ${t.stars.replace('{n}', String(o.stars)).replace('{max}', String(o.maxStars))}`, cx, 930);
  if (o.choice === 'remember' || o.choice === 'forget') {
    g.fillStyle = 'rgba(255, 255, 255, 0.9)';
    g.font = 'italic 600 34px "Segoe UI", system-ui, sans-serif';
    fitText(g, o.choice === 'remember' ? t.remember : t.forget, cx, 1000, W - 140);
  }
  g.fillStyle = 'rgba(255, 255, 255, 0.85)';
  g.font = '700 32px "Segoe UI", system-ui, sans-serif';
  fitText(g, t.footer, cx, H - 70, W - 120);
  return c;
}

function fitText(g: CanvasRenderingContext2D, s: string, x: number, y: number, max: number): void {
  g.fillText(s, x, y, max);
}

/** Opens the share card. Resolves when it is closed. */
export function openShareCard(host: DialogueHost, o: ShareOptions): Promise<void> {
  return new Promise((resolve) => {
    const t = o.text;
    const canvas = drawShareCard(o);
    const ov = host.open('cq-overlay--share');
    const box = document.createElement('div');
    box.className = 'cq-share';
    const h = document.createElement('h2');
    h.textContent = t.title;
    const p = document.createElement('p');
    p.textContent = t.sub;
    const img = document.createElement('img');
    img.alt = t.headline;
    img.src = canvas.toDataURL('image/png');
    const row = document.createElement('div');
    row.className = 'cq-share__row';
    const btn = (label: string, primary: boolean, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cq-btn${primary ? ' cq-btn--primary' : ''}`;
      b.textContent = label;
      b.onclick = fn;
      row.append(b);
      return b;
    };
    btn(t.download, true, () => {
      o.sound('click');
      const a = document.createElement('a');
      a.href = img.src;
      a.download = t.file;
      a.click();
    });
    // Web Share with a file: only where the browser says it can (most phones, some desktops).
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], t.file, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      const data: ShareData = { files: [file], text: t.text.replace('{n}', String(o.minutes)) };
      if (!nav.share || !nav.canShare?.(data)) return;
      const b = btn(t.share, false, () => {
        o.sound('click');
        nav.share(data).catch(() => undefined);
      });
      row.insertBefore(b, closeBtn);
    }, 'image/png');
    const done = () => {
      host.close();
      resolve();
    };
    const closeBtn = btn(t.close, false, done);
    box.append(h, p, img, row);
    ov.append(box);
    host.keyHandler = (e) => {
      if (e.code === 'Escape') done();
    };
  });
}
