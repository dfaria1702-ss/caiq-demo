import { AlertCircle, ArrowRight, Check, RotateCcw } from "lucide-react";
import { LANGS, type LangKey } from "@/lib/config";
import type { Lehja, StepState } from "@/lib/useLehja";
import type { Dub } from "@/lib/types";
import { Button, Chip, Label, Panel, Spinner, cx } from "./ui";

const CORE: { key: "extract" | "transcribe" | "analyze" | "cast"; label: string }[] = [
  { key: "extract", label: "Extract audio & frames" },
  { key: "transcribe", label: "Transcribe dialogue" },
  { key: "analyze", label: "Understand the scene" },
  { key: "cast", label: "Cast voices" },
];

type Props = { app: Lehja; lang: LangKey; onLang: (k: LangKey) => void };

export function Progress({ app, lang, onLang }: Props) {
  const started = app.steps.extract.status !== "idle";
  if (!started) return <LanguagePicker app={app} lang={lang} onLang={onLang} />;

  return (
    <Panel className="fade-up p-5">
      <Label>Scene</Label>
      <ol className="mt-4 space-y-3">
        {CORE.map((s) => (
          <CoreStep key={s.key} label={s.label} state={app.steps[s.key]} onRetry={app.retryScene} />
        ))}
      </ol>

      <div className="my-5 h-px bg-edge" />
      <Label>Languages</Label>
      <ul className="-mx-2 mt-2 space-y-1">
        {LANGS.map((l) => (
          <LangRow key={l.key} label={l.label} name={l.name} dub={app.dubs[l.key]} selected={lang === l.key} app={app} onSelect={() => onLang(l.key)} />
        ))}
      </ul>
    </Panel>
  );
}

/** First screen after upload: choose ONE language to translate into. */
function LanguagePicker({ app, lang, onLang }: Props) {
  const current = LANGS.find((l) => l.key === lang)!;
  return (
    <Panel className="fade-up p-6">
      <h3 className="text-lg font-semibold tracking-tight">Choose a language</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">We'll write the script first. You review it, then confirm before anything is voiced.</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {LANGS.map((l) => {
          const on = l.key === lang;
          return (
            <button
              key={l.key}
              onClick={() => onLang(l.key)}
              className={cx(
                "rounded-xl border px-3.5 py-3 text-left transition-all",
                on ? "border-accent bg-accent/[0.07] shadow-[0_0_0_3px_rgba(255,143,63,.12)]" : "border-edge-2 hover:border-faint",
              )}
            >
              <span className="font-native block text-[17px]">{l.label}</span>
              <span className="mt-0.5 block text-[11px] text-faint">{l.name.split(" (")[0]}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-muted" title="How many people speak in the clip. Auto lets transcription decide; setting it fixes split or merged characters.">
          Speakers
        </span>
        <div className="inline-flex rounded-full border border-edge bg-bg/60 p-0.5">
          {[null, 1, 2, 3, 4].map((n) => (
            <button
              key={String(n)}
              onClick={() => app.setNumSpeakers(n)}
              className={cx("h-7 rounded-full px-2.5 text-xs transition-colors", app.numSpeakers === n ? "bg-surface-2 text-fg ring-1 ring-edge-2" : "text-muted hover:text-fg")}
            >
              {n ?? "Auto"}
            </button>
          ))}
        </div>
      </div>
      <Button variant="primary" size="lg" className="mt-5 w-full" onClick={() => app.translate(lang)}>
        Translate to {current.name.split(" (")[0]} <ArrowRight className="size-4" />
      </Button>
      {app.uploadError && <p className="mt-3 text-sm text-bad">{app.uploadError}</p>}
    </Panel>
  );
}

function StatusIcon({ status }: { status: StepState["status"] }) {
  return (
    <span
      className={cx(
        "grid size-5 shrink-0 place-items-center rounded-full",
        status === "done" && "bg-ok/15 text-ok",
        status === "running" && "text-accent",
        status === "error" && "bg-bad/15 text-bad",
        status === "idle" && "border border-edge-2",
      )}
    >
      {status === "done" ? <Check className="size-3" strokeWidth={3} /> : status === "running" ? <Spinner className="size-4" /> : status === "error" ? <AlertCircle className="size-3" /> : null}
    </span>
  );
}

function CoreStep({ label, state, onRetry }: { label: string; state: StepState; onRetry: () => void }) {
  return (
    <li>
      <div className="flex items-center gap-3">
        <StatusIcon status={state.status} />
        <span className={cx("text-sm", state.status === "idle" ? "text-faint" : "text-fg")}>{label}</span>
        {state.ms != null && <span className="ml-auto font-mono text-[11px] text-faint">{(state.ms / 1000).toFixed(1)}s</span>}
      </div>
      {state.status === "error" && <ErrorBox message={state.error} onRetry={onRetry} />}
    </li>
  );
}

export const STATUS_TEXT: Record<Dub["status"], string> = {
  idle: "Not started",
  translating: "Translating…",
  translated: "Review script",
  voicing: "Voicing",
  ready: "Dubbed",
  error: "Failed",
};

function LangRow({ label, name, dub, selected, app, onSelect }: { label: string; name: string; dub: Dub; selected: boolean; app: Lehja; onSelect: () => void }) {
  const total = dub.lines.length;
  const pct = dub.status === "ready" ? 100 : dub.status === "voicing" && total ? (dub.voiced / total) * 100 : dub.status === "translated" ? 50 : 0;
  const k = dub.langKey;

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => e.key === "Enter" && onSelect()}
        className={cx("cursor-pointer rounded-xl px-2 py-2.5 transition-colors", selected ? "bg-surface-2" : "hover:bg-surface-2/60")}
      >
        <div className="flex items-center gap-2">
          <span className="font-native text-[15px]" title={name}>{label}</span>
          <span
            className={cx(
              "text-xs",
              dub.status === "ready" && "text-ok",
              dub.status === "translated" && "text-accent-2",
              dub.status === "error" && "text-bad",
              (dub.status === "idle" || dub.status === "translating" || dub.status === "voicing") && "text-faint",
            )}
          >
            {dub.status === "voicing" ? `Voicing ${dub.voiced}/${total}` : STATUS_TEXT[dub.status]}
          </span>
          <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
            {dub.status === "idle" && (
              <Button size="sm" variant="ghost" className="h-7" onClick={() => (onSelect(), app.translate(k))}>
                Translate
              </Button>
            )}
            {dub.status === "translated" && (
              <Button size="sm" variant="primary" className="h-7" onClick={() => (onSelect(), app.dub(k))} disabled={dub.translatedAt !== dub.slangLevel}>
                Dub
              </Button>
            )}
          </span>
        </div>
        {dub.status !== "idle" && dub.status !== "error" && (
          <div className={cx("relative mt-2 h-1 overflow-hidden rounded-full bg-edge", dub.status === "translating" && "shimmer")}>
            <div className={cx("h-full rounded-full transition-all duration-500", dub.status === "ready" ? "bg-ok" : "bg-accent")} style={{ width: `${pct}%` }} />
          </div>
        )}
        {dub.status === "error" && <ErrorBox message={dub.error} onRetry={() => app.retry(k)} />}
      </div>
    </li>
  );
}

