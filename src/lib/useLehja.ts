import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIG, LANG_KEYS, type LangKey } from "./config";
import { castVoices } from "./cast";
import { analyzeScene, listVoices, shorten, speak, transcreate, transcribe } from "./dub.functions";
import { audioDuration, base64ToBlobUrl, captureFrames, checkDuration, createLimiter, extractWav, readDuration } from "./media";
import { seedFor, stripTags } from "./prompts";
import { fitClip } from "./segment";
import type { Character, Dub, DubLine, Line, Scene } from "./types";

export type StepKey = "extract" | "transcribe" | "analyze" | "cast";
export type StepState = { status: "idle" | "running" | "done" | "error"; error?: string; ms?: number };

const freshSteps = (): Record<StepKey, StepState> => ({
  extract: { status: "idle" },
  transcribe: { status: "idle" },
  analyze: { status: "idle" },
  cast: { status: "idle" },
});
const freshDubs = (): Record<LangKey, Dub> =>
  Object.fromEntries(
    LANG_KEYS.map((k) => [k, { langKey: k, slangLevel: CONFIG.DEFAULT_SLANG, status: "idle", lines: [], voiced: 0 } satisfies Dub]),
  ) as unknown as Record<LangKey, Dub>;

const limit = createLimiter(CONFIG.TTS_CONCURRENCY); // shared across languages (avoids ElevenLabs rate limits)
const emptyScene = (): Scene => ({ summary: "", tone: "neutral", relationships: [] });

/**
 * Pipeline: (1) transcribe → (2) Gemini scene analysis → cast voices from the user's account — once per clip.
 * Then per language, on demand: (3) Sarvam translation → user reviews → (4) ElevenLabs voices.
 */
