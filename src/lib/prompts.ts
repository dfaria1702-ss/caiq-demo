// Every prompt and request body Lehja sends to a provider lives here.
// Pure functions (no fetch, no secrets) so they can be reviewed and dumped offline: `npm run payloads`.
// Content always comes from the uploaded clip; only the RULES are fixed here.
import { CONFIG, langOf, type LangKey } from "./config";
import { maxSyllables } from "./segment";
import { AGES, EMOTIONS, NON_VERBALS, REGISTERS, TONES, type Character, type Line, type Scene } from "./types";

// ═════════════════════════ Stage 1 · ElevenLabs Speech-to-Text (Scribe) ═════════════════════════
export const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

/** multipart/form-data fields sent alongside `file` (raw 16 kHz mono 16-bit PCM). */
export const sttFields = (numSpeakers?: number): Record<string, string> => ({
  model_id: CONFIG.STT_MODEL,
  file_format: "pcm_s16le_16",
  diarize: "true",
  ...(numSpeakers ? { num_speakers: String(numSpeakers) } : {}),
  timestamps_granularity: "word",
  tag_audio_events: "true",
  temperature: "0",
  seed: "7",
});

// ═════════════════════════ Stage 2 · Gemini scene analysis ═════════════════════════
export const geminiUrl = () => `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent`;

export const SCENE_SYSTEM = `You are a dubbing director preparing a scene for voice actors who will re-perform it in Hindi and Marathi.
You receive: the scene's full audio; one still frame per second, each labelled with its time and the line being spoken; and the transcript lines (with speaker ids from automatic diarization).

1. CHARACTERS: Identify every distinct character. Use a name only if it is spoken in the dialogue; otherwise "Man 1", "Woman 1", "Boy". Diarization can be wrong: if one speakerId is clearly two people, or two speakerIds are one person, fix it with characterId per line. Describe each voice precisely enough for a casting director.
2. RELATIONSHIPS: For every pair who talk to each other, state the relationship and how they would address each other in Hindi: intimate (tu), familiar (tum) or respectful (aap).
3. LINES: For every line, judge emotion from the AUDIO first (tone, volume, pace, pitch), then the FRAMES around that time (face, posture, gestures). State who the line is addressed to and which word carries the stress.
4. Be literal about what is audible and visible. Do not invent backstory. Never change text, ids or timings. Return every line id exactly once.`;

export const sceneSchema = {
  type: "OBJECT",
  required: ["sceneSummary", "tone", "characters", "relationships", "lines"],
  properties: {
    sceneSummary: { type: "STRING", description: "≤ 40 words: who, where, what happens" },
    tone: { type: "STRING", enum: [...TONES] },
    characters: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["id", "name", "speakerIds", "gender", "age", "voice", "personality"],
        properties: {
          id: { type: "STRING", description: "C1, C2, …" },
          name: { type: "STRING" },
          speakerIds: { type: "ARRAY", items: { type: "STRING" } },
          gender: { type: "STRING", enum: ["male", "female", "unknown"] },
          age: { type: "STRING", enum: [...AGES] },
          voice: {
            type: "OBJECT",
            required: ["pitch", "pace", "energy", "texture"],
            properties: {
              pitch: { type: "STRING", enum: ["low", "mid", "high"] },
              pace: { type: "STRING", enum: ["slow", "medium", "fast"] },
              energy: { type: "STRING", enum: ["calm", "lively", "intense"] },
              texture: { type: "STRING", description: "≤ 6 words, e.g. warm, slightly husky" },
            },
          },
          personality: { type: "STRING", description: "≤ 12 words" },
        },
      },
    },
    relationships: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["between", "relation", "register"],
        properties: {
          between: { type: "ARRAY", items: { type: "STRING" }, minItems: 2, maxItems: 2 },
          relation: { type: "STRING", description: "≤ 5 words, e.g. close friends" },
          register: { type: "STRING", enum: [...REGISTERS] },
        },
      },
    },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["id", "characterId", "addresseeId", "emotion", "intensity", "delivery", "nonVerbal", "subtext"],
        properties: {
          id: { type: "STRING" },
          characterId: { type: "STRING" },
          addresseeId: { type: "STRING", description: "character id, 'group', or 'self'" },
          emotion: { type: "STRING", enum: [...EMOTIONS] },
          intensity: { type: "INTEGER", minimum: 1, maximum: 10 },
          delivery: { type: "STRING", description: "≤ 10 words: volume, pace, pitch movement" },
          nonVerbal: { type: "ARRAY", items: { type: "STRING", enum: [...NON_VERBALS] } },
          emphasis: { type: "STRING", description: "the stressed word, if any" },
          subtext: { type: "STRING", description: "≤ 12 words" },
        },
      },
    },
  },
};

export type Frame = { t: number; data: string };

