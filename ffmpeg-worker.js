// Converts pieces of a film in the browser, in a thread of its own so the page
// stays smooth: ffmpeg compiled for the browser (ffmpeg.wasm). Used by
// src/lib/play-file.web.ts, which sends one small MKV or MP4 file at a time and gets
// back the same seconds as MPEG-TS that Chrome can play: the picture as it
// is, the sound (often Dolby, which Chrome can't play) as AAC.
//
// ffmpeg itself (about 30 MB) comes from our own storage the first time and is
// kept by the browser after that (a year, unchanged per version). Since
// 2026-11-04 not from jsDelivr, so no outside service sees who converts a film
// (Christiaan: "a"; docs/APP_STORE_PATH.md item 18). The files are
// @ffmpeg/core's from npm, the same bytes as jsDelivr served (sha-256
// compared), in the R2 bucket iptvsync-demo-media under ffmpeg/<version>/;
// a new version is uploaded there first (INSTRUCTIONS.md).
const version = '0.12.10';
const coreURL = `https://media.iptvsync.app/ffmpeg/${version}/ffmpeg-core.js`;
const wasmURL = `https://media.iptvsync.app/ffmpeg/${version}/ffmpeg-core.wasm`;

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

// `name`: what the piece is called, so ffmpeg reads it as that kind (an MKV
// piece, or an MP4 piece from src/lib/mp4.ts).
self.onmessage = async ({ data: { id, input, args, name = 'in.mkv' } }) => {
  try {
    const ffmpeg = await load();
    log = [];
    ffmpeg.setLogger(({ message }) => log.length < 50 && log.push(message));
    ffmpeg.FS.writeFile(name, input);
    ffmpeg.setTimeout(-1);
    // ffmpeg ends each run with exit(), which skips the clean-up of its own
    // stack: 224 bytes stay taken per run, and after 121 runs (about 24
    // minutes of film) every run fails with "memory access out of bounds"
    // (Game of Thrones S02E01 in Chrome, 2026-10-23). So the stack is put back
    // where it was after each run: 400 runs in a row, same output. stackSave
    // and stackRestore are exported only under their short names, which are
    // this version's own (Da, Ea): another version must be checked again.
    const stack = version === '0.12.10' && typeof ffmpeg.asm?.Da === 'function' ? ffmpeg.asm.Da() : null;
    try {
      ffmpeg.exec(...args);
    } finally {
      if (stack !== null) ffmpeg.asm.Ea(stack);
    }
    const code = ffmpeg.ret;
    ffmpeg.reset();
    ffmpeg.FS.unlink(name);
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
