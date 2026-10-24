import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CONFIG, LANG_KEYS, langOf, type LangKey } from "./config";
import {
  STT_URL, SARVAM_URL, VOICES_URL, buildGeminiBody, buildSarvamBody, buildTtsBody, geminiUrl, sanitizeTts,
  shortenUser, sttFields, transcreateRetrySuffix, transcreateSystem, transcreateUser, ttsUrl, type SpeakInput,
} from "./prompts";
import { countSyllables, maxSyllables, segmentWords } from "./segment";
import { AGES, EMOTIONS, NON_VERBALS, REGISTERS, TONES, type AccountVoice, type Character, type Line, type Scene } from "./types";

// Live by default. Dummy data ONLY when LEHJA_MOCK=1 — a missing key is an error, never a silent fallback.
const MOCK = () => process.env.LEHJA_MOCK === "1";
const mock = () => import("./mock.server");
function key(name: "ELEVENLABS_API_KEY" | "GEMINI_API_KEY" | "SARVAM_API_KEY") {
  const k = process.env[name];
  if (!k) throw new Error(`${name} is missing — add it to app/.env.local and restart the dev server.`);
  return k;
}

// ───────────── shared schemas ─────────────
const lineSchema = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  slotSeconds: z.number(),
  speakerId: z.string(),
  text: z.string(),
  nonVerbal: z.array(z.string()).optional(),
  lowConfidence: z.array(z.string()).optional(),
  characterId: z.string().optional(),
  addresseeId: z.string().optional(),
  emotion: z.enum(EMOTIONS).optional(),
  intensity: z.number().optional(),
  delivery: z.string().optional(),
  emphasis: z.string().optional(),
  subtext: z.string().optional(),
});

const characterSchema = z.object({
  id: z.string(),
  name: z.string(),
  speakerIds: z.array(z.string()),
  gender: z.enum(["male", "female", "unknown"]),
  age: z.enum(AGES).catch("20s"),
  voice: z.object({
    pitch: z.enum(["low", "mid", "high"]).catch("mid"),
    pace: z.enum(["slow", "medium", "fast"]).catch("medium"),
    energy: z.enum(["calm", "lively", "intense"]).catch("lively"),
    texture: z.string().catch(""),
  }),
  personality: z.string().catch(""),
  voiceId: z.string().optional(),
  voiceName: z.string().optional(),
  color: z.string().optional(),
});

const relationshipSchema = z.object({ between: z.array(z.string()), relation: z.string(), register: z.enum(REGISTERS).catch("familiar") });
const sceneSchema = z.object({ summary: z.string(), tone: z.enum(TONES).catch("neutral"), relationships: z.array(relationshipSchema) });

