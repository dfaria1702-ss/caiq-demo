// Live dub player (F9): the original video plays quietly while dubbed clips fire at each line's start.
import type { LangKey } from "./config";
import type { Line } from "./types";

type Clip = { url: string; rate: number };

export class DubPlayer {
  private video: HTMLVideoElement | null = null;
  private lines: Line[] = [];
  private clips = new Map<LangKey, Map<string, Clip>>();
  private audios = new Map<string, HTMLAudioElement>(); // key: `${lang}|${url}`
  private played = new Set<string>();
  private active: { lineId: string; audio: HTMLAudioElement }[] = [];
  private raf = 0;
  lang: LangKey | null = null;

  constructor(private onActive: (lineId: string | null) => void) {}

  attach(video: HTMLVideoElement) {
    if (this.video === video) return;
    this.detach();
    this.video = video;
    video.addEventListener("play", this.handlePlay);
    video.addEventListener("pause", this.handlePause);
    video.addEventListener("seeking", this.handleSeek);
    video.addEventListener("ended", this.handleEnded);
    if (!video.paused) this.handlePlay();
  }

  detach() {
    const v = this.video;
    if (!v) return;
    v.removeEventListener("play", this.handlePlay);
    v.removeEventListener("pause", this.handlePause);
    v.removeEventListener("seeking", this.handleSeek);
    v.removeEventListener("ended", this.handleEnded);
    cancelAnimationFrame(this.raf);
    this.stopAll();
    this.video = null;
  }

  setLines(lines: Line[]) {
    this.lines = [...lines].sort((a, b) => a.start - b.start);
    this.resetPlayed();
  }

  /** Replace the clips for one language (initial voicing or Re-dub). */
  setClips(lang: LangKey, clips: Map<string, Clip>) {
    for (const [key, a] of this.audios) {
      if (key.startsWith(`${lang}|`) && ![...clips.values()].some((c) => key === `${lang}|${c.url}`)) {
        a.pause();
        this.audios.delete(key);
      }
    }
    this.clips.set(lang, clips);
    for (const c of clips.values()) this.audioFor(lang, c); // preload for low start latency
  }

  clearClips(lang: LangKey) {
    this.setClips(lang, new Map());
  }

  setLanguage(lang: LangKey) {
    if (lang === this.lang) return;
    this.lang = lang;
    this.stopAll();
    const v = this.video;
    if (!v || v.paused) return;
    // Switched mid-line: restart that line in the new language (R-9.4).
    const t = v.currentTime;
    const current = this.lines.find((l) => t >= l.start && t < l.end);
    if (current) this.playLine(current.id, lang);
  }

  /** ▶ on a script row: play one line on its own. */
  preview(lineId: string, lang: LangKey) {
    this.stopAll();
    this.playLine(lineId, lang);
  }

  destroy() {
    this.detach();
    for (const a of this.audios.values()) a.pause();
    this.audios.clear();
  }

  private audioFor(lang: LangKey, clip: Clip) {
    const key = `${lang}|${clip.url}`;
    let a = this.audios.get(key);
    if (!a) {
      a = new Audio(clip.url);
      a.preload = "auto";
      a.preservesPitch = true;
      this.audios.set(key, a);
    }
    return a;
  }

  private playLine(lineId: string, lang: LangKey) {
    const clip = this.clips.get(lang)?.get(lineId);
    if (!clip) return;
    const audio = this.audioFor(lang, clip);
    audio.currentTime = 0;
    audio.playbackRate = clip.rate;
    audio.preservesPitch = true;
    const entry = { lineId, audio };
    this.active.push(entry);
    audio.onended = () => {
      this.active = this.active.filter((e) => e !== entry);
      this.emit();
    };
    audio.play().catch(() => {
      this.active = this.active.filter((e) => e !== entry);
      this.emit();
    });
    this.emit();
  }

  private tick = () => {
    const v = this.video;
    if (!v || v.paused || v.ended) return;
    const t = v.currentTime;
    for (const l of this.lines) {
      if (l.start > t) break;
      if (this.played.has(l.id)) continue;
      this.played.add(l.id);
      // Don't fire a line we've already passed by a lot (e.g. after a stall).
      if (this.lang && t < l.end + 0.25) this.playLine(l.id, this.lang);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private handlePlay = () => {
    for (const { audio } of this.active) if (!audio.ended) audio.play().catch(() => {});
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  };

  private handlePause = () => {
    cancelAnimationFrame(this.raf);
    for (const { audio } of this.active) audio.pause();
  };

  private handleSeek = () => {
    this.stopAll();
    this.resetPlayed();
  };

  private handleEnded = () => {
    cancelAnimationFrame(this.raf);
    this.stopAll();
    this.played.clear();
  };

  /** Lines before the playhead count as played; lines after it will fire again. */
  private resetPlayed() {
    const t = this.video?.currentTime ?? 0;
    this.played = new Set(this.lines.filter((l) => l.start < t - 0.01).map((l) => l.id));
  }

  private stopAll() {
    for (const { audio } of this.active) {
      audio.pause();
      audio.currentTime = 0;
    }
    this.active = [];
    this.emit();
  }

  private emit() {
    this.onActive(this.active.length ? this.active[this.active.length - 1].lineId : null);
  }
}
