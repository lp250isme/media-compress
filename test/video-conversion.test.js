import { mock, test } from 'node:test';
import assert from 'node:assert/strict';

const ALL_FORMATS = ['mock-all-formats'];
const state = {};

class Input {
  constructor(opts) { state.input = opts; }
}
class Mp4OutputFormat {}
class BufferTarget {
  constructor() { this.buffer = null; }
}
class BlobSource {
  constructor(file) { this.file = file; }
}
class Output {
  constructor(opts) {
    state.output = opts;
    this.target = opts.target;
  }
}
class Conversion {
  static async init(opts) {
    state.initCalls += 1;
    state.opts = opts;
    const conversion = {
      isValid: state.isValid,
      async execute() {
        state.executeCalls += 1;
        if (state.executeError) throw state.executeError;
        opts.output.target.buffer = state.buffer;
      },
    };
    Object.defineProperty(conversion, 'onProgress', {
      configurable: true,
      set(fn) { state.progress = fn; },
    });
    return conversion;
  }
}

mock.module('mediabunny', {
  namedExports: { Input, Output, Mp4OutputFormat, BufferTarget, Conversion, ALL_FORMATS, BlobSource },
});

globalThis.VideoEncoder = function VideoEncoder() {};
globalThis.VideoDecoder = function VideoDecoder() {};

const { compressMedia, compressVideo } = await import('../src/index.js');

function file(name, type, bytes) {
  return new File([new Uint8Array(bytes)], name, { type });
}

function reset(overrides = {}) {
  state.isValid = true;
  state.buffer = new ArrayBuffer(4);
  state.executeError = null;
  state.initCalls = 0;
  state.executeCalls = 0;
  state.progress = undefined;
  state.opts = null;
  state.input = null;
  state.output = null;
  Object.assign(state, overrides);
}

test('transcodes a smaller H.264 MP4 with the default 480p settings', async () => {
  reset();
  const src = file('clip.MOV', 'video/quicktime', 100);
  const onProgress = () => {};
  const info = [];
  const out = await compressVideo(src, { onProgress, onInfo: (i) => info.push(i) });

  assert.equal(state.initCalls, 1);
  assert.equal(state.executeCalls, 1);
  assert.equal(state.input.formats, ALL_FORMATS);
  assert.equal(state.input.source.file, src);
  assert.ok(state.output.format instanceof Mp4OutputFormat);
  assert.ok(state.output.target instanceof BufferTarget);
  assert.deepEqual(state.opts.video, { height: 480, fit: 'contain', codec: 'avc', bitrate: 1_400_000 });
  assert.deepEqual(state.opts.audio, { codec: 'aac', bitrate: 128_000 });
  assert.equal(state.progress, onProgress);
  assert.equal(out.name, 'clip.mp4');
  assert.equal(out.type, 'video/mp4');
  assert.equal(out.size, 4);
  assert.notEqual(out, src);
  assert.deepEqual(info, [{ compressed: true, fromBytes: 100, toBytes: 4 }]);
});

test('forwards height, bitrate, and audioBitrate, and ignores a non-function onProgress', async () => {
  reset();
  const src = file('noext', 'video/webm', 80);
  const out = await compressVideo(src, {
    height: 720,
    bitrate: 2_500_000,
    audioBitrate: 96_000,
    onProgress: null,
  });
  assert.deepEqual(state.opts.video, { height: 720, fit: 'contain', codec: 'avc', bitrate: 2_500_000 });
  assert.deepEqual(state.opts.audio, { codec: 'aac', bitrate: 96_000 });
  assert.equal(state.progress, undefined);
  assert.equal(out.name, 'noext.mp4');
  assert.equal(state.executeCalls, 1);
});

test('returns the original without executing when the device cannot encode', async () => {
  reset({ isValid: false });
  const src = file('clip.mp4', 'video/mp4', 50);
  const onProgress = () => {};
  const info = [];
  const out = await compressVideo(src, { onProgress, onInfo: (i) => info.push(i) });
  assert.equal(out, src);
  assert.equal(state.executeCalls, 0);
  assert.equal(state.progress, undefined);
  assert.deepEqual(info, [{ compressed: false, reason: 'cannot-encode' }]);
});

test('returns the original when the conversion produces no buffer', async () => {
  reset({ buffer: null });
  const src = file('clip.mp4', 'video/mp4', 50);
  const info = [];
  assert.equal(await compressVideo(src, { onInfo: (i) => info.push(i) }), src);
  assert.equal(state.executeCalls, 1);
  assert.deepEqual(info, [{ compressed: false, reason: 'no-output' }]);
});

test('returns the original when the MP4 is not smaller', async () => {
  for (const bytes of [32, 48]) {
    reset({ buffer: new ArrayBuffer(bytes) });
    const src = file('clip.mp4', 'video/mp4', 32);
    const info = [];
    assert.equal(await compressVideo(src, { onInfo: (i) => info.push(i) }), src);
    assert.deepEqual(info, [{ compressed: false, reason: 'not-smaller', fromBytes: 32, toBytes: bytes }]);
  }
});

test('returns the original and the error message when conversion throws', async () => {
  reset({ executeError: new Error('encode blew up') });
  const src = file('clip.mp4', 'video/mp4', 50);
  const info = [];
  assert.equal(await compressVideo(src, { onInfo: (i) => info.push(i) }), src);
  assert.deepEqual(info, [{ compressed: false, reason: 'error', message: 'encode blew up' }]);
});

test('still returns the file when onInfo throws', async () => {
  reset();
  const src = file('clip.webm', 'video/webm', 40);
  const compressed = await compressVideo(src, { onInfo() { throw new Error('listener failed'); } });
  assert.equal(compressed.name, 'clip.mp4');
  assert.equal(compressed.size, 4);

  reset({ isValid: false });
  assert.equal(await compressVideo(src, { onInfo() { throw new Error('listener failed'); } }), src);
});

test('compressMedia sends videos through conversion, and non-videos never start one', async () => {
  reset();
  const video = file('my.clip.webm', 'video/webm', 60);
  const out = await compressMedia(video);
  assert.equal(state.initCalls, 1);
  assert.equal(out.name, 'my.clip.mp4');
  assert.equal(out.type, 'video/mp4');

  reset();
  const image = file('shot.png', 'image/png', 20);
  assert.equal(await compressVideo(image), image);
  assert.equal(state.initCalls, 0);
});
