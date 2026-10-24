import type { LangKey } from "./config";
export type { LangKey };

// Fixed vocabularies shared by the Gemini schema, the Sarvam tag map and the UI.
export const EMOTIONS = ["neutral", "happy", "playful", "sarcastic", "sheepish", "surprised", "confused", "annoyed", "angry", "sad", "hurt", "tender", "scared", "excited"] as const;
export const NON_VERBALS = ["laughs", "chuckles", "sighs", "gasps", "whispers", "shouts", "crying", "clears throat", "pause"] as const;
export const TONES = ["comedy", "drama", "romance", "action", "thriller", "neutral"] as const;
export const AGES = ["child", "teen", "20s", "30s", "40s", "50s", "60+"] as const;
export const REGISTERS = ["intimate", "familiar", "respectful"] as const;

export type Emotion = (typeof EMOTIONS)[number];
export type NonVerbal = (typeof NON_VERBALS)[number];
export type Tone = (typeof TONES)[number];
export type Age = (typeof AGES)[number];
export type Register = (typeof REGISTERS)[number];
export type Gender = "male" | "female" | "unknown";

/** One dialogue line. Timing comes from Scribe (stage 1); the rest from Gemini (stage 2). */
export type Line = {
  id: string;
  start: number;
  end: number;
  slotSeconds: number;
  speakerId: string;
  text: string;
  nonVerbal?: string[];
  lowConfidence?: string[];
  characterId?: string;
  addresseeId?: string;
  emotion?: Emotion;
  intensity?: number;
  delivery?: string;
  emphasis?: string;
  subtext?: string;
};

export type VoiceProfile = { pitch: "low" | "mid" | "high"; pace: "slow" | "medium" | "fast"; energy: "calm" | "lively" | "intense"; texture: string };

export type Character = {
  id: string;
  name: string;
  speakerIds: string[];
  gender: Gender;
  age: Age;
  voice: VoiceProfile;
  personality: string;
  // Filled in by casting:
  voiceId?: string;
  voiceName?: string;
  color?: string;
};

export type Relationship = { between: string[]; relation: string; register: Register };

export type Scene = { summary: string; tone: Tone; relationships: Relationship[] };

/** A voice available in the user's ElevenLabs account (fetched live, never hardcoded). */
export type AccountVoice = { id: string; name: string; gender: Gender; age?: string; accent?: string; description?: string; category?: string };

export type Fit = "fits" | "sped_up" | "long";

export type DubLine = {
  lineId: string;
  text: string;
  transliteration: string;
  ttsText: string;
  note: string;
  audioUrl?: string;
  duration?: number;
  playbackRate?: number;
  fit?: Fit;
  busy?: boolean; // being shortened / re-voiced on its own
};

// Translation first, always: idle → translating → translated (awaiting review) → voicing → ready.
export type DubStatus = "idle" | "translating" | "translated" | "voicing" | "ready" | "error";

export type Dub = {
  langKey: LangKey;
  slangLevel: number;
  /** Slang level the current translation was written at (differs from slangLevel after the slider moves). */
  translatedAt?: number;
  status: DubStatus;
  lines: DubLine[];
  voiced: number;
  error?: string;
  errorStage?: "translate" | "voice";
};

// Raw word from ElevenLabs Scribe.
export type ScribeWord = {
  text: string;
  start: number;
  end: number;
  type: "word" | "spacing" | "audio_event";
  speaker_id?: string;
  logprob?: number;
};
