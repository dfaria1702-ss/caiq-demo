// Dummy scene used while API keys are not configured.
// A 26 s, two-character scene: humour → anger → tenderness.
import type { LangKey } from "./config";
import type { Character, Line, Scene, ScribeWord } from "./types";

export const MOCK_TEMPLATE_SECONDS = 26;

type ScriptLine = {
  speaker: string;
  start: number;
  end: number;
  text: string;
  event?: { text: string; at: number };
};

export const MOCK_SCRIPT: ScriptLine[] = [
  { speaker: "speaker_0", start: 0.6, end: 3.2, text: "Okay, don't kill me... but I may have eaten your cake.", event: { text: "(laughs)", at: 0.3 } },
  { speaker: "speaker_1", start: 3.8, end: 5.9, text: "The whole cake? Raj, that was for my mom!" },
  { speaker: "speaker_0", start: 6.5, end: 8.6, text: "In my defence, it was looking at me." },
  { speaker: "speaker_1", start: 9.2, end: 12.6, text: "You always do this! You never think about anyone but yourself!" },
  { speaker: "speaker_0", start: 13.4, end: 16.2, text: "Hey... hey. I'm sorry. I'll bake her a new one. Tonight.", event: { text: "(sighs)", at: 13.1 } },
  { speaker: "speaker_1", start: 16.9, end: 18.9, text: "You? Bake? You burn toast.", event: { text: "(laughs)", at: 19.0 } },
  { speaker: "speaker_0", start: 19.7, end: 22.0, text: "Then you'll have to stay and help me." },
  { speaker: "speaker_1", start: 22.8, end: 25.2, text: "...Fine. But you're buying the chocolate." },
];

/** Fake Scribe word stream, scaled to the clip's real duration. */
export function mockWords(clipSeconds: number): ScribeWord[] {
  const k = Math.min(1, clipSeconds / MOCK_TEMPLATE_SECONDS);
  const words: ScribeWord[] = [];
  for (const line of MOCK_SCRIPT) {
    if (line.event) words.push({ text: line.event.text, start: line.event.at * k, end: (line.event.at + 0.3) * k, type: "audio_event" });
    const tokens = line.text.split(" ");
    const step = ((line.end - line.start) * k) / tokens.length;
    tokens.forEach((t, i) => {
      const s = line.start * k + i * step;
      words.push({ text: t, start: s, end: s + step * 0.85, type: "word", speaker_id: line.speaker });
      words.push({ text: " ", start: s + step * 0.85, end: s + step, type: "spacing", speaker_id: line.speaker });
    });
  }
  return words.sort((a, b) => a.start - b.start);
}

// Demo mode only (LEHJA_MOCK=1). Never used when running live.
export const MOCK_SCENE: Scene = {
  summary: "Two close friends in a kitchen. Raj sheepishly confesses he ate the birthday cake Meera bought for her mother; she explodes, he apologises, and her anger melts into teasing affection.",
  tone: "comedy",
  relationships: [{ between: ["C1", "C2"], relation: "close friends", register: "intimate" }],
};

export const MOCK_CHARACTERS: Character[] = [
  { id: "C1", name: "Raj", speakerIds: ["speaker_0"], gender: "male", age: "20s", voice: { pitch: "low", pace: "fast", energy: "lively", texture: "warm, slightly nasal" }, personality: "cheeky, deflects with humour, soft when guilty" },
  { id: "C2", name: "Meera", speakerIds: ["speaker_1"], gender: "female", age: "20s", voice: { pitch: "mid", pace: "fast", energy: "intense", texture: "bright, clear" }, personality: "sharp, quick-tempered, forgives fast" },
];

type Analysis = Pick<Line, "characterId" | "addresseeId" | "emotion" | "intensity" | "delivery" | "nonVerbal" | "emphasis" | "subtext">;
export const MOCK_LINE_ANALYSIS: Record<string, Analysis> = {
  L01: { characterId: "C1", addresseeId: "C2", emotion: "sheepish", intensity: 6, delivery: "nervous laugh, rushed second half", nonVerbal: ["laughs"], emphasis: "cake", subtext: "hoping charm saves him" },
  L02: { characterId: "C2", addresseeId: "C1", emotion: "surprised", intensity: 6, delivery: "rising pitch, stress on whole", nonVerbal: [], emphasis: "whole", subtext: "anger building" },
  L03: { characterId: "C1", addresseeId: "C2", emotion: "playful", intensity: 7, delivery: "deadpan, mock-serious", nonVerbal: [], subtext: "doubling down on the joke" },
  L04: { characterId: "C2", addresseeId: "C1", emotion: "angry", intensity: 8, delivery: "loud, clipped", nonVerbal: [], emphasis: "always", subtext: "this is about more than cake" },
  L05: { characterId: "C1", addresseeId: "C2", emotion: "sad", intensity: 6, delivery: "soft, slow", nonVerbal: ["sighs"], subtext: "finally understands he hurt her" },
  L06: { characterId: "C2", addresseeId: "C1", emotion: "sarcastic", intensity: 5, delivery: "dry, smile breaking through", nonVerbal: ["laughs"], subtext: "already forgiving him" },
  L07: { characterId: "C1", addresseeId: "C2", emotion: "tender", intensity: 5, delivery: "gentle, playful", nonVerbal: [], subtext: "asking her to stay" },
  L08: { characterId: "C2", addresseeId: "C1", emotion: "tender", intensity: 4, delivery: "mock-reluctant, warm", nonVerbal: ["sighs"], subtext: "yes" },
};

