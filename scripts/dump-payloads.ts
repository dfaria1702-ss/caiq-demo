// Builds the exact request payloads for a sample scene, offline (no network, no keys).
// Sample content stands in for what the APIs return for YOUR clip — the builders are the real ones.
// Run: npm run payloads  → writes ../PAYLOADS.generated.md
import { writeFileSync } from "node:fs";
import { CONFIG, LANGS } from "../src/lib/config";
import { castVoices } from "../src/lib/cast";
import { MOCK_CHARACTERS, MOCK_DUBS, MOCK_LINE_ANALYSIS, MOCK_SCENE, mockWords } from "../src/lib/mock.data";
import * as P from "../src/lib/prompts";
import { countSyllables, maxSyllables, segmentWords } from "../src/lib/segment";
import type { AccountVoice } from "../src/lib/types";

const CLIP = 25.84;
const wavBytes = Math.round(CLIP * 32000 + 44);
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const wavB64 = `<WAV base64 · ${kb(wavBytes)} raw → ${kb((wavBytes * 4) / 3)} base64 · 16 kHz mono 16-bit>`;
const frames = Array.from({ length: Math.floor(CLIP) }, (_, i) => ({ t: i + 0.5, data: `<JPEG base64 · ${CONFIG.FRAME_WIDTH}px · ~15 KB>` }));

const transcribed = segmentWords(mockWords(CLIP));
const analysed = transcribed.map((l) => ({ ...l, ...MOCK_LINE_ANALYSIS[l.id] }));
const sampleVoices: AccountVoice[] = [
  { id: "<voice id from your account>", name: "Indian male voice", gender: "male", age: "young", accent: "indian" },
  { id: "<voice id from your account>", name: "Indian female voice", gender: "female", age: "young", accent: "indian" },
];
const cast = castVoices(MOCK_CHARACTERS, sampleVoices.map((v, i) => ({ ...v, id: `${v.id} #${i + 1}` })));

const j = (o: unknown) => "```json\n" + JSON.stringify(o, null, 2) + "\n```";
const txt = (s: string) => "```text\n" + s + "\n```";
const out: string[] = [];
const h = (s: string) => out.push(`\n## ${s}\n`);

out.push(`# Lehja — provider payloads (generated)

Generated offline by \`npm run payloads\` from \`src/lib/prompts.ts\` — the SAME builders the app uses.
The sample scene stands in for what the APIs return for your clip; in the app every value comes from the uploaded video.
Base64 blobs are replaced by size notes. API keys are never included.

Models: STT \`${CONFIG.STT_MODEL}\` · Gemini \`${CONFIG.GEMINI_MODEL}\` · Sarvam \`${CONFIG.SARVAM_MODEL}\` · TTS \`${CONFIG.TTS_MODEL}\``);

// ── Stage 1
h("Stage 1 · ElevenLabs Speech-to-Text — `transcribe` (1 call per clip)");
out.push(`\`POST ${P.STT_URL}\` · header \`xi-api-key: ***\` · \`multipart/form-data\` · Speakers set to 2 in the UI`);
out.push(j({ file: `<raw PCM · ${kb(wavBytes - 44)} · WAV header stripped>`, ...P.sttFields(2) }));
out.push("**After our segmentation** (what every later stage sees):");
out.push(j(transcribed.slice(0, 3)));
out.push(`…${transcribed.length} lines in total.`);

// ── Stage 2
h("Stage 2 · Gemini scene analysis — `analyzeScene` (1 call per clip)");
out.push(`\`POST ${P.geminiUrl()}\` · header \`x-goog-api-key: ***\``);
out.push("### System instruction");
out.push(txt(P.SCENE_SYSTEM));
const gem = P.buildGeminiBody(wavB64, frames, transcribed, CLIP);
const parts = gem.contents[0].parts;
out.push(`### Request body (${frames.length} frames; showing the first 3 frame pairs)`);
out.push(j({ ...gem, contents: [{ ...gem.contents[0], parts: [...parts.slice(0, 2 + 6), { text: `… ${frames.length - 3} more labelled frames …` }, parts[parts.length - 1]] }] }));

// ── Stage 3
h("Stage 3 · Sarvam transcreation + tags — `transcreate` (1 call per Translate / Re-translate)");
out.push(`\`POST ${P.SARVAM_URL}\` · header \`api-subscription-key: ***\``);
const sys = P.transcreateSystem("hi", 3);
const user = P.transcreateUser(MOCK_SCENE, cast, analysed);
out.push("### System prompt — Hindi, slang 3 (Colloquial)");
out.push(txt(sys));
out.push(`### User message (sent minified — ${user.length} chars)`);
out.push(j(JSON.parse(user)));
out.push("### Request body");
out.push(j(P.buildSarvamBody("<system prompt above>", "<user message above>")));
out.push("### Marathi differences (system prompt)");
out.push(txt(P.transcreateSystem("mr", 3).split("\n").filter((l) => !sys.includes(l)).join("\n")));
const sample = MOCK_DUBS.hi.casual[3];
const target = { id: "L04", text: sample.text, ttsText: `${sample.tags} ${sample.text}`, maxSyllables: maxSyllables(analysed[3].slotSeconds), currentSyllables: countSyllables(sample.transliteration) };
out.push("### Auto-shorten follow-up (only for lines > 15% over their syllable budget; also the Shorten button)");
out.push(txt(P.shortenUser([target])));

// ── Stage 4
h("Stage 4 · ElevenLabs voices + speech — `listVoices` + `speak`");
out.push(`\`GET ${P.VOICES_URL}\` → the voices in YOUR account; casting picks one per character (gender must match, Indian accent preferred, then age/pitch/energy).`);
out.push("**Casting for the sample scene:**");
out.push(j(cast.map((c) => ({ character: c.name, gender: c.gender, age: c.age, voice: c.voiceName }))));
const hi = MOCK_DUBS.hi.casual;
for (const i of [0, 3]) {
  const l = analysed[i];
  const c = cast.find((x) => x.id === l.characterId)!;
  const tts = P.sanitizeTts(`${hi[i].tags} ${hi[i].text}`);
  out.push(`**${l.id} · ${c.name}** — \`POST ${P.ttsUrl(c.voiceId!)}\` · header \`xi-api-key: ***\``);
  out.push(
    j(P.buildTtsBody({ voiceId: c.voiceId!, ttsText: tts, langKey: "hi", seed: P.seedFor(c.id), previousText: i > 0 ? P.stripTags(hi[i - 1].text) : undefined, nextText: P.stripTags(hi[i + 1].text) })),
  );
}
const chars = hi.reduce((n, d) => n + P.sanitizeTts(`${d.tags} ${d.text}`).length, 0);
out.push(`Per language: ${analysed.length} calls, ~${chars} characters in total (tags included), ${CONFIG.TTS_CONCURRENCY} at a time.`);
out.push(`\nLanguages: ${LANGS.map((l) => `${l.name} (${l.ttsCode})`).join(", ")}`);

writeFileSync(new URL("../../PAYLOADS.generated.md", import.meta.url), out.join("\n\n") + "\n");
console.log("wrote PAYLOADS.generated.md", { frames: frames.length, sarvamSystemChars: sys.length, sarvamUserChars: user.length, ttsCharsPerLang: chars });
