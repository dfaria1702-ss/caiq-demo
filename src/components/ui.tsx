import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-2xl border border-edge bg-surface", className)}>{children}</section>;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-[11px] font-medium uppercase tracking-[0.14em] text-faint", className)}>{children}</p>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" | "lg" };

export function Button({ variant = "secondary", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-full font-medium transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-9 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-[15px]",
        variant === "primary" && "bg-accent text-black shadow-[0_0_0_1px_rgba(255,143,63,.4),0_8px_30px_-8px_rgba(255,143,63,.6)] hover:bg-accent-2",
        variant === "secondary" && "border border-edge-2 bg-surface-2 text-fg hover:border-faint hover:bg-edge",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-fg",
        className,
      )}
    />
  );
}

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cx("size-4 animate-spin", className)} />;

export function Chip({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span style={style} className={cx("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}

type SegOption<T> = { value: T; label: ReactNode; disabled?: boolean; adornment?: ReactNode; title?: string };

/** iOS-style segmented control. */
export function Segmented<T extends string>({ options, value, onChange, className }: { options: SegOption<T>[]; value: T | null; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx("inline-flex rounded-full border border-edge bg-bg/60 p-1", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              "font-native relative flex h-8 items-center gap-1.5 rounded-full px-4 text-[14px] transition-all",
              on ? "bg-surface-2 text-fg shadow-[0_1px_0_rgba(255,255,255,.06)_inset,0_0_0_1px_var(--color-edge-2)]" : "text-muted hover:text-fg",
              o.disabled && "cursor-not-allowed opacity-40 hover:text-muted",
            )}
          >
            {o.adornment}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};