export function useLehja() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [numSpeakers, setNumSpeakers] = useState<number | null>(null); // null = Auto
  const [steps, setSteps] = useState(freshSteps);
  const [detected, setDetected] = useState<{ code: string; prob: number } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [scene, setScene] = useState<Scene>(emptyScene);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [dubs, setDubs] = useState(freshDubs);

  // Refs mirror state so async steps always see the latest values.
  const stepsRef = useRef(steps);
  const data = useRef({ wav: "", frames: [] as { t: number; data: string }[], lines: [] as Line[], scene: emptyScene(), characters: [] as Character[] });
  const core = useRef<Promise<void> | null>(null);
  const tokens = useRef<Record<string, number>>({});
  const lastLang = useRef<LangKey>("hi");
  const dubsRef = useRef(dubs);
  dubsRef.current = dubs;
  const speakersRef = useRef(numSpeakers);
  speakersRef.current = numSpeakers;

  const setStep = (k: StepKey, s: StepState) => {
    stepsRef.current = { ...stepsRef.current, [k]: s };
    setSteps(stepsRef.current);
  };
  const patchDub = (k: LangKey, p: Partial<Dub> | ((d: Dub) => Partial<Dub>)) =>
    setDubs((all) => ({ ...all, [k]: { ...all[k], ...(typeof p === "function" ? p(all[k]) : p) } }));
  const patchLine = (k: LangKey, lineId: string, p: Partial<DubLine>) =>
    patchDub(k, (d) => ({ lines: d.lines.map((x) => (x.lineId === lineId ? { ...x, ...p } : x)) }));
  const revoke = (k: LangKey) => dubsRef.current[k].lines.forEach((l) => l.audioUrl && URL.revokeObjectURL(l.audioUrl));
  const bump = (k: LangKey) => (tokens.current[k] = (tokens.current[k] ?? 0) + 1);

  const selectFile = useCallback(async (f: File) => {
    setUploadError(null);
    if (!/^video\/(mp4|webm|quicktime)$/.test(f.type)) {
      setUploadError("Please choose an MP4, WebM or MOV video.");
      return;
    }
    let secs: number;
    try {
      secs = await readDuration(f);
    } catch (e) {
      setUploadError((e as Error).message);
      return;
    }
    const err = checkDuration(secs);
    if (err) {
      setUploadError(err);
      return;
    }
    LANG_KEYS.forEach((k) => {
      revoke(k);
      bump(k);
    });
    setVideoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
    setFile(f);
    setDuration(secs);
    stepsRef.current = freshSteps();
    setSteps(stepsRef.current);
    data.current = { wav: "", frames: [], lines: [], scene: emptyScene(), characters: [] };
    core.current = null;
    setDetected(null);
    setLines([]);
    setCharacters([]);
    setScene(emptyScene());
    setDubs(freshDubs());
  }, []);

  const timed = async (k: StepKey, fn: () => Promise<void>) => {
    if (stepsRef.current[k].status === "done") return; // completed steps are never redone
    const t0 = performance.now();
    setStep(k, { status: "running" });
    try {
      await fn();
      setStep(k, { status: "done", ms: performance.now() - t0 });
    } catch (e) {
      setStep(k, { status: "error", error: (e as Error).message || String(e) });
      throw e;
    }
  };

  /** Stages 1–2 + casting, once per clip. Concurrent callers share the same run. */
  const ensureScene = useCallback((f: File, secs: number) => {
    if (stepsRef.current.cast.status === "done") return Promise.resolve();
    if (core.current) return core.current;
    core.current = (async () => {
      await timed("extract", async () => {
        const [wav, frames] = await Promise.all([extractWav(f), captureFrames(f)]);
        data.current.wav = wav;
        data.current.frames = frames;
      });
      await timed("transcribe", async () => {
        const r = await transcribe({ data: { wavBase64: data.current.wav, numSpeakers: speakersRef.current ?? undefined } });
        data.current.lines = r.lines;
        setLines(r.lines);
        setDetected({ code: r.languageCode, prob: r.languageProbability });
      });
      await timed("analyze", async () => {
        const r = await analyzeScene({ data: { wavBase64: data.current.wav, frames: data.current.frames, lines: data.current.lines, durationSeconds: secs } });
        data.current = { ...data.current, lines: r.lines, scene: r.scene, characters: r.characters };
        setLines(r.lines);
        setScene(r.scene);
        setCharacters(r.characters);
      });
      await timed("cast", async () => {
        const voices = await listVoices();
        if (!voices.length) throw new Error("Your ElevenLabs account has no voices. Add some in the Voice Library, then retry.");
        const cast = castVoices(data.current.characters, voices);
        const uncast = cast.filter((c) => !c.voiceId);
        if (uncast.length) throw new Error(`No suitable voice for ${uncast.map((c) => `${c.name} (${c.gender})`).join(", ")} — add more voices in ElevenLabs, then retry.`);
        data.current.characters = cast;
        setCharacters(cast);
      });
    })().finally(() => {
      core.current = null;
    });
    return core.current;
  }, []);

  /** Stage 3 for one language: write the script. Nothing is voiced until the user confirms. */
  const translate = useCallback(
    async (k: LangKey) => {
      if (!file) return;
      lastLang.current = k;
      const token = bump(k);
      const stale = () => tokens.current[k] !== token;
      revoke(k);
      patchDub(k, { status: "translating", lines: [], voiced: 0, error: undefined, errorStage: undefined });
      try {
        await ensureScene(file, duration);
      } catch {
        if (!stale()) patchDub(k, { status: "idle" }); // the failed scene step shows its own error + retry
        return;
      }
      try {
        const { lines, scene, characters } = data.current;
        const slangLevel = dubsRef.current[k].slangLevel;
        const out = await transcreate({ data: { langKey: k, slangLevel, scene, characters, lines } });
        if (stale()) return;
        const dubLines: DubLine[] = out.lines.map((l) => ({ lineId: l.id, text: l.text, transliteration: l.transliteration, ttsText: l.ttsText, note: l.note }));
        patchDub(k, { status: "translated", lines: dubLines, translatedAt: slangLevel });
      } catch (e) {
        if (!stale()) patchDub(k, { status: "error", errorStage: "translate", error: (e as Error).message || String(e) });
      }
    },
    [file, duration, ensureScene],
  );

  /** Stage 4 for one line: voice it in its character's voice, with the neighbouring lines as context. */
  const voiceLine = async (k: LangKey, dl: DubLine, all: DubLine[]) => {
    const { lines, characters } = data.current;
    const line = lines.find((l) => l.id === dl.lineId)!;
    const ch = characters.find((c) => c.id === line.characterId) ?? characters[0];
    const i = all.findIndex((x) => x.lineId === dl.lineId);
    const { audioBase64 } = await speak({
      data: {
        voiceId: ch.voiceId!,
        ttsText: dl.ttsText,
        langKey: k,
        seed: seedFor(ch.id),
        previousText: i > 0 ? stripTags(all[i - 1].ttsText) : undefined,
        nextText: i < all.length - 1 ? stripTags(all[i + 1].ttsText) : undefined,
      },
    });
    const audioUrl = base64ToBlobUrl(audioBase64);
    const dur = await audioDuration(audioUrl);
    return { audioUrl, duration: dur, ...fitClip(dur, line.slotSeconds) };
  };

  /** Stage 4 for one language: the user approved the script — voice every line. */
  const dub = useCallback(async (k: LangKey) => {
    const d = dubsRef.current[k];
    if (!d.lines.length) return;
    const token = bump(k);
    const stale = () => tokens.current[k] !== token;
    revoke(k);
    const dubLines = d.lines.map(({ audioUrl, duration, playbackRate, fit, busy, ...rest }) => rest);
    patchDub(k, { status: "voicing", lines: dubLines, voiced: 0, error: undefined, errorStage: undefined });
    try {
      await Promise.all(
        dubLines.map((dl) =>
          limit(async () => {
            if (stale()) return;
            const r = await voiceLine(k, dl, dubLines);
            if (stale()) return URL.revokeObjectURL(r.audioUrl);
            patchDub(k, (cur) => ({ voiced: cur.voiced + 1, lines: cur.lines.map((x) => (x.lineId === dl.lineId ? { ...x, ...r } : x)) }));
          }),
        ),
      );
      if (!stale()) patchDub(k, { status: "ready" });
    } catch (e) {
      if (!stale()) patchDub(k, { status: "error", errorStage: "voice", error: (e as Error).message || String(e) });
    }
  }, []);

  /** "Shorten" on a Long line: Sarvam trims that one line, then only it is re-voiced. */
  const shortenLine = useCallback(async (k: LangKey, lineId: string) => {
    const d = dubsRef.current[k];
    const cur = d.lines.find((l) => l.lineId === lineId);
    if (!cur) return;
    patchLine(k, lineId, { busy: true });
    try {
      const { lines, scene, characters } = data.current;
      const { line } = await shorten({
        data: {
          langKey: k, slangLevel: d.translatedAt ?? d.slangLevel, scene, characters, lines, lineId,
          current: { id: lineId, text: cur.text, transliteration: cur.transliteration, ttsText: cur.ttsText, note: cur.note },
        },
      });
      const updated: DubLine = { ...cur, text: line.text, transliteration: line.transliteration, ttsText: line.ttsText, note: line.note };
      if (cur.audioUrl) {
        const all = dubsRef.current[k].lines.map((x) => (x.lineId === lineId ? updated : x));
        const r = await voiceLine(k, updated, all);
        URL.revokeObjectURL(cur.audioUrl);
        patchLine(k, lineId, { ...updated, ...r, busy: false });
      } else {
        patchLine(k, lineId, { ...updated, busy: false });
      }
    } catch (e) {
      patchLine(k, lineId, { busy: false });
      patchDub(k, { error: (e as Error).message || String(e) });
    }
  }, []);

  const retry = (k: LangKey) => (dubsRef.current[k].errorStage === "voice" ? dub(k) : translate(k));
  /** Retry a failed scene step for the language that asked for it. */
  const retryScene = () => translate(lastLang.current);
  const setSlang = (k: LangKey, level: number) => patchDub(k, { slangLevel: level });

  const sceneBusy = Object.values(steps).some((s) => s.status === "running");

  useEffect(() => () => LANG_KEYS.forEach(revoke), []);

  return {
    file, videoUrl, duration, uploadError, numSpeakers, steps, detected, lines, scene, characters, dubs, sceneBusy,
    selectFile, setNumSpeakers, translate, dub, shortenLine, retry, retryScene, setSlang,
  };
}

export type Lehja = ReturnType<typeof useLehja>;
