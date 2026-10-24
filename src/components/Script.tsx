import { useEffect, useRef } from "react";
import { AudioLines, Check, Eye, Info, Languages, MicOff, Play, RotateCcw, Scissors } from "lucide-react";
import { LANGS, SLANG_LEVELS, langOf, type LangKey } from "@/lib/config";
import type { Lehja } from "@/lib/useLehja";
import type { Character, DubLine, Fit, Line } from "@/lib/types";
import { Button, Chip, Label, Segmented, Spinner, cx, fmtTime } from "./ui";
import { STATUS_TEXT } from "./Progress";

type Props = {
  app: Lehja;
  tab: LangKey;
  onTab: (k: LangKey) => void;
  activeLineId: string | null;
  onPreview: (lineId: string, lang: LangKey) => void;
};

export function Script({ app, tab, onTab, activeLineId, onPreview }: Props) {
  const dub = app.dubs[tab];
  const translating = dub.status === "translating";
  const byLine = new Map(dub.lines.map((l) => [l.lineId, l]));
  const chars = new Map(app.characters.map((c) => [c.id, c]));
  const name = langOf(tab).name.split(" (")[0];

  return (
    <section className="mt-14">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Script</h2>
          <p className="mt-1 text-sm text-muted">
            {app.lines.length ? `${app.lines.length} lines · transcreated, not translated word-for-word` : "Appears once the scene is transcribed"}
          </p>
        </div>
        <Segmented
          value={tab}
          onChange={onTab}
          options={LANGS.map((l) => {
            const s = app.dubs[l.key].status;
            return {
              value: l.key,
              label: l.label,
              title: `${l.name} — ${STATUS_TEXT[s]}`,
              adornment:
                s === "translating" || s === "voicing" ? (
                  <Spinner className="size-3 text-accent" />
                ) : s === "translated" ? (
                  <span className="size-1.5 rounded-full bg-accent" />
                ) : s === "ready" ? (
                  <span className="size-1.5 rounded-full bg-ok" />
                ) : s === "error" ? (
                  <span className="size-1.5 rounded-full bg-bad" />
                ) : null,
            };
          })}
        />
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-edge bg-surface">
        {/* Toolbar: slang level (R-4.5) + the translate → confirm → dub actions */}
        <div className="flex items-center gap-8 border-b border-edge px-6 py-4">
          <div className="w-44 shrink-0">
            <Label>Slang level</Label>
            <p className="mt-1 text-sm font-medium text-accent-2">{SLANG_LEVELS[dub.slangLevel]}</p>
          </div>
          <SlangSlider value={dub.slangLevel} onChange={(v) => app.setSlang(tab, v)} />
          <div className="ml-auto flex items-center gap-2">
            <Actions app={app} tab={tab} name={name} />
          </div>
        </div>

        {dub.status === "translated" && (
          <div className="fade-up flex items-center gap-3 border-b border-accent/20 bg-accent/[0.06] px-6 py-3 text-sm">
            <Eye className="size-4 text-accent" />
            {dub.translatedAt === dub.slangLevel ? (
              <span className="text-fg/90">
                Review the {name} script below. <span className="text-muted">Nothing is voiced until you confirm.</span>
              </span>
            ) : (
              <span className="text-fg/90">
                Slang level changed to {SLANG_LEVELS[dub.slangLevel]}. <span className="text-muted">Re-translate to update the script before dubbing.</span>
              </span>
            )}
          </div>
        )}
        {dub.status === "ready" && dub.translatedAt !== dub.slangLevel && (
          <div className="fade-up flex items-center gap-3 border-b border-edge bg-surface-2/60 px-6 py-3 text-sm text-muted">
            <Info className="size-4" /> Slang level changed. Re-translate, review, then dub again to hear it.
          </div>
        )}

        {dub.error && dub.status !== "error" && (
          <div className="flex items-center gap-3 border-b border-bad/20 bg-bad/[0.06] px-6 py-3 text-sm text-bad">
            <Info className="size-4" /> {dub.error}
          </div>
        )}
        {app.lines.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-faint">
            {translating ? "Transcribing the scene…" : "Nothing here yet — choose a language and translate to see the script."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1.15fr)] gap-8 border-b border-edge px-6 py-2.5">
              <Label>Time</Label>
              <Label>Original</Label>
              <Label>{name}</Label>
            </div>
            <div className="divide-y divide-edge">
              {app.lines.map((line) => (
                <Row
                  key={line.id}
                  line={line}
                  char={chars.get(line.characterId ?? "")}
                  addressee={chars.get(line.addresseeId ?? "")?.name}
                  dub={byLine.get(line.id)}
                  onShorten={() => app.shortenLine(tab, line.id)}
                  pending={translating}
                  voicing={dub.status === "voicing"}
                  active={activeLineId === line.id}
                  onPlay={() => onPreview(line.id, tab)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** The one or two buttons that move this language forward. Translation always comes first. */
function Actions({ app, tab, name }: { app: Lehja; tab: LangKey; name: string }) {
  const d = app.dubs[tab];
  const stale = d.translatedAt !== d.slangLevel;
  switch (d.status) {
    case "idle":
      return (
        <Button variant="primary" onClick={() => app.translate(tab)}>
          <Languages className="size-4" /> Translate to {name}
        </Button>
      );
    case "translating":
      return (
        <Button variant="primary" disabled>
          <Spinner className="size-3.5" /> Translating…
        </Button>
      );
    case "translated":
      return stale ? (
        <Button variant="primary" onClick={() => app.translate(tab)}>
          <RotateCcw className="size-3.5" /> Re-translate
        </Button>
      ) : (
        <>
          <Button variant="ghost" onClick={() => app.translate(tab)}>
            <RotateCcw className="size-3.5" /> Re-translate
          </Button>
          <Button variant="primary" onClick={() => app.dub(tab)}>
            <Check className="size-4" /> Confirm & dub
          </Button>
        </>
      );
    case "voicing":
      return (
        <Button variant="primary" disabled>
          <Spinner className="size-3.5" /> Dubbing {d.voiced}/{d.lines.length}
        </Button>
      );
    case "ready":
      return (
        <Button onClick={() => app.translate(tab)}>
          <RotateCcw className="size-3.5" /> Re-translate
        </Button>
      );
    case "error":
      return (
        <Button variant="primary" onClick={() => app.retry(tab)}>
          <RotateCcw className="size-3.5" /> Retry {d.errorStage === "voice" ? "dubbing" : "translation"}
        </Button>
      );
  }
}

function SlangSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const pct = (value / 4) * 100;
  return (
    <div className="w-full max-w-md">
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-edge" />
        <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        {SLANG_LEVELS.map((_, i) => (
          <span
            key={i}
            className={cx("absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full", i <= value ? "bg-transparent" : "bg-edge-2")}
            style={{ left: `${(i / 4) * 100}%` }}
          />
        ))}
        <span
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg shadow-[0_0_0_4px_rgba(255,143,63,.25)] transition-all"
          style={{ left: `${pct}%` }}
        />
        <input type="range" min={0} max={4} step={1} value={value} aria-label="Slang level" onChange={(e) => onChange(Number(e.target.value))} className="range-overlay" />
      </div>
      <div className="relative mt-1.5 h-4 text-[11px]">
        {SLANG_LEVELS.map((s, i) => (
          <button
            key={s}
            onClick={() => onChange(i)}
            className={cx("absolute -translate-x-1/2 whitespace-nowrap transition-colors hover:text-fg", i === value ? "text-fg" : "text-faint", i === 0 && "translate-x-0", i === 4 && "-translate-x-full")}
            style={{ left: `${(i / 4) * 100}%` }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

const FIT: Record<Fit, { label: string; cls: string }> = {
  fits: { label: "Fits", cls: "text-ok bg-ok/10" },
  sped_up: { label: "Sped up", cls: "text-warn bg-warn/10" },
  long: { label: "Long", cls: "text-bad bg-bad/10" },
};

type RowProps = { line: Line; char?: Character; addressee?: string; dub?: DubLine; pending: boolean; voicing: boolean; active: boolean; onPlay: () => void; onShorten: () => void };

function Row({ line, char, addressee, dub, pending, voicing, active, onPlay, onShorten }: RowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);
  const color = char?.color ?? "#71717a";

  return (
    <div
      ref={ref}
      className={cx("group grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1.15fr)] gap-8 px-6 py-5 transition-colors", active ? "bg-accent/[0.06]" : "hover:bg-white/[0.015]")}
      style={active ? { boxShadow: "inset 2px 0 0 var(--color-accent)" } : undefined}
    >
      <div className="pt-0.5 font-mono text-xs text-faint">{fmtTime(line.start)}</div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium" style={{ color }}>
            {char?.name ?? line.speakerId}
            {addressee && <span className="font-normal text-faint"> → {addressee}</span>}
          </span>
          {line.emotion && (
            <Chip className="h-5 bg-surface-2 px-2 text-[11px] capitalize text-muted ring-1 ring-edge-2">
              {line.emotion}
              <Intensity value={line.intensity ?? 0} />
            </Chip>
          )}
        </div>
        <p className="mt-1.5 text-[15px] leading-relaxed text-fg/90">
          <OriginalText text={line.text} unsure={line.lowConfidence} emphasis={line.emphasis} />
        </p>
        {(line.delivery || line.nonVerbal?.length) && (
          <p className="mt-1 text-xs italic text-faint">{[line.delivery, ...(line.nonVerbal ?? []).map((n) => `(${n})`)].filter(Boolean).join(" · ")}</p>
        )}
      </div>

      <div className="min-w-0">
        {dub ? (
          <div className="fade-up flex gap-4">
            <button
              onClick={onPlay}
              disabled={!dub.audioUrl}
              aria-label="Play this line"
              title={dub.audioUrl ? "Play this line" : voicing ? "Voicing…" : "Confirm & dub to hear this line"}
              className={cx(
                "mt-0.5 grid size-9 shrink-0 place-items-center rounded-full border transition-all",
                active ? "border-accent bg-accent text-black" : "border-edge-2 text-fg hover:border-accent hover:text-accent disabled:opacity-40",
              )}
            >
              {!dub.audioUrl ? voicing ? <Spinner className="size-3.5" /> : <MicOff className="size-3.5 text-faint" /> : active ? <AudioLines className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={cx("font-native text-[20px] leading-snug transition-opacity", dub.busy && "opacity-40")}>{dub.text}</p>
              <p className="mt-1 text-[13px] text-muted">{dub.transliteration}</p>
              <div className="mt-2.5 flex items-center gap-2">
                {dub.fit && (
                  <Chip className={cx("h-5 px-2 text-[11px]", FIT[dub.fit].cls)}>
                    {FIT[dub.fit].label}
                    {dub.fit !== "fits" && <span className="opacity-70">×{dub.playbackRate?.toFixed(2)}</span>}
                  </Chip>
                )}
                {dub.fit === "long" && (
                  <button
                    onClick={onShorten}
                    disabled={dub.busy}
                    title="Ask Sarvam to trim this line to fit its slot, then re-voice just this line"
                    className="flex items-center gap-1 text-[11px] text-accent-2 transition-colors hover:text-accent disabled:opacity-50"
                  >
                    {dub.busy ? <Spinner className="size-3" /> : <Scissors className="size-3.5" />} Shorten
                  </button>
                )}
                <span className="group/note relative">
                  <span className="flex cursor-help items-center gap-1 text-[11px] text-faint transition-colors hover:text-fg">
                    <Info className="size-3.5" /> Why
                  </span>
                  <span className="pointer-events-none absolute bottom-6 left-0 z-20 w-72 rounded-xl border border-edge-2 bg-surface-2 p-3 text-xs leading-relaxed text-fg opacity-0 shadow-2xl transition-opacity group-hover/note:opacity-100">
                    {dub.note}
                    <span className="mt-2 block font-mono text-[10px] text-faint">{dub.ttsText.match(/\[[^\]]+\]/g)?.join(" ")}</span>
                  </span>
                </span>
              </div>
            </div>
          </div>
        ) : pending ? (
          <div className="flex gap-4">
            <div className="size-9 shrink-0 animate-pulse rounded-full bg-surface-2" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-5 w-4/5 animate-pulse rounded-md bg-surface-2" />
              <div className="h-3 w-3/5 animate-pulse rounded-md bg-surface-2" />
            </div>
          </div>
        ) : (
          <p className="pt-1 text-sm text-faint">—</p>
        )}
      </div>
    </div>
  );
}

function Intensity({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5" title={`Intensity ${value}/10`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cx("h-2 w-[3px] rounded-full", i < Math.round(value / 2) ? "bg-accent" : "bg-edge-2")} />
      ))}
    </span>
  );
}

/** Original line with low-confidence words underlined and the stressed word bolded. */
function OriginalText({ text, unsure, emphasis }: { text: string; unsure?: string[]; emphasis?: string }) {
  const u = new Set((unsure ?? []).map((w) => w.toLowerCase()));
  const e = emphasis?.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
  return (
    <>
      {text.split(/(\s+)/).map((tok, i) => {
        const bare = tok.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
        if (!bare) return tok;
        const isUnsure = u.has(bare);
        const isStressed = !!e && bare === e;
        if (!isUnsure && !isStressed) return tok;
        return (
          <span
            key={i}
            title={isUnsure ? "Transcription wasn't sure about this word" : "Stressed word"}
            className={cx(isUnsure && "underline decoration-warn/70 decoration-dotted underline-offset-4", isStressed && "font-semibold text-fg")}
          >
            {tok}
          </span>
        );
      })}
    </>
  );
}
