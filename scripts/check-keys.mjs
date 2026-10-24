// One cheap call per provider to prove each key works. Run: npm run check-keys
// Never prints the keys themselves.
const env = process.env;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);
const cfg = (await import("node:fs")).readFileSync(new URL("../src/lib/config.ts", import.meta.url), "utf8");
const pick = (k) => cfg.match(new RegExp(`${k}:\\s*"([^"]+)"`))?.[1];

async function elevenlabs() {
  console.log("\nElevenLabs");
  if (!env.ELEVENLABS_API_KEY) return bad("ELEVENLABS_API_KEY missing");
  const h = { "xi-api-key": env.ELEVENLABS_API_KEY };
  const u = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: h });
  if (!u.ok) return bad(`key rejected (${u.status}): ${(await u.text()).slice(0, 160)}`);
  const s = await u.json();
  ok(`key valid · tier "${s.tier}" · ${s.character_count}/${s.character_limit} credits used`);
  const m = await fetch("https://api.elevenlabs.io/v1/models", { headers: h });
  if (m.ok) {
    const ids = (await m.json()).map((x) => x.model_id);
    const tts = pick("TTS_MODEL");
    ids.includes(tts) ? ok(`TTS model "${tts}" available`) : bad(`TTS model "${tts}" not in your models: ${ids.join(", ")}`);
  }
  const v = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", { headers: h });
  if (v.ok) {
    const voices = (await v.json()).voices ?? [];
    console.log(`  Voices in your account (${voices.length}) — copy IDs into VOICES in src/lib/config.ts:`);
    for (const x of voices) console.log(`    ${x.voice_id}  ${(x.labels?.gender ?? "?").padEnd(7)} ${x.name}${x.labels?.accent ? ` (${x.labels.accent})` : ""}`);
  }
}

async function gemini() {
  console.log("\nGemini");
  if (!env.GEMINI_API_KEY) return bad("GEMINI_API_KEY missing");
  const model = pick("GEMINI_MODEL");
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the single word: ok" }] }] }),
  });
  if (!r.ok) return bad(`${model} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  ok(`key valid · "${model}" → resolved to ${j.modelVersion ?? "?"} · replied "${j.candidates?.[0]?.content?.parts?.[0]?.text?.trim()}"`);
}

async function sarvam() {
  console.log("\nSarvam");
  if (!env.SARVAM_API_KEY) return bad("SARVAM_API_KEY missing");
  const model = pick("SARVAM_MODEL");
  const t0 = Date.now();
  const r = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: { "api-subscription-key": env.SARVAM_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 1024, reasoning_effort: "low", messages: [{ role: "user", content: "Say 'kya re' in Devanagari. Reply with only that." }] }),
  });
  if (!r.ok) return bad(`${model} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = (j.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  ok(`key valid · "${model}" replied "${text.slice(0, 60)}" in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

for (const f of [elevenlabs, gemini, sarvam]) {
  try { await f(); } catch (e) { bad(`network error: ${e.message}`); }
}
console.log("");
