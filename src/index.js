// media-compress — 上傳前在瀏覽器壓縮圖片與影片,縮到「手機小畫面夠清楚」即可,省 R2 空間 + 秒載。
//
// 圖片:canvas → 高品質 WebP(長邊上限 1600、q0.85)。GIF 不動。
// 影片:WebCodecs(mediabunny)轉 480p H.264 MP4(~1.4Mbps + AAC)。
//   WebCodecs 不需 SharedArrayBuffer/COOP-COEP,也不用 30MB 的 ffmpeg.wasm。
//   不支援 WebCodecs(舊 iOS/Firefox)、轉不動、或壓完反而更大 → 一律回原檔(絕不擋上傳)。
//
// 想知道「為什麼沒壓到」可傳 onInfo(info) 回呼:info.compressed 為 true/false,
//   false 時 info.reason ∈ no-webcodecs|cannot-encode|no-output|not-smaller|error|not-video|not-image。
//
// 全部 SSR/Node 安全:沒有 document / WebCodecs 時直接回原檔。

import { Input, Output, Mp4OutputFormat, BufferTarget, Conversion, ALL_FORMATS, BlobSource } from 'mediabunny';

const DEF = { maxDim: 1600, quality: 0.85, height: 480, bitrate: 1_400_000, audioBitrate: 128_000 };
const reExt = (name, ext) => name.replace(/\.[^.]+$/, '') + ext;

/** 圖片壓縮:回傳壓好的 WebP File;非圖片/GIF/壓不小/出錯 → 回原檔 */
export async function compressImage(file, opts = {}) {
  const { maxDim = DEF.maxDim, quality = DEF.quality, onInfo } = opts;
  const done = (f, info) => { try { onInfo?.(info); } catch { /* */ } return f; };
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return done(file, { compressed: false, reason: 'not-image' });
  if (typeof document === 'undefined') return done(file, { compressed: false, reason: 'no-canvas' });
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    let w = bitmap.width, h = bitmap.height;
    if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); if (!ctx) return done(file, { compressed: false, reason: 'no-canvas' });
    ctx.drawImage(bitmap, 0, 0, w, h); bitmap.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', quality));
    if (!blob) return done(file, { compressed: false, reason: 'no-output' });
    if (blob.size >= file.size) return done(file, { compressed: false, reason: 'not-smaller', fromBytes: file.size, toBytes: blob.size });
    return done(new File([blob], reExt(file.name, '.webp'), { type: 'image/webp' }), { compressed: true, fromBytes: file.size, toBytes: blob.size });
  } catch (e) { return done(file, { compressed: false, reason: 'error', message: String((e && e.message) || e) }); }
}

/** 影片壓縮:回傳 480p H.264 MP4 File;非影片/無 WebCodecs/轉不動/壓不小 → 回原檔。
 *  onProgress(p) 之 p 為 0..1;onInfo(info) 回報壓縮結果/原因。 */
export async function compressVideo(file, opts = {}) {
  const { height = DEF.height, bitrate = DEF.bitrate, audioBitrate = DEF.audioBitrate, onProgress, onInfo } = opts;
  const done = (f, info) => { try { onInfo?.(info); } catch { /* */ } return f; };
  if (!file.type.startsWith('video/')) return done(file, { compressed: false, reason: 'not-video' });
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') return done(file, { compressed: false, reason: 'no-webcodecs' });
  try {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      video: { height, fit: 'contain', codec: 'avc', bitrate }, // 'avc' = H.264(mediabunny 的 VideoCodec 值;寫 'h264' 會被判非法 → isValid:false → 全部影片 fallback 不壓)

      audio: { codec: 'aac', bitrate: audioBitrate },
    });
    if (!conversion.isValid) return done(file, { compressed: false, reason: 'cannot-encode' }); // 例如該裝置無法編碼 H.264
    if (typeof onProgress === 'function') conversion.onProgress = onProgress;
    await conversion.execute();
    const buf = output.target.buffer;
    if (!buf) return done(file, { compressed: false, reason: 'no-output' });
    if (buf.byteLength >= file.size) return done(file, { compressed: false, reason: 'not-smaller', fromBytes: file.size, toBytes: buf.byteLength });
    return done(new File([buf], reExt(file.name, '.mp4'), { type: 'video/mp4' }), { compressed: true, fromBytes: file.size, toBytes: buf.byteLength });
  } catch (e) { return done(file, { compressed: false, reason: 'error', message: String((e && e.message) || e) }); }
}

/** 依型別自動選:影片→compressVideo、圖片→compressImage、其餘→原檔 */
export async function compressMedia(file, opts = {}) {
  if (file.type.startsWith('video/')) return compressVideo(file, opts);
  if (file.type.startsWith('image/')) return compressImage(file, opts);
  try { opts.onInfo?.({ compressed: false, reason: 'unsupported-type' }); } catch { /* */ }
  return file;
}

export default compressMedia;
