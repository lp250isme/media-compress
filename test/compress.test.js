import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import compressMedia, { compressImage, compressMedia as namedCompressMedia, compressVideo } from '../src/index.js';

const restorers = [];

function stubGlobal(key, value) {
  const had = Object.hasOwn(globalThis, key);
  const prev = globalThis[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  restorers.push(() => {
    if (had) Object.defineProperty(globalThis, key, { value: prev, configurable: true, writable: true });
    else delete globalThis[key];
  });
}

afterEach(() => {
  while (restorers.length) restorers.pop()();
});

function file(name, type, bytes) {
  return new File([new Uint8Array(bytes)], name, { type });
}

function installCanvas({ width, height, blob, context = {} }) {
  const calls = { closed: false, toBlob: null, draw: null, getContext: null, bitmap: null };
  stubGlobal('createImageBitmap', async (source, opts) => {
    calls.bitmap = { source, opts };
    return {
      width,
      height,
      close() { calls.closed = true; },
    };
  });
  stubGlobal('document', {
    createElement(tag) {
      calls.tag = tag;
      const canvas = {
        width: 0,
        height: 0,
        getContext(kind) {
          calls.getContext = kind;
          if (context === null) return null;
          return {
            drawImage(bitmap, x, y, w, h) {
              calls.draw = { bitmap, x, y, w, h };
            },
          };
        },
        toBlob(cb, type, quality) {
          calls.toBlob = { type, quality, width: canvas.width, height: canvas.height };
          cb(blob);
        },
      };
      return canvas;
    },
  });
  return calls;
}

describe('compressMedia', () => {
  test('is the default export and routes by MIME type', async () => {
    assert.equal(compressMedia, namedCompressMedia);

    const video = file('clip.mp4', 'video/mp4', 12);
    const videoInfo = [];
    assert.equal(await compressMedia(video, { onInfo: (i) => videoInfo.push(i) }), video);
    assert.deepEqual(videoInfo, [{ compressed: false, reason: 'no-webcodecs' }]);

    const image = file('shot.png', 'image/png', 12);
    const imageInfo = [];
    assert.equal(await compressMedia(image, { onInfo: (i) => imageInfo.push(i) }), image);
    assert.deepEqual(imageInfo, [{ compressed: false, reason: 'no-canvas' }]);

    const gif = file('anim.gif', 'image/gif', 12);
    const gifInfo = [];
    assert.equal(await compressMedia(gif, { onInfo: (i) => gifInfo.push(i) }), gif);
    assert.deepEqual(gifInfo, [{ compressed: false, reason: 'not-image' }]);

    const other = file('notes.txt', 'text/plain', 4);
    const otherInfo = [];
    assert.equal(
      await compressMedia(other, {
        onInfo(info) {
          otherInfo.push(info);
          throw new Error('listener failed');
        },
      }),
      other,
    );
    assert.deepEqual(otherInfo, [{ compressed: false, reason: 'unsupported-type' }]);
  });
});

describe('compressImage', () => {
  test('returns non-images and GIFs unchanged without touching the canvas', async () => {
    const calls = installCanvas({ width: 10, height: 10, blob: new Blob([new Uint8Array(1)]) });
    const samples = [
      file('notes.txt', 'text/plain', 8),
      file('blob.bin', 'application/octet-stream', 8),
      file('anim.gif', 'image/gif', 8),
    ];
    for (const src of samples) {
      const info = [];
      const out = await compressImage(src, { onInfo: (i) => info.push(i) });
      assert.equal(out, src);
      assert.deepEqual(info, [{ compressed: false, reason: 'not-image' }]);
    }
    assert.equal(calls.bitmap, null);
    assert.equal(calls.tag, undefined);
  });

  test('falls back when there is no document, even if onInfo throws', async () => {
    const src = file('shot.jpeg', 'image/jpeg', 40);
    let calls = 0;
    const out = await compressImage(src, {
      onInfo(info) {
        calls += 1;
        assert.deepEqual(info, { compressed: false, reason: 'no-canvas' });
        throw new Error('listener failed');
      },
    });
    assert.equal(out, src);
    assert.equal(calls, 1);
    assert.equal(await compressImage(src), src);
  });

  test('scales the longest edge and returns a smaller WebP', async () => {
    const blob = new Blob([new Uint8Array(20)], { type: 'image/webp' });
    const calls = installCanvas({ width: 3200, height: 1800, blob });
    const src = file('holiday.photo.PNG', 'image/png', 500);
    const info = [];
    const out = await compressImage(src, { onInfo: (i) => info.push(i) });

    assert.equal(calls.tag, 'canvas');
    assert.deepEqual(calls.bitmap, { source: src, opts: { imageOrientation: 'from-image' } });
    assert.equal(calls.getContext, '2d');
    assert.equal(calls.draw.x, 0);
    assert.equal(calls.draw.y, 0);
    assert.equal(calls.draw.w, 1600);
    assert.equal(calls.draw.h, 900);
    assert.deepEqual(calls.toBlob, { type: 'image/webp', quality: 0.85, width: 1600, height: 900 });
    assert.equal(calls.closed, true);
    assert.equal(out.name, 'holiday.photo.webp');
    assert.equal(out.type, 'image/webp');
    assert.equal(out.size, 20);
    assert.notEqual(out, src);
    assert.deepEqual(info, [{ compressed: true, fromBytes: 500, toBytes: 20 }]);
  });

  test('honors maxDim and quality, and does not enlarge a small image', async () => {
    const portrait = installCanvas({
      width: 1080,
      height: 1920,
      blob: new Blob([new Uint8Array(10)]),
    });
    await compressImage(file('tall.png', 'image/png', 100), { maxDim: 480, quality: 0.4 });
    assert.deepEqual(portrait.toBlob, { type: 'image/webp', quality: 0.4, width: 270, height: 480 });
    assert.deepEqual(
      { w: portrait.draw.w, h: portrait.draw.h },
      { w: 270, h: 480 },
    );

    const small = installCanvas({
      width: 800,
      height: 600,
      blob: new Blob([new Uint8Array(10)]),
    });
    await compressImage(file('small.png', 'image/png', 100));
    assert.deepEqual(small.toBlob, { type: 'image/webp', quality: 0.85, width: 800, height: 600 });
  });

  test('rounds scaled dimensions to whole pixels', async () => {
    const calls = installCanvas({
      width: 1601,
      height: 1000,
      blob: new Blob([new Uint8Array(10)]),
    });
    await compressImage(file('odd.png', 'image/png', 100));
    assert.equal(calls.toBlob.width, 1600);
    assert.equal(calls.toBlob.height, 999);
  });

  test('keeps the original name when there is no extension, and only replaces the last one', async () => {
    const blob = new Blob([new Uint8Array(4)]);
    installCanvas({ width: 10, height: 10, blob });
    const plain = file('photo', 'image/png', 30);
    assert.equal((await compressImage(plain)).name, 'photo.webp');
    const dotted = file('my.vacation.png', 'image/jpeg', 30);
    assert.equal((await compressImage(dotted)).name, 'my.vacation.webp');
  });

  test('keeps the original when the WebP is not smaller', async () => {
    for (const bytes of [32, 40]) {
      installCanvas({ width: 400, height: 400, blob: new Blob([new Uint8Array(bytes)]) });
      const src = file('already.png', 'image/png', 32);
      const info = [];
      const out = await compressImage(src, { onInfo: (i) => info.push(i) });
      assert.equal(out, src);
      assert.deepEqual(info, [{ compressed: false, reason: 'not-smaller', fromBytes: 32, toBytes: bytes }]);
    }
  });

  test('keeps the original when canvas cannot encode or has no 2d context', async () => {
    installCanvas({ width: 20, height: 20, blob: null });
    const src = file('empty.png', 'image/png', 16);
    const missingBlob = [];
    assert.equal(await compressImage(src, { onInfo: (i) => missingBlob.push(i) }), src);
    assert.deepEqual(missingBlob, [{ compressed: false, reason: 'no-output' }]);

    const calls = installCanvas({ width: 20, height: 20, blob: new Blob([new Uint8Array(1)]), context: null });
    const missingCtx = [];
    assert.equal(await compressImage(src, { onInfo: (i) => missingCtx.push(i) }), src);
    assert.deepEqual(missingCtx, [{ compressed: false, reason: 'no-canvas' }]);
    assert.equal(calls.toBlob, null);
    assert.equal(calls.closed, false);
  });

  test('keeps the original and reports the message when decoding throws', async () => {
    stubGlobal('document', { createElement() { throw new Error('should not reach canvas'); } });
    stubGlobal('createImageBitmap', async () => { throw new Error('decode failed'); });
    const src = file('broken.png', 'image/png', 16);
    const info = [];
    assert.equal(await compressImage(src, { onInfo: (i) => info.push(i) }), src);
    assert.deepEqual(info, [{ compressed: false, reason: 'error', message: 'decode failed' }]);
  });

  test('still returns the WebP when onInfo throws', async () => {
    installCanvas({ width: 10, height: 10, blob: new Blob([new Uint8Array(3)]) });
    const src = file('ok.png', 'image/png', 30);
    const out = await compressImage(src, { onInfo() { throw new Error('listener failed'); } });
    assert.equal(out.name, 'ok.webp');
    assert.equal(out.type, 'image/webp');
    assert.equal(out.size, 3);
  });
});

describe('compressVideo fallbacks', () => {
  test('returns non-video files and videos without WebCodecs unchanged', async () => {
    const image = file('shot.png', 'image/png', 8);
    const imageInfo = [];
    assert.equal(await compressVideo(image, { onInfo: (i) => imageInfo.push(i) }), image);
    assert.deepEqual(imageInfo, [{ compressed: false, reason: 'not-video' }]);

    const video = file('clip.mp4', 'video/mp4', 8);
    const videoInfo = [];
    assert.equal(await compressVideo(video, { onInfo: (i) => videoInfo.push(i) }), video);
    assert.deepEqual(videoInfo, [{ compressed: false, reason: 'no-webcodecs' }]);

    stubGlobal('VideoEncoder', function VideoEncoder() {});
    const partial = [];
    assert.equal(await compressVideo(video, { onInfo: (i) => partial.push(i) }), video);
    assert.deepEqual(partial, [{ compressed: false, reason: 'no-webcodecs' }]);

    let calls = 0;
    const out = await compressVideo(video, {
      onInfo() {
        calls += 1;
        throw new Error('listener failed');
      },
    });
    assert.equal(out, video);
    assert.equal(calls, 1);
    assert.equal(await compressVideo(video), video);
  });
});