const frameLabel = (t: number, lines: Line[]) => {
  const l = lines.find((x) => t >= x.start && t <= x.end);
  return `FRAME t=${t.toFixed(1)}s · ${l ? `during ${l.id} (${l.speakerId})` : "silence"}`;
};

export const sceneLinesForGemini = (lines: Line[]) =>
  lines.map(({ id, start, end, speakerId, text, nonVerbal }) => ({ id, start, end, speakerId, text, nonVerbal }));

export const buildGeminiBody = (wavBase64: string, frames: Frame[], lines: Line[], durationSeconds: number) => ({
  systemInstruction: { parts: [{ text: SCENE_SYSTEM }] },
  contents: [
    {
      role: "user",
      parts: [
        { text: `AUDIO (full scene, ${durationSeconds.toFixed(1)} s):` },
        { inlineData: { mimeType: "audio/wav", data: wavBase64 } },
        ...frames.flatMap((f) => [{ text: frameLabel(f.t, lines) }, { inlineData: { mimeType: "image/jpeg", data: f.data } }]),
        { text: `LINES:\n${JSON.stringify(sceneLinesForGemini(lines))}` },
      ],
    },
  ],
  generationConfig: {
    temperature: 0.3,
    thinkingConfig: { thinkingLevel: "low" }, // medium + many frames hung for 5+ min
    responseMimeType: "application/json",
    responseSchema: sceneSchema,
  },
});

// ═════════════════════════ Stage 3 · Sarvam transcreation + tags ═════════════════════════
export const SARVAM_URL = "https://api.sarvam.ai/v1/chat/completions";

type LangProfile = { language: string; ladderLine: string; ladder: string[]; grammar: string; loanwords: string; pitfalls: string };

const LANG_PROFILES: Record<LangKey, LangProfile> = {
  hi: {
    language: `Hindi the way urban Indians actually speak it today — Hinglish.
Keep English words wherever Indians normally use them in Hindi conversation ("tum over-react kar rahe ho", "sorry yaar", "plan cancel ho gaya", "seriously?", "office", "phone", "actually", "tension", "relax"). Never replace them with textbook Hindi (no अतिप्रतिक्रिया, क्षमा, योजना when a speaker would say over-react, sorry, plan). Translate an English word only when a Hindi word is what people would genuinely say there.
How much English depends on the slang level: 0 Formal: mostly Hindi, English only for words with no everyday Hindi equivalent. 1–2: natural everyday mix. 3–4: heavy, casual Hinglish.`,
    ladderLine: "Relax, I'll take care of it.",
    ladder: [
      "आप निश्चिंत रहिए, मैं इसे संभाल लूँगा।",
      "आप चिंता मत कीजिए, मैं संभाल लूँगा।",
      "टेंशन मत लो, मैं हैंडल कर लूँगा।",
      "अरे यार, टेंशन मत ले, मैं हैंडल कर लूँगा ना।",
      "अबे टेंशन मत ले भाई, सब सेट कर दूँगा।",
    ],
    grammar: `Inflect every verb, pronoun and adjective for the SPEAKER's gender and the ADDRESSEE's gender (करता/करती, गया/गई, थका/थकी). Use the pair's register for "you": intimate = तू, familiar = तुम, respectful = आप — and keep it consistent across the scene.`,
    loanwords: "सॉरी, टेंशन, ओवर-रिएक्ट, केक",
    pitfalls: `BAD → GOOD (generic examples — learn the pattern, don't reuse the words):
- Literal idiom: "Break a leg!" → BAD: टांग तोड़ दो! → GOOD: धमाल मचा देना!
- Literal crude image: "Get your lazy butt over here" → BAD: अपना आलसी पिछवाड़ा यहाँ लाओ → GOOD: चल, हिल अब, इधर आ!
- Forced English inside a Hindi phrase: "every single time" → BAD: हर सिंगल टाइम / हर सिंगल एक → GOOD: हर बार / एक-एक को
- Broken grammar: "nobody said anything" → BAD: कोई ने नहीं बोला → GOOD: किसी ने कुछ नहीं बोला`,
  },
  mr: {
    language: `Marathi the way urban Maharashtrians actually speak it today (Mumbai/Pune), with natural English mixing.
Keep English words wherever Marathi speakers normally use them ("tu over-react kartoys", "sorry re", "plan cancel jhala", "tension", "set", "office", "phone"). Never replace them with textbook Marathi when a speaker would say the English word. Translate an English word only when a Marathi word is what people would genuinely say there.
How much English depends on the slang level: 0 Formal: Puneri formal Marathi, English only for words with no everyday Marathi equivalent. 1–2: natural everyday mix. 3–4: heavy, casual Mumbai Marathi.`,
    ladderLine: "Relax, I'll take care of it.",
    ladder: [
      "आपण काळजी करू नका, मी ते सांभाळेन.",
      "काळजी करू नका, मी बघतो.",
      "टेन्शन घेऊ नकोस, मी बघतो.",
      "अरे टेन्शन नको घेऊस रे, मी बघतो ना.",
      "ए टेन्शन नाय घ्यायचं, सगळं सेट करतो मी.",
    ],
    grammar: `Inflect every verb, pronoun and adjective for the SPEAKER's gender and the ADDRESSEE's gender (करतोस/करतेस, गेला/गेली, आलो/आले). Use the pair's register for "you": intimate = तू, familiar = तुम्ही, respectful = आपण — and keep it consistent across the scene.`,
    loanwords: "सॉरी, टेन्शन, ओवर-रिॲक्ट, केक",
    pitfalls: `BAD → GOOD (generic examples — learn the pattern, don't reuse the words):
- Literal idiom: "Break a leg!" → BAD: पाय मोडून टाक! → GOOD: धमाल कर!
- Literal crude image: "Get your lazy butt over here" → BAD: तुझा आळशी बूड इथे आण → GOOD: चल, हल आता, इकडे ये!
- Forced English inside a Marathi phrase: "every single time" → BAD: प्रत्येक सिंगल टाइम → GOOD: दर वेळी / प्रत्येक वेळी
- Broken grammar: "nobody said anything" → BAD: कोण नाही बोलला → GOOD: कोणीच काही बोललं नाही`,
  },
};