// ═════════ Stage 1 · Transcribe (ElevenLabs Scribe) ═════════
// Built during the Creative AI & Quantum Hackathon organised by StreetKode Fam during Indian Krump Festival 14
export const transcribe = createServerFn({ method: "POST" })
  .validator(z.object({ wavBase64: z.string().min(100), numSpeakers: z.number().int().min(1).max(8).optional() }))
  .handler(async ({ data }) => {
    if (MOCK()) return (await mock()).mockTranscribe(data.wavBase64);
    const apiKey = key("ELEVENLABS_API_KEY");

    // The browser builds a WAV (44-byte header + samples); Scribe's pcm_s16le_16 mode wants only the samples.
    const pcm = Buffer.from(data.wavBase64, "base64").subarray(44);
    const form = new FormData();
    form.append("file", new Blob([pcm], { type: "application/octet-stream" }), "clip.pcm");
    for (const [k, v] of Object.entries(sttFields(data.numSpeakers))) form.append(k, v);

    const res = await timed("ElevenLabs transcription", CONFIG.TIMEOUT_MS.stt, (signal) => fetch(STT_URL, { method: "POST", signal, headers: { "xi-api-key": apiKey }, body: form }));
    if (!res.ok) throw new Error(`ElevenLabs transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const lines = segmentWords(json.words ?? []);
    if (!lines.length) throw new Error("No speech detected in this clip.");
    return { languageCode: json.language_code as string, languageProbability: json.language_probability as number, lines };
  });

// ═════════ Stage 2 · Scene analysis (Gemini) ═════════
const geminiOut = z.object({
  sceneSummary: z.string(),
  tone: z.enum(TONES).catch("neutral"),
  characters: z.array(characterSchema.omit({ voiceId: true, voiceName: true, color: true })),
  relationships: z.array(relationshipSchema).catch([]),
  lines: z.array(
    z.object({
      id: z.string(),
      characterId: z.string(),
      addresseeId: z.string().catch("group"),
      emotion: z.enum(EMOTIONS).catch("neutral"),
      intensity: z.number().catch(5),
      delivery: z.string().catch(""),
      nonVerbal: z.array(z.string()).catch([]),
      emphasis: z.string().optional(),
      subtext: z.string().catch(""),
    }),
  ),
});

// Built during the Creative AI & Quantum Hackathon organised by StreetKode Fam during Indian Krump Festival 14
export const analyzeScene = createServerFn({ method: "POST" })
  .validator(
    z.object({
      wavBase64: z.string(),
      frames: z.array(z.object({ t: z.number(), data: z.string() })),
      lines: z.array(lineSchema),
      durationSeconds: z.number(),
    }),
  )
  .handler(async ({ data }): Promise<{ scene: Scene; characters: Character[]; lines: Line[] }> => {
    if (MOCK()) return (await mock()).mockAnalyzeScene(data.lines);
    const apiKey = key("GEMINI_API_KEY");

    const res = await timed("Gemini", CONFIG.TIMEOUT_MS.gemini, (signal) => fetch(geminiUrl(), {
      method: "POST",
      signal,
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(buildGeminiBody(data.wavBase64, data.frames, data.lines, data.durationSeconds)),
    }));
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const text: string = json.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    const parsed = geminiOut.safeParse(safeJson(text));
    if (!parsed.success) throw new Error(`Gemini returned unexpected JSON: ${parsed.error.message.slice(0, 200)}`);
    const g = parsed.data;

    const byId = new Map(g.lines.map((l) => [l.id, l]));
    const allowedNv = new Set<string>(NON_VERBALS);
    return {
      scene: { summary: g.sceneSummary, tone: g.tone, relationships: g.relationships },
      characters: g.characters,
      // Timing and text always come from Scribe: only the analysis fields are merged.
      lines: data.lines.map((l) => {
        const a = byId.get(l.id);
        if (!a) return l;
        const nonVerbal = [...new Set([...(l.nonVerbal ?? []), ...a.nonVerbal].filter((n) => allowedNv.has(n)))];
        return {
          ...l,
          characterId: a.characterId,
          addresseeId: a.addresseeId,
          emotion: a.emotion,
          intensity: Math.min(10, Math.max(1, Math.round(a.intensity))),
          delivery: a.delivery,
          nonVerbal: nonVerbal.length ? nonVerbal : undefined,
          emphasis: a.emphasis || undefined,
          subtext: a.subtext,
        };
      }),
    };
  });

// ═════════ Stage 3 · Transcreate + tags (Sarvam) ═════════
const scriptLine = z.object({ id: z.string(), text: z.string().min(1), transliteration: z.string(), ttsText: z.string().min(1), note: z.string() });
type ScriptLine = z.infer<typeof scriptLine>;

/** One Sarvam call that must return exactly `ids`; retries once with the validation error. */
async function sarvam(system: string, user: string, ids: string[], label: string): Promise<ScriptLine[]> {
  const apiKey = key("SARVAM_API_KEY");
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = attempt === 0 ? user : user + transcreateRetrySuffix(lastError);
    const res = await timed("Sarvam", CONFIG.TIMEOUT_MS.sarvam, (signal) => fetch(SARVAM_URL, {
      method: "POST",
      signal,
      headers: { "api-subscription-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(buildSarvamBody(system, content)),
    }));
    if (!res.ok) throw new Error(`Sarvam ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const choice = json.choices?.[0];
    if (choice?.finish_reason === "length" && !choice?.message?.content) {
      lastError = "ran out of tokens before answering — answer more briefly";
      continue;
    }
    const raw: string = choice?.message?.content ?? "";
    const parsed = z.object({ lines: z.array(scriptLine) }).safeParse(safeJson(raw.replace(/<think>[\s\S]*?<\/think>/g, "")));
    if (parsed.success) {
      const byId = new Map(parsed.data.lines.map((l) => [l.id, l]));
      const missing = ids.filter((id) => !byId.has(id));
      if (!missing.length) return ids.map((id) => ({ ...byId.get(id)!, ttsText: sanitizeTts(byId.get(id)!.ttsText) }));
      lastError = `missing line ids: ${missing.join(", ")}`;
    } else {
      lastError = parsed.error.message.slice(0, 300);
    }
  }
  throw new Error(`Sarvam (${label}) returned an invalid script twice: ${lastError}`);
}

const OVER_BUDGET = 1.15;

/** Ask Sarvam to shorten specific lines to their syllable budget; returns the merged script. */
async function shortenLines(system: string, script: ScriptLine[], lines: Line[], targetIds: string[], label: string) {
  const targets = targetIds.map((id) => {
    const s = script.find((x) => x.id === id)!;
    const l = lines.find((x) => x.id === id)!;
    return { id, text: s.text, ttsText: s.ttsText, maxSyllables: maxSyllables(l.slotSeconds), currentSyllables: countSyllables(s.transliteration) };
  });
  const shorter = await sarvam(system, shortenUser(targets), targetIds, `${label} · shorten`);
  const byId = new Map(shorter.map((s) => [s.id, s]));
  return script.map((s) => byId.get(s.id) ?? s);
}

const transcreateInput = z.object({
  langKey: z.enum(LANG_KEYS as [LangKey, ...LangKey[]]),
  slangLevel: z.number().int().min(0).max(4),
  scene: sceneSchema,
  characters: z.array(characterSchema),
  lines: z.array(lineSchema),
});

// Built during the Creative AI & Quantum Hackathon organised by StreetKode Fam during Indian Krump Festival 14
export const transcreate = createServerFn({ method: "POST" })
  .validator(transcreateInput)
  .handler(async ({ data }) => {
    if (MOCK()) return (await mock()).mockTranscreate(data.langKey, data.slangLevel, data.lines);
    const label = langOf(data.langKey).name;
    const system = transcreateSystem(data.langKey, data.slangLevel);
    let script = await sarvam(system, transcreateUser(data.scene, data.characters, data.lines), data.lines.map((l) => l.id), label);

    // Lines well over their syllable budget get ONE automatic shortening pass, before the user ever sees them.
    const over = data.lines
      .filter((l) => countSyllables(script.find((s) => s.id === l.id)!.transliteration) > maxSyllables(l.slotSeconds) * OVER_BUDGET)
      .map((l) => l.id);
    if (over.length) {
      try {
        script = await shortenLines(system, script, data.lines, over, label);
      } catch {
        // keep the original script; the Long badge + Shorten button cover it after voicing
      }
    }
    return { lines: script };
  });

// Built during the Creative AI & Quantum Hackathon organised by StreetKode Fam during Indian Krump Festival 14
// The "Shorten" button on a Long line: rewrites just that line to fit.
export const shorten = createServerFn({ method: "POST" })
  .validator(transcreateInput.extend({ lineId: z.string(), current: scriptLine }))
  .handler(async ({ data }) => {
    if (MOCK()) return (await mock()).mockShorten(data.current);
    const system = transcreateSystem(data.langKey, data.slangLevel);
    const [line] = await shortenLines(system, [data.current], data.lines, [data.lineId], langOf(data.langKey).name);
    return { line };
  });

// ═════════ Stage 4 · Voices + speech (ElevenLabs) ═════════
// Built during the Creative AI & Quantum Hackathon organised by StreetKode Fam during Indian Krump Festival 14
// The voices in the user's own ElevenLabs account, for casting — never hardcoded.
export const listVoices = createServerFn({ method: "GET" }).handler(async (): Promise<AccountVoice[]> => {
  if (MOCK()) return (await mock()).mockVoices();
  const res = await fetch(VOICES_URL, { headers: { "xi-api-key": key("ELEVENLABS_API_KEY") } });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  type V = { voice_id: string; name: string; category?: string; description?: string; labels?: Record<string, string> };
  return (json.voices ?? []).map((v: V) => ({
    id: v.voice_id,
    name: v.name,
    gender: v.labels?.gender === "male" || v.labels?.gender === "female" ? v.labels.gender : "unknown",
    age: v.labels?.age,
    accent: v.labels?.accent,
    description: [v.labels?.description, v.labels?.descriptive, v.description].filter(Boolean).join(" · "),
    category: v.category,
  }));
});

// Built during the Creative AI & Quantum Hackathon organised by StreetKode Fam during Indian Krump Festival 14
export const speak = createServerFn({ method: "POST" })
  .validator(
    z.object({
      voiceId: z.string().min(1),
      ttsText: z.string().min(1),
      langKey: z.enum(LANG_KEYS as [LangKey, ...LangKey[]]),
      seed: z.number().int(),
      previousText: z.string().optional(),
      nextText: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    if (MOCK()) return (await mock()).mockSpeak(data.voiceId, data.ttsText);
    const apiKey = key("ELEVENLABS_API_KEY");
    const input: SpeakInput = data;
    let withContext = true;
    for (let attempt = 0; ; attempt++) {
      const res = await timed("ElevenLabs speech", CONFIG.TIMEOUT_MS.tts, (signal) => fetch(ttsUrl(data.voiceId), {
        method: "POST",
        signal,
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify(buildTtsBody(input, withContext)),
      }));
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      // If the model rejects previous/next context, retry once without it.
      if (res.status >= 400 && res.status < 500 && res.status !== 401 && withContext && (data.previousText || data.nextText)) {
        withContext = false;
        continue;
      }
      if (!res.ok) throw new Error(`ElevenLabs speech ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { audioBase64: Buffer.from(await res.arrayBuffer()).toString("base64") };
    }
  });

// Built during the Creative AI & Quantum Hackathon organised by StreetKode Fam during Indian Krump Festival 14
// Reports live vs demo mode and which keys are missing (names only — never the keys).
export const backendStatus = createServerFn({ method: "GET" }).handler(async () => ({
  mock: MOCK(),
  missing: (["ELEVENLABS_API_KEY", "GEMINI_API_KEY", "SARVAM_API_KEY"] as const).filter((k) => !process.env[k]),
}));

/** fetch with a hard timeout and a readable error (never hang the UI). */
async function timed(label: string, ms: number, run: (signal: AbortSignal) => Promise<Response>) {
  try {
    return await run(AbortSignal.timeout(ms));
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    if (err.name === "TimeoutError" || err.name === "AbortError") throw new Error(`${label} didn't respond within ${ms / 1000}s — press Retry.`);
    throw new Error(`${label} request failed: ${err.cause?.code ?? err.message}`);
  }
}

/** Parse the first {...} object in a model reply (tolerates fences / prose). */
function safeJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
