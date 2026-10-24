# Lehja · लहजा

**Dubbing that translates the feeling, not just the words.** Upload a scene up to 60 s → Lehja transcribes it, reads each character's emotion, transcreates the dialogue into Hindi or Marathi (natural Hinglish, slang levels 0–4), lets you review the script, then voices it with emotional AI voices dropped onto the original timing.

Built during the Creative AI & Quantum Hackathon organised by StreetKode Fam during Indian Krump Festival 14.

## Pipeline
1. **Transcribe** — ElevenLabs Scribe v2 (diarization, word timestamps, audio events) → our code groups words into timed lines
2. **Understand the scene** — Gemini (audio + labelled frames) → characters, voices, relationships, emotion/addressee per line
3. **Cast voices** — picked live from your ElevenLabs account (gender match, Indian accent preferred)
4. **Translate** — Sarvam-105B transcreation + ElevenLabs audio tags, per language, reviewed before dubbing
5. **Dub** — ElevenLabs v4 speech per line, timed to the original; Shorten button for lines that run long

All prompts and request bodies live in `src/lib/prompts.ts` (`npm run payloads` dumps them offline).

## Run locally
```bash
npm install
cp .env.example .env.local   # add your three keys
npm run dev                  # http://localhost:3100
```

## Deploy on Vercel
Import the repo in Vercel (framework auto-detected, Nitro builds the Vercel output) and add `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`, `SARVAM_API_KEY` under **Settings → Environment Variables**. Keys are only read server-side.

## Stack
TanStack Start (React 19, server functions) · Tailwind v4 · zod · Nitro