/** Gemini emotion / non-verbal → ElevenLabs audio tag. The ONLY tags allowed in ttsText. */
export const EMOTION_TAGS: Record<string, string | null> = {
  neutral: null, happy: "[happily]", playful: "[playfully]", sarcastic: "[sarcastic]", sheepish: "[nervously]",
  surprised: "[surprised]", confused: "[confused]", annoyed: "[annoyed]", angry: "[angry]", sad: "[sad]",
  hurt: "[hurt]", tender: "[softly]", scared: "[scared]", excited: "[excited]",
};
export const NONVERBAL_TAGS: Record<string, string | null> = {
  laughs: "[laughs]", chuckles: "[chuckles]", sighs: "[sighs]", gasps: "[gasps]", whispers: "[whispers]",
  shouts: "[shouting]", crying: "[crying]", "clears throat": "[clears throat]", pause: null,
};
export const ALLOWED_TAGS = new Set([...Object.values(EMOTION_TAGS), ...Object.values(NONVERBAL_TAGS)].filter(Boolean) as string[]);
const MAX_TAGS = 2;

const tagList = (m: Record<string, string | null>) =>
  Object.entries(m).map(([k, v]) => `${k} ${v ?? (k === "pause" ? "→ use … instead of a tag" : "→ no tag")}`).join(" · ");

export function transcreateSystem(langKey: LangKey, slangLevel: number) {
  const lang = langOf(langKey);
  const p = LANG_PROFILES[langKey];
  const names = ["Formal", "Standard", "Conversational", "Colloquial", "Street"];
  const ladder = p.ladder.map((ex, i) => `${i} ${names[i]}: ${ex}${i === slangLevel ? "   ← WRITE AT THIS LEVEL" : ""}`).join("\n");
  return `You are a senior dubbing writer for ${lang.name} film and OTT. You TRANSCREATE an English scene into ${lang.name}: write what these characters would actually say if the scene had been shot in ${lang.name}. Keep meaning, subtext, emotion, humour, rhythm and each character's personality. Word-for-word translation is a failure.

LANGUAGE: ${p.language}

SLANG LEVEL ${slangLevel} of 4 — ${names[slangLevel]}. The ladder, using one example line ("${p.ladderLine}"):
${ladder}
Treat the level as a centre: people get more colloquial when joking, angry or intimate, more formal when tense or respectful. Never stack slang for effect. Natural, never parody.

LOCALISE, DON'T TRANSLATE:
- Idioms, jokes, insults and crude or body-based humour must NEVER be translated literally. Replace them with what a ${lang.name} speaker would actually say in that moment to get the same punch — a local insult, taunt or comeback with the same attitude, even if the image is completely different.
- If a joke depends on English wordplay or a running gag (a phrase repeated across lines), build an equivalent ${lang.name} gag and repeat it consistently.
- Match the original's level of rudeness: if a line swears or is crude, use the swearing or crude slang a ${lang.name} speaker would naturally use, at the same strength. Don't add swearing where the original has none, and never water a rude line down into something stiff or odd.
- English words: use one only where an Indian speaker would really drop it in (a whole natural phrase: "office में आ", "relax कर"). Never wedge an English word into a fixed ${lang.name} phrase.
- Every line must be grammatically correct ${lang.name} that a native speaker would say out loud without wincing. Check case markers and agreement.

${p.pitfalls}

GRAMMAR: ${p.grammar}

TIMING: Each line has maxSyllables — the most that fits its time slot when spoken naturally. Stay at or under it. If the English is dense, keep the core meaning and emotion and cut the rest. Shorter beats longer.

TEXT FOR SPEECH: Write everything, including English words, in ${lang.script} (${p.loanwords}). Keep names as they are said. Write numbers as words. Use … for hesitation, ! and ? for intonation. No quotation marks, brackets or emoji in text.

For each line return:
- text: the ${lang.name} line in ${lang.script}
- transliteration: the same line in simple Latin letters, as it sounds
- ttsText: text with AT MOST ${MAX_TAGS} audio tags from the allowed list, placed at the start of the line or of the clause where the cue happens
- note: one short English sentence on the key adaptation choice

ALLOWED TAGS — emotion: ${tagList(EMOTION_TAGS)}
non-verbal: ${tagList(NONVERBAL_TAGS)}
Use no other tags.

Return one entry per input line, same ids, same order.`;
}

