export const CONFIG = {
  STT_MODEL: "scribe_v2", // ElevenLabs speech-to-text
  TTS_MODEL: "eleven_v4", // ElevenLabs expressive TTS (audio tags); "eleven_v3" also works
  GEMINI_MODEL: "gemini-flash-latest", // alias → currently gemini-3.8-flash
  SARVAM_MODEL: "sarvam-105b",
  TTS_STABILITY: 0.5, // 0 = most expressive, 0.5 = natural, 1 = steadiest
  ORIGINAL_VOLUME: 0.15,
  MAX_SECONDS: 60.5,
  MAX_LABEL: "60 seconds",
  TTS_CONCURRENCY: 3,
  DEFAULT_SLANG: 3,
  MAX_FRAMES: 12, // labelled frames spread across the clip (each ≈1.1k Gemini tokens; 33 + medium thinking hung)
  FRAME_WIDTH: 384,
  TIMEOUT_MS: { stt: 90_000, gemini: 90_000, sarvam: 150_000, tts: 60_000 },
};

export const LANGS = [
  { key: "hi", label: "हिंदी", name: "Hindi", script: "Devanagari", ttsCode: "hi" },
  { key: "mr", label: "मराठी", name: "Marathi", script: "Devanagari", ttsCode: "mr" },
] as const;

export type LangKey = (typeof LANGS)[number]["key"];
export const LANG_KEYS = LANGS.map((l) => l.key) as LangKey[];
export const langOf = (key: LangKey) => LANGS.find((l) => l.key === key)!;

export const SLANG_LEVELS = ["Formal", "Standard", "Conversational", "Colloquial", "Street"];

// One distinct colour per character, in cast order.
export const CHARACTER_COLORS = ["#2dd4bf", "#fb7185", "#a78bfa", "#38bdf8", "#a3e635"];

export const CREDIT =
  "Built during the Creative AI & Quantum Hackathon organised by StreetKode Fam during Indian Krump Festival 14";
