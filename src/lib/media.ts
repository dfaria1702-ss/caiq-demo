// Browser-side media work (R-P4): audio extraction, frame capture, duration.
import { CONFIG } from "./config";

export function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(v.duration);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read this video. Try an MP4, WebM or MOV file."));
    };
    v.src = url;
  });
}

export function checkDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds)) return "Couldn't read the clip length.";
  if (seconds > CONFIG.MAX_SECONDS)
    return `This clip is ${seconds.toFixed(1)} s. Lehja dubs scenes up to ${CONFIG.MAX_LABEL} — trim it and try again.`;
  return null;
}

/** Decode → mono → 16 kHz → 16-bit PCM WAV → base64 (R-2.0a). */
export async function extractWav(file: File): Promise<string> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("This clip has no audio track we can read.");
  } finally {
    void ctx.close();
  }
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination); // 1-channel destination downmixes to mono
  src.start();
  const rendered = await offline.startRendering();
  return bytesToBase64(encodeWav(rendered.getChannelData(0), rate));
}

function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** Stage 2 input: one frame per second (t = 0.5, 1.5, …), up to CONFIG.MAX_FRAMES, as small JPEGs. Never throws. */
export async function captureFrames(file: File): Promise<{ t: number; data: string }[]> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  try {
    await waitFor(v, "loadeddata", 8000);
    const w = CONFIG.FRAME_WIDTH;
    const h = Math.round((v.videoHeight / v.videoWidth) * w) || Math.round((w * 9) / 16);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d")!;
    const count = Math.min(CONFIG.MAX_FRAMES, Math.max(1, Math.floor(v.duration)));
    const step = v.duration / count;
    const frames: { t: number; data: string }[] = [];
    for (let i = 0; i < count; i++) {
      const t = Math.round((i + 0.5) * step * 10) / 10;
      v.currentTime = t;
      await waitFor(v, "seeked", 4000);
      g.drawImage(v, 0, 0, w, h);
      frames.push({ t, data: canvas.toDataURL("image/jpeg", 0.6).split(",")[1] });
    }
    return frames;
  } catch {
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

function waitFor(el: HTMLElement, event: string, ms: number) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${event}`)), ms);
    el.addEventListener(event, () => (clearTimeout(t), resolve()), { once: true });
    el.addEventListener("error", () => (clearTimeout(t), reject(new Error("media error"))), { once: true });
  });
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBlobUrl(b64: string, type = "audio/mpeg"): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}

export function audioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(a.duration);
    a.onerror = () => reject(new Error("Couldn't read voiced clip"));
    a.src = url;
  });
}

/** Simple promise pool: at most `n` tasks in flight (R-8.4). */
export function createLimiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    queue.shift()!();
  };
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() =>
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          }),
      );
      next();
    });
}
