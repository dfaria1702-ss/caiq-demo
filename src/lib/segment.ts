import type { Fit, Line, ScribeWord } from "./types";

const MAX_PAUSE = 0.6; // new line after a silence longer than this
const MAX_LINE = 7; // …or once a line runs this long
const SENTENCE_SPLIT_AFTER = 4; // past this length, a sentence end also starts a new line
const SLOT_GUARD = 0.15; // keep this much silence before the next line
const SLOT_MAX_OVERHANG = 1.0; // a dub may run at most this far past the original line's end
const LOW_CONFIDENCE = -0.7; // word logprob below this (≈ <50% sure) is flagged

/** Stage 1 (our code, no AI): group Scribe's timed words into dialogue lines. */
export function segmentWords(words: ScribeWord[]): Line[] {
  type Draft = { start: number; end: number; speakerId: string; words: string[]; nonVerbal: string[]; unsure: string[] };
  const drafts: Draft[] = [];
  const events: ScribeWord[] = [];

  for (const w of words) {
    if (w.type === "spacing") continue;
    if (w.type === "audio_event") {
      events.push(w);
      continue;
    }
    const speakerId = w.speaker_id ?? "speaker_0";
    const cur = drafts[drafts.length - 1];
    const sentenceEnded = !!cur && cur.end - cur.start > SENTENCE_SPLIT_AFTER && /[.?!…]["')\]]*$/.test(cur.words[cur.words.length - 1]);
    const startNew =
      !cur || cur.speakerId !== speakerId || w.start - cur.end > MAX_PAUSE || w.end - cur.start > MAX_LINE || sentenceEnded;
    const unsure = w.logprob !== undefined && w.logprob < LOW_CONFIDENCE ? [clean(w.text)] : [];
    if (startNew) {
      drafts.push({ start: w.start, end: w.end, speakerId, words: [w.text], nonVerbal: [], unsure });
    } else {
      cur.end = w.end;
      cur.words.push(w.text);
      cur.unsure.push(...unsure);
    }
  }

  // Attach audio events (e.g. "(laughter)") to the nearest line by time.
  for (const e of events) {
    if (!drafts.length) break;
    const mid = (e.start + e.end) / 2;
    let best = drafts[0];
    let bestDist = Infinity;
    for (const d of drafts) {
      const dist = mid < d.start ? d.start - mid : mid > d.end ? mid - d.end : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    best.nonVerbal.push(e.text.replace(/[()[\]]/g, "").trim().toLowerCase());
  }

  return drafts.map((d, i) => {
    const next = drafts[i + 1];
    // The dub may use the silence after a line, but never run into the next one.
    const limit = Math.min(next ? next.start - SLOT_GUARD : Infinity, d.end + SLOT_MAX_OVERHANG);
    return {
      id: `L${String(i + 1).padStart(2, "0")}`,
      start: round(d.start),
      end: round(d.end),
      slotSeconds: round(Math.max(d.end, limit) - d.start),
      speakerId: d.speakerId,
      text: d.words.join(" ").replace(/\s+([,.!?…])/g, "$1"),
      nonVerbal: d.nonVerbal.length ? d.nonVerbal : undefined,
      lowConfidence: d.unsure.filter(Boolean).length ? d.unsure.filter(Boolean) : undefined,
    };
  });
}

/** Syllables a line can hold at a natural dubbing pace. */
export const SYLLABLES_PER_SECOND = 4.5;
export const maxSyllables = (slotSeconds: number) => Math.max(3, Math.round(slotSeconds * SYLLABLES_PER_SECOND));

/** Rough syllable count from the Latin transliteration (vowel groups ≈ syllables; handles Hindi schwa deletion). */
export const countSyllables = (transliteration: string) => (transliteration.toLowerCase().match(/[aeiouy]+/g) ?? []).length;

/** How a voiced clip fits its slot. */
export function fitClip(duration: number, slotSeconds: number): { playbackRate: number; fit: Fit } {
  const ratio = duration / Math.max(slotSeconds, 0.1);
  const playbackRate = Math.min(Math.max(ratio, 1), 1.15);
  const fit: Fit = ratio <= 1.02 ? "fits" : ratio <= 1.15 ? "sped_up" : "long";
  return { playbackRate, fit };
}

const clean = (s: string) => s.replace(/[^\p{L}\p{N}'-]/gu, "");
const round = (n: number) => Math.round(n * 1000) / 1000;
