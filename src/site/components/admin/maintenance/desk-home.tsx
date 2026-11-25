"use client";

import { useRef, type CSSProperties, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { MARK_DOT, MARK_PATH, MARK_VIEWBOX } from "@/lib/brand/mark";

/**
 * What the maintenance section opens on (the shop, 2026-11-24): the company's
 * mark alone on a clean ground, with the six tabs above it. Nothing to read
 * and nothing to decide until a tab is pressed.
 *
 * The mark answers the pointer: it leans towards it and its light follows,
 * and a press sends a ring out from the red dot. Both are written straight to
 * the element — a pointer moves sixty times a second, and re-rendering the
 * page for each would be the expensive way to tilt one picture. Neither moves
 * at all for a reader who asked for less motion.
 */
export function DeskHome({ deskName, onPick }: { deskName: string; onPick?: () => void }) {
  const t = useTranslations("Admin");
  const brand = useTranslations("Brand");
  const stage = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLSpanElement>(null);

  const still = () =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function lean(event: PointerEvent<HTMLDivElement>) {
    const element = stage.current;
    if (!element || still()) return;
    const box = element.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    element.style.setProperty("--tilt-x", `${(-y * 14).toFixed(2)}deg`);
    element.style.setProperty("--tilt-y", `${(x * 14).toFixed(2)}deg`);
    element.style.setProperty("--glow-x", `${((x + 0.5) * 100).toFixed(1)}%`);
    element.style.setProperty("--glow-y", `${((y + 0.5) * 100).toFixed(1)}%`);
  }

  function rest() {
    const element = stage.current;
    if (!element) return;
    element.style.setProperty("--tilt-x", "0deg");
    element.style.setProperty("--tilt-y", "0deg");
  }

  function pulse() {
    onPick?.();
    const element = ring.current;
    if (!element || still() || typeof element.animate !== "function") return;
    element.animate(
      [
        { transform: "translate(-50%, -50%) scale(0.2)", opacity: 0.55 },
        { transform: "translate(-50%, -50%) scale(2.6)", opacity: 0 },
      ],
      { duration: 700, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
    stage.current?.animate(
      [{ scale: "1" }, { scale: "0.94" }, { scale: "1" }],
      { duration: 340, easing: "cubic-bezier(0.3, 0.7, 0.3, 1)" },
    );
  }

  // Where the red dot sits, as a share of the mark — the ring starts there.
  const [, , width, height] = MARK_VIEWBOX.split(" ").map(Number);
  const dotX = `${((MARK_DOT.cx / width) * 100).toFixed(2)}%`;
  const dotY = `${((MARK_DOT.cy / height) * 100).toFixed(2)}%`;

  return (
    <section
      aria-label={deskName}
      className="relative isolate flex min-h-[max(26rem,calc(100dvh-16rem))] flex-col items-center justify-center overflow-hidden rounded-panel border border-line bg-surface px-6 py-14 shadow-card"
    >
      {/* A clean ground with the faintest wash of the brand, so the mark has
          somewhere to stand. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_55%_at_50%_42%,color-mix(in_srgb,var(--brand)_7%,transparent),transparent_70%)]"
      />
      <div
        ref={stage}
        role="button"
        tabIndex={0}
        aria-label={brand("name")}
        onPointerMove={lean}
        onPointerLeave={rest}
        onClick={pulse}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            pulse();
          }
        }}
        style={
          {
            "--tilt-x": "0deg",
            "--tilt-y": "0deg",
            "--glow-x": "50%",
            "--glow-y": "40%",
            transform: "perspective(700px) rotateX(var(--tilt-x)) rotateY(var(--tilt-y))",
          } as CSSProperties
        }
        className="group relative size-44 cursor-pointer rounded-[2.2rem] outline-none transition-transform duration-300 ease-out focus-visible:ring-4 focus-visible:ring-brand/25 sm:size-52 motion-reduce:transition-none"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-6 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{
            background:
              "radial-gradient(circle at var(--glow-x) var(--glow-y), color-mix(in srgb, var(--brand) 26%, transparent), transparent 62%)",
          }}
        />
        <svg viewBox={MARK_VIEWBOX} className="relative size-full drop-shadow-[0_14px_22px_rgb(0_0_0/0.16)]" aria-hidden>
          <path d={MARK_PATH} fillRule="evenodd" fill="var(--mark-ink)" />
          <circle
            cx={MARK_DOT.cx}
            cy={MARK_DOT.cy}
            r={MARK_DOT.r}
            fill="var(--mark-red)"
            className="origin-center transition-transform duration-500 [transform-box:fill-box] group-hover:scale-110 motion-reduce:transition-none"
          />
        </svg>
        <span
          ref={ring}
          aria-hidden
          className="pointer-events-none absolute size-16 rounded-full border-4 border-brand opacity-0"
          style={{ left: dotX, top: dotY, transform: "translate(-50%, -50%)" }}
        />
      </div>

      <div className="mt-9 text-center">
        <p className="text-[1.5rem] font-black leading-tight text-ink">{brand("name")}</p>
        <p className="mt-1 text-[0.95rem] font-extrabold text-brand">{deskName}</p>
        <p className="mt-4 text-[0.8rem] font-semibold text-muted">{t("deskHomeHint")}</p>
      </div>
    </section>
  );
}
