import { useEffect, useRef, useState, type RefObject } from "react";
import { Volume1 } from "lucide-react";
import { CONFIG, LANGS, type LangKey } from "@/lib/config";
import type { Lehja } from "@/lib/useLehja";
import { Segmented, Spinner, cx, fmtTime } from "./ui";

type Props = {
  app: Lehja;
  videoRef: RefObject<HTMLVideoElement | null>;
  playerLang: LangKey | null;
  onPickLang: (k: LangKey) => void;
  activeLineId: string | null;
};

export function Player({ app, videoRef, playerLang, onPickLang, activeLineId }: Props) {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-edge bg-black shadow-[0_30px_80px_-30px_rgba(0,0,0,.8)]">
        <video
          ref={videoRef}
          key={app.videoUrl}
          src={app.videoUrl ?? undefined}
          controls
          playsInline
          className="aspect-video w-full"
          onLoadedMetadata={(e) => (e.currentTarget.volume = CONFIG.ORIGINAL_VOLUME)}
        />
      </div>

      <Timeline app={app} videoRef={videoRef} activeLineId={activeLineId} />

      <div className="flex items-center gap-4">
        <span className="text-sm text-muted">Listen in</span>
        <Segmented
          value={playerLang}
          onChange={onPickLang}
          options={LANGS.map((l) => {
            const s = app.dubs[l.key].status;
            return {
              value: l.key,
              label: l.label,
              title: s === "ready" ? l.name : `${l.name} — dub it first`,
              disabled: s !== "ready",
              adornment: s === "voicing" ? <Spinner className="size-3 text-accent" /> : s === "error" ? <span className="size-1.5 rounded-full bg-bad" /> : null,
            };
          })}
        />
        <span className="ml-auto flex items-center gap-1.5 text-xs text-faint">
          <Volume1 className="size-3.5" /> Original plays at {Math.round(CONFIG.ORIGINAL_VOLUME * 100)}%
        </span>
      </div>
    </div>
  );
}

/** Dialogue track: one block per line, coloured by character, with a live playhead. Click to seek. */
function Timeline({ app, videoRef, activeLineId }: { app: Lehja; videoRef: RefObject<HTMLVideoElement | null>; activeLineId: string | null }) {
  const [t, setT] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const dur = app.duration || 1;
  const colors = new Map(app.characters.map((c) => [c.id, c.color]));

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const v = videoRef.current;
      if (v) setT(v.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  const seek = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    const v = videoRef.current;
    if (!r || !v) return;
    v.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur;
  };

  return (
    <div>
      <div ref={track} onClick={(e) => seek(e.clientX)} className="relative h-12 cursor-pointer overflow-hidden rounded-xl border border-edge bg-surface">
        {/* second ticks */}
        {Array.from({ length: Math.floor(dur) }, (_, i) => (
          <span key={i} className={cx("absolute bottom-0 w-px bg-edge", i % 5 === 0 ? "h-2.5" : "h-1.5")} style={{ left: `${(i / dur) * 100}%` }} />
        ))}
        {app.lines.map((l) => {
          const c = colors.get(l.characterId ?? "") ?? "#71717a";
          const on = activeLineId === l.id;
          return (
            <div
              key={l.id}
              title={l.text}
              className="absolute top-2 bottom-3 rounded-md transition-all"
              style={{
                left: `${(l.start / dur) * 100}%`,
                width: `${((l.end - l.start) / dur) * 100}%`,
                background: on ? c : `${c}33`,
                boxShadow: `inset 0 0 0 1px ${c}${on ? "" : "66"}`,
              }}
            />
          );
        })}
        {!app.lines.length && (
          <span className="absolute inset-0 grid place-items-center text-xs text-faint">Dialogue appears here once the scene is transcribed</span>
        )}
        <span className="pointer-events-none absolute inset-y-0 w-0.5 rounded-full bg-fg shadow-[0_0_10px_rgba(255,255,255,.6)]" style={{ left: `${(t / dur) * 100}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] text-faint">
        <span>{fmtTime(t)}</span>
        <span className="flex gap-4">
          {app.characters.map((c) => (
            <span key={c.id} className="flex items-center gap-1.5 font-sans">
              <span className="size-2 rounded-full" style={{ background: c.color }} />
              {c.name}
            </span>
          ))}
        </span>
        <span>{fmtTime(dur)}</span>
      </div>
    </div>
  );
}
