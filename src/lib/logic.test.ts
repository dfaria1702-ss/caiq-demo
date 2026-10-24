import { describe, expect, it } from "vitest";
import { castVoices, scoreVoice } from "./cast";
import { mockWords } from "./mock.data";
import { buildGeminiBody, buildTtsBody, sanitizeTts, seedFor, sttFields, transcreateSystem, transcreateUser } from "./prompts";
import { countSyllables, fitClip, maxSyllables, segmentWords } from "./segment";
import type { AccountVoice, Character, Line, ScribeWord } from "./types";

const w = (text: string, start: number, end: number, speaker = "s0", type: ScribeWord["type"] = "word", logprob?: number): ScribeWord => ({ text, start, end, type, speaker_id: speaker, logprob });

describe("stage 1 · segmentation", () => {
  it("splits on speaker change", () => {
    const lines = segmentWords([w("Hi", 0, 0.3), w("there", 0.35, 0.6), w("Yo", 0.7, 0.9, "s1")]);
    expect(lines.map((l) => l.text)).toEqual(["Hi there", "Yo"]);
  });

  it("splits on a pause > 0.6 s but not 0.5 s", () => {
    expect(segmentWords([w("a", 0, 0.2), w("b", 0.7, 0.9)])).toHaveLength(1);
    expect(segmentWords([w("a", 0, 0.2), w("b", 0.85, 1)])).toHaveLength(2);
  });

  it("never lets a line pass 7 s", () => {
    const lines = segmentWords(Array.from({ length: 20 }, (_, i) => w(`w${i}`, i * 0.5, i * 0.5 + 0.4)));
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.end - l.start).toBeLessThanOrEqual(7);
  });

  it("past 4 s, a sentence end starts a new line", () => {
    const words = [w("This", 0, 1), w("is", 1.1, 2), w("long.", 2.1, 4.3), w("Next", 4.4, 4.8), w("one", 4.9, 5.2)];
    expect(segmentWords(words).map((l) => l.text)).toEqual(["This is long.", "Next one"]);
  });

  it("skips spacing, attaches audio events, flags unsure words, ids L01…", () => {
    const lines = segmentWords([
      w("(laughs)", 0, 0.2, undefined, "audio_event"),
      w("Ha", 0.3, 0.5),
      w(" ", 0.5, 0.55, "s0", "spacing"),
      w("okay,", 0.55, 0.8, "s0", "word", -1.5),
      w("Next", 3, 3.4, "s1", "word", -0.1),
    ]);
    expect(lines.map((l) => l.id)).toEqual(["L01", "L02"]);
    expect(lines[0].text).toBe("Ha okay,");
    expect(lines[0].nonVerbal).toEqual(["laughs"]);
    expect(lines[0].lowConfidence).toEqual(["okay"]);
    expect(lines[1].lowConfidence).toBeUndefined();
  });

  it("slot runs into the following silence: until next start − 0.15 s, max 1 s past the end", () => {
    const [a, b] = segmentWords([w("a", 0, 1), w("b", 1.5, 2, "s1")]);
    expect(a.slotSeconds).toBeCloseTo(1.35); // next starts at 1.5 → 1.5 − 0.15
    expect(b.slotSeconds).toBeCloseTo(1.5); // last line: end + 1.0 overhang
    const [c] = segmentWords([w("c", 0, 1), w("d", 5, 6, "s1")]);
    expect(c.slotSeconds).toBeCloseTo(2); // capped at end + 1.0
  });

  it("the demo scene segments into 8 lines, 2 speakers", () => {
    const lines = segmentWords(mockWords(26));
    expect(lines).toHaveLength(8);
    expect(new Set(lines.map((l) => l.speakerId)).size).toBe(2);
  });

  it("Scribe request: raw PCM, deterministic, speakers only when set", () => {
    expect(sttFields()).toMatchObject({ file_format: "pcm_s16le_16", diarize: "true", temperature: "0", timestamps_granularity: "word", tag_audio_events: "true" });
    expect(sttFields()).not.toHaveProperty("num_speakers");
    expect(sttFields(2).num_speakers).toBe("2");
  });
});

