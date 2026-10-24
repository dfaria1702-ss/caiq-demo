import { CHARACTER_COLORS } from "./config";
import type { AccountVoice, Character } from "./types";

const INDIAN = /indian|hindi|marathi|desi|mumbai|delhi|bollywood/i;
const ageBucket = (age: Character["age"]) => (["child", "teen", "20s"].includes(age) ? "young" : ["30s", "40s"].includes(age) ? "middle_aged" : "old");

/** How well an account voice suits a character. -Infinity = never (wrong gender). */
export function scoreVoice(c: Character, v: AccountVoice): number {
  if (c.gender !== "unknown" && v.gender !== "unknown" && v.gender !== c.gender) return -Infinity;
  const text = `${v.name} ${v.accent ?? ""} ${v.description ?? ""}`.toLowerCase();
  let s = 0;
  if (c.gender !== "unknown" && v.gender === c.gender) s += 4;
  if (INDIAN.test(`${v.accent ?? ""} ${v.description ?? ""} ${v.name}`)) s += 6; // Indian accent matters most for Hindi/Marathi
  if (v.age && v.age.replace(/\s+/g, "_") === ageBucket(c.age)) s += 2;
  if (c.voice.pitch === "low" && /deep|low|bass|resonant|husky|gravel/.test(text)) s += 1;
  if (c.voice.pitch === "high" && /bright|high|light|youthful/.test(text)) s += 1;
  if (c.voice.energy === "intense" && /energetic|intense|fierce|dominant/.test(text)) s += 1;
  if (c.voice.energy === "calm" && /calm|soft|relaxed|steady|soothing/.test(text)) s += 1;
  if (c.voice.energy === "lively" && /lively|playful|bright|upbeat|quirky/.test(text)) s += 1;
  return s;
}

/**
 * Stage 4 casting (our code, no AI): each character gets the best-scoring voice from the user's
 * ElevenLabs account — gender must match, Indian accent preferred, then age / pitch / energy.
 * No two characters share a voice; the same voice is used in every language.
 */
export function castVoices(chars: Character[], voices: AccountVoice[]): Character[] {
  const used = new Set<string>();
  // Cast the most constrained characters (known gender) first.
  const order = [...chars.keys()].sort((a, b) => Number(chars[a].gender === "unknown") - Number(chars[b].gender === "unknown"));
  const picks = new Map<number, AccountVoice | undefined>();
  for (const i of order) {
    const c = chars[i];
    const best = voices
      .filter((v) => !used.has(v.id))
      .map((v) => ({ v, s: scoreVoice(c, v) }))
      .filter((x) => x.s > -Infinity)
      .sort((a, b) => b.s - a.s)[0]?.v;
    if (best) used.add(best.id);
    picks.set(i, best);
  }
  return chars.map((c, i) => ({
    ...c,
    color: CHARACTER_COLORS[i % CHARACTER_COLORS.length],
    voiceId: picks.get(i)?.id,
    voiceName: picks.get(i)?.name,
  }));
}
