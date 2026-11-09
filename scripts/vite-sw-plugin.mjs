// Vite plugin: emits sw.js for the installable app (see src/pwa-sw/sw.template.js).
// The app shell (pages, hashed bundles, manifests, icons) is precached; game assets in
// public/assets are listed with a content hash so the worker caches each file once and
// refetches only the files that change in a release.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PUBLIC = 'public';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function serviceWorker() {
  return {
    name: 'hollow-creek-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const shell = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const assets = {};
      const files = [];
      const extra = [];
      for (const file of walk(PUBLIC)) {
        const path = relative(PUBLIC, file).split(sep).join('/');
        if (path.startsWith('assets/')) {
          const data = readFileSync(file);
          assets[path] = createHash('sha1').update(data).digest('hex').slice(0, 10);
          files.push([path, assets[path], data.length]);
        } else extra.push(path);
      }
      // offline.json: everything the installed app downloads up front, with sizes for the
      // progress bar. It is precached with the shell, so it always matches this worker.
      const shellFiles = [...shell, ...extra, 'offline.json'].sort();
      const version = createHash('sha1').update(JSON.stringify([shellFiles, assets])).digest('hex').slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'offline.json', source: JSON.stringify({ version, files }) });
      const template = readFileSync('src/pwa-sw/sw.template.js', 'utf8');
      const source = `const VERSION = ${JSON.stringify(version)};\nconst SHELL = ${JSON.stringify(shellFiles)};\nconst ASSETS = ${JSON.stringify(assets)};\n\n${template}`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