function ErrorBox({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="mt-2 rounded-xl border border-bad/20 bg-bad/[0.06] p-3" onClick={(e) => e.stopPropagation()}>
      <p className="text-xs leading-relaxed text-bad/90">{message}</p>
      <Button size="sm" className="mt-2.5" onClick={onRetry}>
        <RotateCcw className="size-3.5" /> Retry step
      </Button>
    </div>
  );
}

const LANG_NAMES: Record<string, string> = { eng: "English", en: "English", hin: "Hindi", hi: "Hindi", guj: "Gujarati", mar: "Marathi", spa: "Spanish", fra: "French" };

export function Cast({ app }: { app: Lehja }) {
  if (!app.detected && !app.characters.length) return null;
  return (
    <Panel className="fade-up p-5">
      <div className="flex items-center justify-between">
        <Label>Cast</Label>
        <div className="flex gap-1.5">
          {app.scene.summary && <Chip className="bg-surface-2 capitalize text-muted">{app.scene.tone}</Chip>}
          {app.detected && (
            <Chip className="bg-surface-2 text-muted">
              {LANG_NAMES[app.detected.code] ?? app.detected.code.toUpperCase()}
              <span className="text-faint">{Math.round(app.detected.prob * 100)}%</span>
            </Chip>
          )}
        </div>
      </div>
      {app.scene.summary ? (
        <p className="mt-3 text-[13px] leading-relaxed text-muted">{app.scene.summary}</p>
      ) : (
        <p className="mt-3 text-[13px] text-faint">{app.lines.length} lines transcribed. Reading the scene…</p>
      )}
      {app.characters.length > 0 && (
        <ul className="mt-5 space-y-4">
          {app.characters.map((c) => (
            <li key={c.id} className="flex gap-3">
              <span
                className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold"
                style={{ background: `${c.color ?? "#71717a"}1f`, color: c.color ?? "#a1a1aa", boxShadow: `inset 0 0 0 1px ${c.color ?? "#71717a"}55` }}
              >
                {c.name[0]}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {c.name} <span className="font-normal text-faint">· {c.gender} · {c.age}</span>
                </p>
                <p className="mt-0.5 text-[13px] leading-snug text-muted">
                  {[c.voice.texture, `${c.voice.pitch} pitch`, `${c.voice.pace} pace`].filter(Boolean).join(", ")}. {c.personality}
                </p>
                {c.voiceName && <p className="mt-1 text-[11px] text-faint">Voice · {c.voiceName}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {app.scene.relationships.length > 0 && (
        <p className="mt-4 text-[11px] text-faint">
          {app.scene.relationships
            .map((r) => `${r.between.map((id) => app.characters.find((c) => c.id === id)?.name ?? id).join(" & ")}: ${r.relation} (${r.register})`)
            .join(" · ")}
        </p>
      )}
    </Panel>
  );
}
