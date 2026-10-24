// Demo-mode backends, used ONLY when LEHJA_MOCK=1 (never as a silent fallback for a missing key).
// Imported dynamically from server functions, so it never reaches the browser.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LangKey } from "./config";
import {
  MOCK_CHARACTERS,
  MOCK_DUBS,
  MOCK_LINE_ANALYSIS,
  MOCK_SCENE,
  mockWords,
} from "./mock.data";
import { segmentWords } from "./segment";
import type { AccountVoice, Line } from "./types";

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (min: number, max: number) => sleep(min + Math.random() * (max - min));

// LEHJA_MOCK_FAIL="analyzeScene,transcreate:gu" fails the FIRST matching call, to exercise Retry.
const failed = new Set<string>();
function maybeFail(name: string) {
  const spec = (process.env.LEHJA_MOCK_FAIL ?? "").split(",").map((s) => s.trim());
  if (spec.includes(name) && !failed.has(name)) {
    failed.add(name);
    throw new Error(`Mock failure injected for ${name} (LEHJA_MOCK_FAIL)`);
  }
}

export async function mockTranscribe(wavBase64: string) {
  maybeFail("transcribe");
  await jitter(900, 1500);
  // 16 kHz mono 16-bit WAV: 32 000 bytes per second after the 44-byte header.
  const bytes = Math.floor((wavBase64.length * 3) / 4);
  const seconds = Math.max(1, (bytes - 44) / 32000);
  return { languageCode: "eng", languageProbability: 0.98, lines: segmentWords(mockWords(seconds)) };
}

export async function mockAnalyzeScene(lines: Line[]) {
  maybeFail("analyzeScene");
  await jitter(1400, 2200);
  return {
    scene: MOCK_SCENE,
    characters: MOCK_CHARACTERS,
    lines: lines.map((l) => ({ ...l, ...MOCK_LINE_ANALYSIS[l.id] })),
  };
}

export async function mockShorten(current: { id: string; text: string; transliteration: string; ttsText: string; note: string }) {
  await jitter(600, 1200);
  const cut = (t: string) => t.split(/[,،]/)[0].trim();
  return { line: { ...current, text: cut(current.text), transliteration: cut(current.transliteration), ttsText: cut(current.ttsText), note: "Shortened to fit the slot (demo mode)." } };
}

const DEMO_VOICES: AccountVoice[] = [
  { id: "demo-male-1", name: "Demo male 1", gender: "male", age: "young", accent: "indian" },
  { id: "demo-male-2", name: "Demo male 2", gender: "male", age: "middle_aged", accent: "indian" },
  { id: "demo-female-1", name: "Demo female 1", gender: "female", age: "young", accent: "indian" },
  { id: "demo-female-2", name: "Demo female 2", gender: "female", age: "middle_aged", accent: "indian" },
];
export async function mockVoices() {
  return DEMO_VOICES;
}

export async function mockTranscreate(langKey: LangKey, slangLevel: number, lines: Line[]) {
  maybeFail(`transcreate:${langKey}`);
  await jitter(1200, 3000);
  const variant = slangLevel <= 1 ? MOCK_DUBS[langKey].formal : MOCK_DUBS[langKey].casual;
  return {
    lines: lines.map((l, i) => {
      const m = variant[i % variant.length];
      return { id: l.id, text: m.text, transliteration: m.transliteration, ttsText: `${m.tags} ${m.text}`, note: m.note };
    }),
  };
}

/**
 * Demo TTS: macOS `say` (Lekha, hi-IN) → ffmpeg → MP3, same format as ElevenLabs.
 * Male voices are pitched down so two characters sound different.
 */
export async function mockSpeak(voiceId: string, ttsText: string) {
  maybeFail("speak");
  const male = voiceId.includes("male-") && !voiceId.includes("female");
  const variant = voiceId.endsWith("-2") ? 1 : 0;
  const spoken = ttsText.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();

  const dir = await mkdtemp(join(tmpdir(), "lehja-"));
  try {
    const wav = join(dir, "a.wav");
    const mp3 = join(dir, "a.mp3");
    await run("say", ["-v", "Lekha", "-r", male ? "175" : "190", "--file-format=WAVE", "--data-format=LEI16@22050", "-o", wav, spoken]);
    const pitch = male ? (variant > 0 ? 0.8 : 0.74) : variant > 0 ? 1.06 : 1;
    const filter = `asetrate=22050*${pitch},aresample=44100,atempo=${(1 / pitch).toFixed(4)}`;
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-af", filter, "-c:a", "libmp3lame", "-b:a", "128k", mp3]);
    return { audioBase64: (await readFile(mp3)).toString("base64") };
  } catch (e) {
    throw new Error(`Mock TTS failed (needs macOS 'say' + ffmpeg): ${(e as Error).message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
