import { useState } from "react";
import { ArrowRight, AudioLines, Brain, Languages, ScrollText, UploadCloud } from "lucide-react";
import { CONFIG, LANGS } from "@/lib/config";
import { cx } from "./ui";

const STEPS = [
  { icon: ScrollText, label: "Transcribe" },
  { icon: Brain, label: "Read emotion" },
  { icon: Languages, label: "Transcreate" },
  { icon: AudioLines, label: "Re-voice" },
];

export function Hero({ onFiles, onBrowse, error }: { onFiles: (f: FileList | null) => void; onBrowse: () => void; error: string | null }) {
  const [over, setOver] = useState(false);

  return (
    <div className="fade-up mx-auto flex max-w-3xl flex-col items-center pt-16 pb-10 text-center">
      <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-edge bg-surface/70 px-3 py-1 text-xs text-muted">
        <span className="size-1.5 rounded-full bg-accent" /> AI dubbing in Hindi &amp; Marathi
      </span>
      <h1 className="text-balance text-[56px] font-semibold leading-[1.02] tracking-[-0.035em]">
        Dub the feeling,
        <br />
        <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">not just the words.</span>
      </h1>
      <p className="mt-5 max-w-xl text-pretty text-[17px] leading-relaxed text-muted">
        Drop a scene up to {CONFIG.MAX_LABEL} long. Lehja hears who's speaking and how they feel, rewrites every line the way a local would say it, then voices it back.
      </p>

      <button
        onClick={onBrowse}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onFiles(e.dataTransfer.files);
        }}
        className={cx(
          "group mt-10 flex w-full flex-col items-center gap-4 rounded-3xl border border-dashed px-8 py-14 transition-all",
          over ? "scale-[1.01] border-accent bg-accent/[0.06]" : "border-edge-2 bg-surface/50 hover:border-faint hover:bg-surface",
        )}
      >
        <span className="grid size-14 place-items-center rounded-2xl border border-edge-2 bg-surface-2 text-accent transition-transform group-hover:-translate-y-0.5">
          <UploadCloud className="size-6" />
        </span>
        <span>
          <span className="block text-[17px] font-medium">Drop a video, or <span className="text-accent">browse</span></span>
          <span className="mt-1 block text-sm text-faint">MP4 · WebM · MOV — up to {CONFIG.MAX_LABEL}</span>
        </span>
      </button>
      {error && <p className="mt-4 text-sm text-bad">{error}</p>}

      <div className="mt-10 flex items-center gap-2 text-sm text-faint">
        {STEPS.map((s, i) => (
          <span key={s.label} className="flex items-center gap-2">
            <s.icon className="size-4 text-muted" />
            {s.label}
            {i < STEPS.length - 1 && <ArrowRight className="mx-1 size-3.5 text-edge-2" />}
          </span>
        ))}
      </div>
      <div className="mt-6 flex gap-2">
        {LANGS.map((l) => (
          <span key={l.key} title={l.name} className="font-native rounded-full border border-edge px-3.5 py-1 text-[15px] text-muted">
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