type MockDubLine = { text: string; transliteration: string; tags: string; note: string };
type Variant = { casual: MockDubLine[]; formal: MockDubLine[] };

const HINDI_FORMAL: MockDubLine[] = [
  { text: "देखो, नाराज़ मत होना... लेकिन शायद मैंने तुम्हारा केक खा लिया।", transliteration: "Dekho, naaraaz mat hona... lekin shaayad maine tumhaara cake kha liya.", tags: "[nervous] [laughs]", note: "Formal register: polite 'tum' and 'lekin', no regional markers." },
  { text: "पूरा केक? राज, वह माँ के लिए था!", transliteration: "Poora cake? Raj, vah maa ke liye tha!", tags: "[shocked]", note: "'Maa' instead of 'mummy' keeps the formal tone." },
  { text: "मेरी सफ़ाई में, वह मुझे देख रहा था।", transliteration: "Meri safaai mein, vah mujhe dekh raha tha.", tags: "[sarcastic]", note: "Literal 'in my defence' works in formal Hindi as 'meri safaai mein'." },
  { text: "तुम हमेशा ऐसा ही करते हो! तुम केवल अपने बारे में सोचते हो!", transliteration: "Tum hamesha aisa hi karte ho! Tum keval apne baare mein sochte ho!", tags: "[angry]", note: "'Keval' over 'bas' keeps the anger formal and precise." },
  { text: "सुनो... मुझे क्षमा करो। मैं आज रात उनके लिए नया केक बनाऊँगा।", transliteration: "Suno... mujhe kshama karo. Main aaj raat unke liye naya cake banaaoonga.", tags: "[sighs] [softly]", note: "'Kshama karo' is the textbook apology." },
  { text: "तुम? केक बनाओगे? तुमसे तो टोस्ट भी जल जाता है।", transliteration: "Tum? Cake banaaoge? Tumse toh toast bhi jal jaata hai.", tags: "[sarcastic] [laughs]", note: "Kept the three-beat rhythm of the sarcasm." },
  { text: "तो फिर तुम्हें रुककर मेरी सहायता करनी होगी।", transliteration: "Toh phir tumhein rukkar meri sahaayata karni hogi.", tags: "[softly]", note: "'Sahaayata' is the formal word for help." },
  { text: "...ठीक है। लेकिन चॉकलेट तुम ख़रीदोगे।", transliteration: "...Theek hai. Lekin chocolate tum khareedoge.", tags: "[sighs]", note: "Direct and neutral; warmth carried by delivery." },
];

