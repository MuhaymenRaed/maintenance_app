"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { ChevronLeft, Minus, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Full-screen image viewer with free zoom and pan.
 *
 * Built rather than borrowed: every library for this ships its own gesture
 * stack and focus trap, which is most of its weight, and none of them know
 * that this app is right-to-left — a viewer whose "next" arrow points the
 * wrong way in Arabic is worse than no arrows.
 *
 * The transform is held in a ref and written straight to `style`, not to
 * React state. A pointer move fires up to 120 times a second on a trackpad;
 * re-rendering the tree at that rate drops frames on exactly the mid-range
 * Android phones most of this shop's customers are using. React owns *which*
 * image is open and whether the chrome is visible; the browser owns the
 * pixels. `zoom` is mirrored into state only so the buttons can disable
 * themselves at the limits, and only when it crosses one.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const STEP = 0.5;

type Frame = { url: string; alt: string | null };

export function ImageLightbox({
  images,
  startIndex,
  onClose,
}: {
  images: Frame[];
  startIndex: number;
  onClose: () => void;
}) {
  const t = useTranslations("Product");
  const [index, setIndex] = useState(startIndex);
  /** Mirrors the ref only at the limits, so the controls can grey out. */
  const [zoomLabel, setZoomLabel] = useState(1);

  const stage = useRef<HTMLDivElement>(null);
  const view = useRef({ zoom: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });
  /** Distance between two fingers at the start of a pinch. */
  const pinch = useRef<number | null>(null);

  const paint = useCallback(() => {
    const node = stage.current;
    if (!node) return;
    const { zoom, x, y } = view.current;
    node.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`;
    node.style.cursor =
      zoom > 1 ? (drag.current.active ? "grabbing" : "grab") : "";
  }, []);

  /**
   * Clamps the pan so the picture cannot be flung off screen — at 1× it is
   * pinned dead centre, and beyond that it may travel by however much of it
   * overflows the viewport.
   */
  const clamp = useCallback(() => {
    const node = stage.current;
    if (!node) return;
    const { zoom } = view.current;
    if (zoom <= 1) {
      view.current.x = 0;
      view.current.y = 0;
      return;
    }
    const box = node.getBoundingClientRect();
    const slackX = Math.max(0, (box.width - node.clientWidth) / 2);
    const slackY = Math.max(0, (box.height - node.clientHeight) / 2);
    view.current.x = Math.min(slackX, Math.max(-slackX, view.current.x));
    view.current.y = Math.min(slackY, Math.max(-slackY, view.current.y));
  }, []);

  const setZoom = useCallback(
    (next: number, origin?: { x: number; y: number }) => {
      const node = stage.current;
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      const previous = view.current.zoom;
      if (clamped === previous) return;

      // Zoom towards the cursor rather than the centre, so the detail under
      // the pointer stays under the pointer.
      if (node && origin) {
        const box = node.getBoundingClientRect();
        const cx = origin.x - (box.left + box.width / 2);
        const cy = origin.y - (box.top + box.height / 2);
        const ratio = clamped / previous;
        view.current.x -= cx * (ratio - 1);
        view.current.y -= cy * (ratio - 1);
      }

      view.current.zoom = clamped;
      clamp();
      paint();
      setZoomLabel(clamped);
    },
    [clamp, paint],
  );

  const reset = useCallback(() => {
    view.current = { zoom: 1, x: 0, y: 0 };
    paint();
    setZoomLabel(1);
  }, [paint]);

  const go = useCallback(
    (delta: number) => {
      if (images.length < 2) return;
      setIndex((i) => (i + delta + images.length) % images.length);
      reset();
    },
    [images.length, reset],
  );

  // Keyboard, and the scroll lock. One effect because they share a lifetime.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "+" || event.key === "=")
        setZoom(view.current.zoom + STEP);
      else if (event.key === "-") setZoom(view.current.zoom - STEP);
      else if (event.key === "0") reset();
    };

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [go, onClose, reset, setZoom]);

  // `wheel` is bound here rather than as a JSX prop because React attaches
  // wheel listeners passively, and a passive listener may not call
  // `preventDefault()` — without which the page behind scrolls as you zoom.
  useEffect(() => {
    const node = stage.current?.parentElement;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom(view.current.zoom - Math.sign(event.deltaY) * STEP, {
        x: event.clientX,
        y: event.clientY,
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  const frame = images[index];
  if (!frame) return null;

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={frame.alt ?? t("gallery")}
      className="fixed inset-0 z-200 flex flex-col bg-scrim/95"
    >
      {/* Chrome */}
      <div className="flex shrink-0 items-center gap-2 p-3">
        <span
          className="rounded-chip bg-white/10 px-2.5 py-1 text-[0.72rem] font-extrabold text-white"
          data-numeric
        >
          {index + 1} / {images.length}
        </span>

        <div className="ms-auto flex items-center gap-1.5">
          <Control
            onClick={() => setZoom(view.current.zoom - STEP)}
            disabled={zoomLabel <= MIN_ZOOM}
            label={t("zoomOut")}
          >
            <Minus className="size-4" aria-hidden />
          </Control>
          <span
            className="min-w-12 text-center text-[0.72rem] font-extrabold text-white/80"
            data-numeric
          >
            {Math.round(zoomLabel * 100)}%
          </span>
          <Control
            onClick={() => setZoom(view.current.zoom + STEP)}
            disabled={zoomLabel >= MAX_ZOOM}
            label={t("zoomIn")}
          >
            <Plus className="size-4" aria-hidden />
          </Control>
          <Control
            onClick={reset}
            disabled={zoomLabel === 1}
            label={t("zoomReset")}
          >
            <RotateCcw className="size-4" aria-hidden />
          </Control>
          <Control onClick={onClose} label={t("close")}>
            <X className="size-4" aria-hidden />
          </Control>
        </div>
      </div>

      {/* Stage */}
      <div
        className="relative flex-1 touch-none overflow-hidden"
        onPointerDown={(event) => {
          if (event.isPrimary && view.current.zoom > 1) {
            drag.current = {
              x: event.clientX - view.current.x,
              y: event.clientY - view.current.y,
              active: true,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            paint();
          }
        }}
        onPointerMove={(event) => {
          if (!drag.current.active) return;
          view.current.x = event.clientX - drag.current.x;
          view.current.y = event.clientY - drag.current.y;
          clamp();
          paint();
        }}
        onPointerUp={() => {
          drag.current.active = false;
          pinch.current = null;
          paint();
        }}
        onPointerCancel={() => {
          drag.current.active = false;
          pinch.current = null;
        }}
        onDoubleClick={(event) =>
          view.current.zoom > 1
            ? reset()
            : setZoom(2.5, { x: event.clientX, y: event.clientY })
        }
        onTouchMove={(event) => {
          if (event.touches.length !== 2) return;
          const [a, b] = [event.touches[0], event.touches[1]];
          const distance = Math.hypot(
            a.clientX - b.clientX,
            a.clientY - b.clientY,
          );
          if (pinch.current !== null) {
            setZoom(view.current.zoom * (distance / pinch.current), {
              x: (a.clientX + b.clientX) / 2,
              y: (a.clientY + b.clientY) / 2,
            });
          }
          pinch.current = distance;
        }}
      >
        <div
          ref={stage}
          className="absolute inset-0 origin-center will-change-transform"
          style={{ transitionProperty: "none" }}
        >
          <Image
            key={frame.url}
            src={frame.url}
            alt={frame.alt ?? ""}
            fill
            sizes="100vw"
            className="select-none object-contain"
            draggable={false}
            priority
          />
        </div>

        {images.length > 1 && (
          <>
            <Arrow
              onClick={() => go(-1)}
              side="start"
              label={t("previousImage")}
            />
            <Arrow onClick={() => go(1)} side="end" label={t("nextImage")} />
          </>
        )}
      </div>

      {/* Filmstrip */}
      {images.length > 1 && (
        <div className="scrollbar-none flex shrink-0 justify-center gap-2 overflow-x-auto p-3">
          {images.map((image, i) => (
            <button
              key={image.url}
              type="button"
              onClick={() => {
                setIndex(i);
                reset();
              }}
              aria-label={`${i + 1}`}
              aria-current={i === index ? "true" : undefined}
              className={cn(
                "relative size-14 shrink-0 overflow-hidden rounded-card border-2 transition-opacity",
                i === index
                  ? "border-brand"
                  : "border-transparent opacity-55 hover:opacity-100",
              )}
            >
              <Image
                src={image.url}
                alt=""
                fill
                sizes="56px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}

function Control({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/**
 * `start`/`end` rather than left/right: under RTL the previous frame is to the
 * right, and an arrow that points away from where the image will come from is
 * a small lie the eye notices.
 */
function Arrow({
  onClick,
  side,
  label,
}: {
  onClick: () => void;
  side: "start" | "end";
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/25",
        side === "start" ? "start-3" : "end-3",
      )}
    >
      {/* The glyph flips with the writing direction, not just with the side it
          sits on: in Arabic the previous frame lies to the *right*, so the
          arrow on the start edge has to point right too. */}
      <ChevronLeft
        className={cn(
          "size-5",
          side === "start" ? "rtl:rotate-180" : "rotate-180 rtl:rotate-0",
        )}
        aria-hidden
      />
    </button>
  );
}