const line = (over: Partial<Line> = {}): Line => ({ id: "L01", start: 1, end: 2, slotSeconds: 1.4, speakerId: "speaker_0", text: "Hi", ...over });
const char = (id: string, gender: Character["gender"], over: Partial<Character> = {}): Character => ({
  id, name: id, speakerIds: [], gender, age: "20s", voice: { pitch: "mid", pace: "medium", energy: "lively", texture: "" }, personality: "", ...over,
});

describe("stage 2 · Gemini request", () => {
  it("labels every frame with its time and the line being spoken", () => {
    const body = buildGeminiBody("WAV", [{ t: 1.5, data: "F1" }, { t: 5.5, data: "F2" }], [line()], 6);
    const texts = body.contents[0].parts.map((p) => ("text" in p ? p.text : "<img>"));
    expect(texts).toContain("FRAME t=1.5s · during L01 (speaker_0)");
    expect(texts).toContain("FRAME t=5.5s · silence");
    expect(body.systemInstruction.parts[0].text).toMatch(/dubbing director/);
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("low");
  });
});

describe("stage 3 · Sarvam prompt + post-processing", () => {
  it("marks the chosen slang level and uses Hinglish rules", () => {
    const sys = transcreateSystem("hi", 3);
    expect(sys).toMatch(/3 Colloquial: .*← WRITE AT THIS LEVEL/);
    expect(sys).toMatch(/Hinglish/);
    expect(transcreateSystem("mr", 0)).toMatch(/0 Formal: .*← WRITE AT THIS LEVEL/);
  });

  it("sends speaker, addressee and a syllable budget per line", () => {
    const u = JSON.parse(transcreateUser({ summary: "s", tone: "comedy", relationships: [] }, [char("C1", "male")], [line({ characterId: "C1", addresseeId: "C2", slotSeconds: 2 })]));
    expect(u.lines[0]).toMatchObject({ speaker: "C1", addressee: "C2", maxSyllables: 9 });
  });

  it("keeps only allowed tags, at most two", () => {
    expect(sanitizeTts("[Angry] [laughs] [whispers] अरे [dramatic music] यार")).toBe("[angry] [laughs] अरे यार");
  });

  it("syllable budget and estimate", () => {
    expect(maxSyllables(2)).toBe(9);
    expect(countSyllables("Arre sun, maarna mat")).toBe(6);
    expect(countSyllables("kya")).toBe(1);
  });
});

describe("stage 4 · casting + speech", () => {
  const v = (id: string, gender: AccountVoice["gender"], over: Partial<AccountVoice> = {}): AccountVoice => ({ id, name: id, gender, ...over });

  it("never casts across gender; prefers Indian accent; no voice reused", () => {
    expect(scoreVoice(char("C1", "male"), v("f", "female"))).toBe(-Infinity);
    const cast = castVoices(
      [char("C1", "male"), char("C2", "female"), char("C3", "male")],
      [v("us-m", "male", { accent: "american" }), v("in-m", "male", { accent: "indian" }), v("in-f", "female", { accent: "indian" })],
    );
    expect(cast.map((c) => c.voiceId)).toEqual(["in-m", "in-f", "us-m"]);
  });

  it("leaves a character uncast when no suitable voice exists", () => {
    const cast = castVoices([char("C1", "female")], [v("m", "male")]);
    expect(cast[0].voiceId).toBeUndefined();
  });

  it("TTS body: language code, seed, optional context", () => {
    const b = buildTtsBody({ voiceId: "x", ttsText: "[angry] अरे", langKey: "mr", seed: seedFor("C1"), previousText: "prev" });
    expect(b).toMatchObject({ language_code: "mr", previous_text: "prev", seed: seedFor("C1") });
    expect(buildTtsBody({ voiceId: "x", ttsText: "a", langKey: "hi", seed: 1, previousText: "p" }, false)).not.toHaveProperty("previous_text");
    expect(seedFor("C1")).toBe(seedFor("C1"));
    expect(seedFor("C1")).not.toBe(seedFor("C2"));
  });

  it("fit: fits / sped up / long", () => {
    expect(fitClip(1.8, 2)).toEqual({ playbackRate: 1, fit: "fits" });
    expect(fitClip(2.2, 2).fit).toBe("sped_up");
    expect(fitClip(3, 2)).toEqual({ playbackRate: 1.15, fit: "long" });
  });
});