export const MOCK_DUBS: Record<LangKey, Variant> = {
  hi: {
    formal: HINDI_FORMAL,
    casual: [
      { text: "ओये, गुस्सा मत करियो... पर तेरा केक मैंने खा लिया यार।", transliteration: "Oye, gussa mat kariyo... par tera cake maine kha liya yaar.", tags: "[nervous] [laughs]", note: "'Kariyo' is a Delhi-Punjabi imperative that softens the confession." },
      { text: "पूरा केक? राज, वो मम्मी के लिए था भाई!", transliteration: "Poora cake? Raj, woh mummy ke liye tha bhai!", tags: "[shocked]", note: "Delhi uses 'bhai' as an exasperated intensifier, even to a friend." },
      { text: "अब मैं क्या करता, वो मुझे बुला रहा था।", transliteration: "Ab main kya karta, woh mujhe bula raha tha.", tags: "[sarcastic]", note: "'It was calling me' is the classic Delhi excuse." },
      { text: "तू हमेशा यही करता है! तुझे बस अपनी पड़ी रहती है!", transliteration: "Tu hamesha yahi karta hai! Tujhe bas apni padi rehti hai!", tags: "[angry] [shouting]", note: "'Apni padi rehti hai' is the idiomatic Delhi way to say selfish." },
      { text: "अच्छा सुन... सॉरी यार। आज रात नया बना दूंगा, टेंशन ना ले।", transliteration: "Accha sun... sorry yaar. Aaj raat naya bana doonga, tension na le.", tags: "[sighs] [softly]", note: "'Tension na le' — Delhi reassurance in four words." },
      { text: "तू? केक? तुझसे तो मैगी भी नहीं बनती।", transliteration: "Tu? Cake? Tujhse toh Maggi bhi nahi banti.", tags: "[sarcastic] [laughs]", note: "Swapped toast for Maggi — lands harder for a Delhi audience." },
      { text: "तो फिर तू रुक जा, मेरी मदद कर दे।", transliteration: "Toh phir tu ruk ja, meri madad kar de.", tags: "[softly]", note: "Direct, warm imperative instead of a 'you'll have to'." },
      { text: "...चल ठीक है। पर चॉकलेट तेरी तरफ से, पाजी।", transliteration: "...Chal theek hai. Par chocolate teri taraf se, paaji.", tags: "[sighs]", note: "Teasing 'paaji' closes the scene with Punjabi warmth." },
    ],
  },
  mr: {
    casual: [
      { text: "हे बघ, रागावू नकोस... पण मी तुझा केक खाल्ला बहुतेक.", transliteration: "He bagh, raagavu nakos... pan mi tujha cake khalla bahutek.", tags: "[nervous] [laughs]", note: "'Bahutek' (probably) at the end makes the confession sheepish." },
      { text: "पूर्ण केक? राज, तो आईसाठी होता रे!", transliteration: "Poorna cake? Raj, to aaisaathi hota re!", tags: "[shocked]", note: "Mumbai Marathi 're' carries the exasperation." },
      { text: "काय करू, तो माझ्याकडे बघत होता.", transliteration: "Kaay karu, to maajhyakade baghat hota.", tags: "[sarcastic]", note: "'Kaay karu' is the shrugging Marathi excuse." },
      { text: "तू नेहमी असंच करतोस! तुला फक्त स्वतःचं पडलेलं असतं!", transliteration: "Tu nehmi asach kartos! Tula fakt swatahcha padlela asta!", tags: "[angry] [shouting]", note: "Idiomatic 'swatahcha padlela' for selfish." },
      { text: "अगं... सॉरी ना. आज रात्री नवीन बनवतो, पक्का.", transliteration: "Aga... sorry na. Aaj raatri navin banavto, pakka.", tags: "[sighs] [softly]", note: "'Aga' is the tender way to address her in Marathi." },
      { text: "तू? केक? तुझ्याकडून तर टोस्ट पण जळतो.", transliteration: "Tu? Cake? Tujhyakadun tar toast pan jalto.", tags: "[sarcastic] [laughs]", note: "Kept the three-beat rhythm of the sarcasm." },
      { text: "मग तुला थांबावं लागेल, मदत करायला.", transliteration: "Mag tula thaambava laagel, madat karaayla.", tags: "[softly]", note: "'Mag' (then) keeps it light and playful." },
      { text: "...बरं, चालेल. पण चॉकलेट तुझ्याकडून.", transliteration: "...Bara, chaalel. Pan chocolate tujhyakadun.", tags: "[sighs]", note: "'Chaalel' — the quintessential Marathi yes." },
    ],
    formal: [
      { text: "कृपया रागावू नका... परंतु कदाचित मी तुमचा केक खाल्ला आहे.", transliteration: "Krupaya raagavu naka... parantu kadaachit mi tumcha cake khalla aahe.", tags: "[nervous]", note: "Puneri formal: respectful 'tumhi' and 'krupaya'." },
      { text: "संपूर्ण केक? राज, तो आईसाठी होता!", transliteration: "Sampoorna cake? Raj, to aaisaathi hota!", tags: "[shocked]", note: "'Sampoorna' is the formal 'whole'." },
      { text: "माझ्या बचावात सांगायचं तर, तो माझ्याकडे पाहत होता.", transliteration: "Maajhya bachaavaat saangaaycha tar, to maajhyakade paahat hota.", tags: "[sarcastic]", note: "'Paahat' over 'baghat' — the standard verb." },
      { text: "तुम्ही नेहमी असेच करता! तुम्ही फक्त स्वतःचाच विचार करता!", transliteration: "Tumhi nehmi asech karta! Tumhi fakt swatahchaach vichaar karta!", tags: "[angry]", note: "Anger kept, but in respectful plural." },
      { text: "ऐका... मला क्षमा करा. मी आज रात्री त्यांच्यासाठी नवीन केक बनवेन.", transliteration: "Aika... mala kshama kara. Mi aaj raatri tyanchyasaathi navin cake banaven.", tags: "[sighs] [softly]", note: "'Kshama kara' is the textbook apology." },
      { text: "तुम्ही? केक बनवणार? तुमच्याकडून तर टोस्टसुद्धा जळतो.", transliteration: "Tumhi? Cake banavnaar? Tumchyakadun tar toastsuddha jalto.", tags: "[sarcastic] [laughs]", note: "'Suddha' instead of 'pan' — formal 'even'." },
      { text: "मग तुम्हाला थांबून माझी मदत करावी लागेल.", transliteration: "Mag tumhaala thaambun maajhi madat karaavi laagel.", tags: "[softly]", note: "Polite obligation form." },
      { text: "...ठीक आहे. परंतु चॉकलेट तुम्ही विकत घ्याल.", transliteration: "...Theek aahe. Parantu chocolate tumhi vikat ghyaal.", tags: "[sighs]", note: "'Vikat ghyaal' — formal 'will buy'." },
    ],
  },
};
