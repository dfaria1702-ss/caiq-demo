import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Film, Plus } from "lucide-react";
import { CREDIT, LANG_KEYS, type LangKey } from "@/lib/config";
import { backendStatus } from "@/lib/dub.functions";
import { DubPlayer } from "@/lib/player";
import { useLehja } from "@/lib/useLehja";
import { Hero } from "@/components/Hero";
import { Player } from "@/components/Player";
import { Cast, Progress } from "@/components/Progress";
import { Script } from "@/components/Script";
import { Button, cx } from "@/components/ui";

export const Route = createFileRoute("/")({
  loader: () => backendStatus(),
  component: Home,
});

function Home() {
  const live = Route.useLoaderData();
  const app = useLehja();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [playerLang, setPlayerLang] = useState<LangKey | null>(null);
  const [tab, setTab] = useState<LangKey>("hi");
  const player = useRef<DubPlayer | null>(null);
  if (!player.current && typeof window !== "undefined") {
    player.current = new DubPlayer(setActiveLineId);
    if (import.meta.env.DEV) (window as unknown as { __player: DubPlayer }).__player = player.current;
  }

  // Attach to the <video> whenever a new clip is loaded.
  useEffect(() => {
    if (videoRef.current) player.current?.attach(videoRef.current);
  }, [app.videoUrl]);
  useEffect(() => () => player.current?.destroy(), []);

  useEffect(() => player.current?.setLines(app.lines), [app.lines]);

  // Hand each language's clips to the player as soon as that language is ready.
  const readyKey = LANG_KEYS.map((k) => `${k}:${app.dubs[k].status}`).join(",");
  useEffect(() => {
    for (const k of LANG_KEYS) {
      const d = app.dubs[k];
      if (d.status === "ready") {
        player.current?.setClips(k, new Map(d.lines.filter((l) => l.audioUrl).map((l) => [l.lineId, { url: l.audioUrl!, rate: l.playbackRate ?? 1 }])));
      } else {
        player.current?.clearClips(k);
      }
    }
    // Auto-select the first language that becomes playable.
    if (!playerLang || app.dubs[playerLang].status !== "ready") {
      const first = LANG_KEYS.find((k) => app.dubs[k].status === "ready");
      if (first && first !== playerLang) {
        setPlayerLang(first);
        player.current?.setLanguage(first);
      }
    }
  }, [readyKey]);

  function pickLang(k: LangKey) {
    setPlayerLang(k);
    setTab(k);
    player.current?.setLanguage(k);
  }

  const pickFiles = (files: FileList | null) => files?.[0] && app.selectFile(files[0]);
  const status = live.mock ? { dot: "bg-warn", text: "Demo mode", tip: "LEHJA_MOCK=1 — dummy data, no API calls" } : live.missing.length ? { dot: "bg-bad", text: "Keys missing", tip: `Missing in app/.env.local: ${live.missing.join(", ")}` } : { dot: "bg-ok", text: "Live", tip: "ElevenLabs, Gemini and Sarvam keys loaded" };

  return (
    <div className="mx-auto flex min-h-screen max-w-[1320px] flex-col px-10">
      <header className="flex h-16 items-center gap-3">
        <span className="font-native grid size-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-[#e0532a] text-[17px] font-semibold text-black">ल</span>
        <span className="text-[17px] font-semibold tracking-tight">Lehja</span>
        <span className="font-native text-[15px] text-faint">लहजा</span>

        <div className="ml-auto flex items-center gap-3">
          <span
            title={status.tip}
            className="flex items-center gap-2 rounded-full border border-edge px-3 py-1 text-xs text-muted"
          >
            <span className={cx("size-1.5 rounded-full", status.dot)} />
            {status.text}
          </span>
          {app.file && (
            <>
              <span className="flex max-w-56 items-center gap-2 truncate text-sm text-muted">
                <Film className="size-4 shrink-0 text-faint" />
                <span className="truncate">{app.file.name}</span>
                <span className="text-faint">{app.duration.toFixed(1)}s</span>
              </span>
              <Button size="sm" onClick={() => fileInput.current?.click()} disabled={app.sceneBusy || LANG_KEYS.some((k) => app.dubs[k].status === "voicing")}>
                <Plus className="size-3.5" /> New clip
              </Button>
            </>
          )}
        </div>
      </header>

      {(live.mock || live.missing.length > 0) && (
        <div className={cx("mb-2 rounded-xl border px-4 py-2.5 text-sm", live.mock ? "border-warn/30 bg-warn/[0.06] text-warn" : "border-bad/30 bg-bad/[0.06] text-bad")}>
          {live.mock
            ? "Demo mode is on (LEHJA_MOCK=1): everything uses dummy data. Set LEHJA_MOCK=0 in app/.env.local and restart for real dubbing."
            : `Missing API keys: ${live.missing.join(", ")}. Add them to app/.env.local and restart the dev server.`}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={(e) => {
          pickFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <main className="flex-1 pb-16">
        {!app.file ? (
          <Hero onFiles={pickFiles} onBrowse={() => fileInput.current?.click()} error={app.uploadError} />
        ) : (
          <div className="fade-up pt-6">
            <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-8">
              <Player app={app} videoRef={videoRef} playerLang={playerLang} onPickLang={pickLang} activeLineId={activeLineId} />
              <aside className="sticky top-6 space-y-4">
                <Progress app={app} lang={tab} onLang={setTab} />
                <Cast app={app} />
              </aside>
            </div>
            <Script app={app} tab={tab} onTab={setTab} activeLineId={activeLineId} onPreview={(id, k) => player.current?.preview(id, k)} />
          </div>
        )}
      </main>

      <footer className="border-t border-edge py-6 text-center text-xs text-faint">{CREDIT}</footer>
    </div>
  );
}