/** The scene, characters and lines as Sarvam sees them — all derived from stages 1–2. */
export function transcreateUser(scene: Scene, characters: Character[], lines: Line[]) {
  return JSON.stringify({
    scene: { summary: scene.summary, tone: scene.tone },
    characters: characters.map(({ id, name, gender, age, personality }) => ({ id, name, gender, age, personality })),
    relationships: scene.relationships,
    lines: lines.map((l) => ({
      id: l.id,
      speaker: l.characterId,
      addressee: l.addresseeId,
      text: l.text,
      emotion: l.emotion,
      intensity: l.intensity,
      delivery: l.delivery,
      nonVerbal: l.nonVerbal ?? [],
      emphasis: l.emphasis,
      subtext: l.subtext,
      maxSyllables: maxSyllables(l.slotSeconds),
    })),
  });
}

/** Follow-up for lines that came back over their syllable budget (auto after translating, or the Shorten button). */
export function shortenUser(lines: { id: string; text: string; ttsText: string; maxSyllables: number; currentSyllables: number }[]) {
  return `These lines are too long for their time slots. Rewrite each one to fit within maxSyllables. Keep the same emotion, register, grammar, audio tags and the core meaning — cut, don't rephrase from scratch.\n${JSON.stringify({ lines })}`;
}

/** Appended to the user message on the single retry after invalid output. */
export const transcreateRetrySuffix = (error: string) => `\n\nYour previous answer was invalid: ${error}\nReturn ONLY the JSON object.`;

export const dubScriptSchema = {
  type: "json_schema",
  json_schema: {
    name: "dub_script",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["lines"],
      properties: {
        lines: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "text", "transliteration", "ttsText", "note"],
            properties: {
              id: { type: "string" },
              text: { type: "string" },
              transliteration: { type: "string" },
              ttsText: { type: "string" },
              note: { type: "string" },
            },
          },
        },
      },
    },
  },
};

export const buildSarvamBody = (system: string, user: string) => ({
  model: CONFIG.SARVAM_MODEL,
  temperature: 0.6,
  max_tokens: 16384, // reasoning counts against this — keep it roomy
  reasoning_effort: "medium",
  response_format: dubScriptSchema,
  messages: [
    { role: "system", content: system },
    { role: "user", content: user },
  ],
});

/** Keep only allowed tags, at most MAX_TAGS, and tidy spacing. */
export function sanitizeTts(ttsText: string) {
  let kept = 0;
  return ttsText
    .replace(/\[[^\]]*\]/g, (tag) => {
      const t = tag.toLowerCase().replace(/\s+/g, " ");
      return ALLOWED_TAGS.has(t) && kept++ < MAX_TAGS ? t : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

// ═════════════════════════ Stage 4 · ElevenLabs Text-to-Speech ═════════════════════════
export const ttsUrl = (voiceId: string) => `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
export const VOICES_URL = "https://api.elevenlabs.io/v2/voices?page_size=100";

export type SpeakInput = { voiceId: string; ttsText: string; langKey: LangKey; seed: number; previousText?: string; nextText?: string };

export const buildTtsBody = (i: SpeakInput, withContext = true) => ({
  text: i.ttsText,
  model_id: CONFIG.TTS_MODEL,
  language_code: langOf(i.langKey).ttsCode,
  voice_settings: { stability: CONFIG.TTS_STABILITY },
  seed: i.seed,
  ...(withContext && i.previousText ? { previous_text: i.previousText } : {}),
  ...(withContext && i.nextText ? { next_text: i.nextText } : {}),
});

/** Stable per-character seed, derived from the character id (same voice sound across lines and retakes). */
export const seedFor = (characterId: string) => [...characterId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 4294967295;

/** Text without audio tags (used as previous/next context). */
export const stripTags = (s: string) => s.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
