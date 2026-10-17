// Converts pieces of a film in the browser, in a thread of its own so the page
// stays smooth: ffmpeg compiled for the browser (ffmpeg.wasm). Used by
// src/lib/play-file.web.ts, which sends one small MKV file at a time and gets
// back the same seconds as MPEG-TS that Chrome can play: the picture as it
// is, the sound (often Dolby, which Chrome can't play) as AAC.
//
// ffmpeg itself (about 30 MB) comes from a CDN the first time and is kept by
// the browser after that.
const version = '0.12.10';
const coreURL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${version}/dist/umd/ffmpeg-core.js`;
const wasmURL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${version}/dist/umd/ffmpeg-core.wasm`;

let ready = null;
function load() {
  ready ??= (async () => {
    importScripts(coreURL);
    // The core finds its .wasm through the address after the #.
    return self.createFFmpegCore({ mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL }))}` });
  })();
  return ready;
}

let log = [];

self.onmessage = async ({ data: { id, input, args } }) => {
  try {
    const ffmpeg = await load();
    log = [];
    ffmpeg.setLogger(({ message }) => log.length < 50 && log.push(message));
    ffmpeg.FS.writeFile('in.mkv', input);
    ffmpeg.setTimeout(-1);
    ffmpeg.exec(...args);
    const code = ffmpeg.ret;
    ffmpeg.reset();
    ffmpeg.FS.unlink('in.mkv');
    if (code !== 0) throw new Error(`ffmpeg stopped (${code}): ${log.slice(-5).join(' | ')}`);
    const output = ffmpeg.FS.readFile('out.ts');
    ffmpeg.FS.unlink('out.ts');
    self.postMessage({ id, output }, [output.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message ?? e) });
  }
};

// Start loading ffmpeg as soon as the worker exists.
load().catch(() => undefined);
