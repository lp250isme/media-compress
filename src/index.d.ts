export interface CompressInfo {
  /** 是否真的壓縮了(false = 回原檔) */
  compressed: boolean;
  /** 沒壓縮的原因:no-webcodecs|cannot-encode|no-output|not-smaller|error|not-video|not-image|no-canvas|unsupported-type */
  reason?: string;
  /** error 時的訊息 */
  message?: string;
  fromBytes?: number;
  toBytes?: number;
}

export interface CompressOptions {
  /** 圖片:最長邊上限(px),預設 1600 */
  maxDim?: number;
  /** 圖片:WebP 品質 0–1,預設 0.85 */
  quality?: number;
  /** 影片:最大高度(px),預設 480 */
  height?: number;
  /** 影片:目標位元率(bits/sec),預設 1_400_000 */
  bitrate?: number;
  /** 影片:音訊位元率(bits/sec),預設 128_000 */
  audioBitrate?: number;
  /** 影片:轉檔進度回呼,p 為 0–1 */
  onProgress?: (p: number) => void;
  /** 結果/原因回呼(壓了沒、為什麼沒壓) */
  onInfo?: (info: CompressInfo) => void;
}

/** 壓縮圖片為高品質 WebP;非圖片/GIF/壓不小/出錯 → 回原檔。SSR 安全。 */
export function compressImage(file: File, opts?: CompressOptions): Promise<File>;
/** 壓縮影片為 720p H.264 MP4(WebCodecs);無 WebCodecs/轉不動/壓不小 → 回原檔。SSR 安全。 */
export function compressVideo(file: File, opts?: CompressOptions): Promise<File>;
/** 依檔案型別自動壓縮(影片/圖片),其餘回原檔。 */
export function compressMedia(file: File, opts?: CompressOptions): Promise<File>;
export default compressMedia;
