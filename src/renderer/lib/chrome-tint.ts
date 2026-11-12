/**
 * Windows' caption buttons, kept the same shade as the title bar under them.
 *
 * ---------------------------------------------------------------------------
 * Why the page has to do this
 * ---------------------------------------------------------------------------
 * Minimise, maximise and close are drawn by Windows over the window's top
 * corner (`titleBarOverlay`), above every pixel the page paints. So when the
 * page dims itself — a scrim behind a confirm dialog, the photo viewer — the
 * title bar dims and that corner does not: a bright white box in a darkened
 * window. That is what was reported, from a screenshot, as "weird fading".
 *
 * The ordinary dialogs never cause it: their scrim is at 60 on the dashboard's
 * stacking scale and the title bar at 70 (`globals.css`), so the bar stays
 * bright above them, exactly as the site's header does. This is for the layers
 * placed *above* the bar on purpose — the confirm dialog's own scrim (85), the
 * lightbox (200) — and for anything added later that takes a rung above 70.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ Why it does not hit-test
 * ---------------------------------------------------------------------------
 * `elementsFromPoint` was the obvious tool and it cannot see the answer. A
 * Radix modal puts `pointer-events: none` on `<body>`, which the title bar
 * inherits, so a hit test under an open dialog never returns the bar at all.
 * Instead every `fixed` element over the caption corner with a `z-index`
 * above the bar's is composited over the bar's own colour, bottom first —
 * each one's background alpha times its opacity, ancestors' included, so the
 * shade follows a scrim's fade-in frame by frame rather than jumping.
 */

const SYMBOL = { light: [0x33, 0x33, 0x33], dark: [0xed, 0xed, 0xed] } as const;

type Rgb = [number, number, number];

let context: CanvasRenderingContext2D | null = null;
const parsed = new Map<string, [number, number, number, number]>();

/**
 * Any CSS colour as sRGB and alpha — `rgb()`, `oklab()`, `color-mix()`, a
 * custom property already resolved by `getComputedStyle`. Tailwind's `bg-x/55`
 * computes to an `oklab(… / 0.55)`, which no regex here should have to parse;
 * a 1×1 canvas converts whatever the engine produced.
 */
function rgba(css: string): [number, number, number, number] {
  const hit = parsed.get(css);
  if (hit) return hit;
  context ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context) return [0, 0, 0, 0];
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = "rgba(0, 0, 0, 0)";
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  const value: [number, number, number, number] = [r, g, b, a / 255];
  parsed.set(css, value);
  return value;
}

function opacityOf(element: Element): number {
  let total = 1;
  for (let node: Element | null = element; node && node !== document.documentElement; node = node.parentElement) {
    total *= Number(getComputedStyle(node).opacity) || 0;
    if (total === 0) break;
  }
  return total;
}

const mix = (under: Rgb, over: Rgb, alpha: number): Rgb =>
  [0, 1, 2].map((i) => under[i] + (over[i] - under[i]) * alpha) as Rgb;

const hex = (rgb: Rgb) =>
  `#${rgb.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0")).join("")}`;

/** What is over the caption corner, as the shades to paint it — or null when nothing is. */
function measure(dark: boolean): { color: string; symbol: string } | null {
  const bar = document.querySelector<HTMLElement>(".desk-titlebar");
  if (!bar) return null;
  const barZ = Number.parseInt(getComputedStyle(bar).zIndex, 10) || 0;
  // Just past the strip Windows reports as free — i.e. under the buttons
  // themselves. ⚠️ Not "the window's width minus a bit": `scrollbar-gutter:
  // stable` keeps a strip down the right edge that no `inset-0` layer reaches,
  // and `clientWidth` stops counting that strip while a dialog locks the page,
  // so a point measured from it landed 2px outside the scrim it was looking for.
  const area = (navigator as Navigator & { windowControlsOverlay?: { getTitlebarAreaRect(): DOMRect } })
    .windowControlsOverlay?.getTitlebarAreaRect();
  const x = area && area.width > 0 ? area.right + 8 : bar.getBoundingClientRect().right - 8;
  const y = 12;

  const layers: { z: number; element: HTMLElement }[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(".fixed")) {
    if (bar.contains(element)) continue;
    const style = getComputedStyle(element);
    if (style.position !== "fixed" || style.display === "none" || style.visibility === "hidden") continue;
    const z = Number.parseInt(style.zIndex, 10) || 0;
    if (z <= barZ) continue;
    const rect = element.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
    layers.push({ z, element });
  }
  if (!layers.length) return null;
  layers.sort((a, b) => a.z - b.z);

  const [r, g, b] = rgba(getComputedStyle(bar).backgroundColor);
  let color: Rgb = [r, g, b];
  let symbol: Rgb = [...(dark ? SYMBOL.dark : SYMBOL.light)];
  let touched = false;
  for (const { element } of layers) {
    const [lr, lg, lb, la] = rgba(getComputedStyle(element).backgroundColor);
    const alpha = la * opacityOf(element);
    if (alpha <= 0.004) continue;
    color = mix(color, [lr, lg, lb], alpha);
    symbol = mix(symbol, [lr, lg, lb], alpha);
    touched = true;
  }
  return touched ? { color: hex(color), symbol: hex(symbol) } : null;
}

let dark = false;
let sent = "";
let frame = 0;
let until = 0;

function send() {
  const tint = measure(dark);
  const key = `${dark}|${tint?.color ?? ""}|${tint?.symbol ?? ""}`;
  if (key === sent) return;
  sent = key;
  window.desk.window.setChrome({ dark, tint });
  // What was last sent, readable from DevTools — the buttons themselves are
  // Windows' and appear in no screenshot the page can take of itself.
  document.documentElement.dataset.captionTint = tint ? `${tint.color} ${tint.symbol}` : "";
}

/**
 * Re-measures every frame for a short while. A scrim fades in over ~150ms and
 * out again on close; following it frame by frame is what makes the corner
 * dim *with* the page instead of snapping a moment before or after it.
 */
function burst(ms = 420) {
  until = Math.max(until, performance.now() + ms);
  send();
  // ⚠️ A timer as well as the frames. Chromium stops frame callbacks — and CSS
  // animations — in a window nobody can see, so a desk behind another window
  // would otherwise never take its last reading. Timers still run there, if
  // slowly; `animationend` and coming back into view (below) cover the rest.
  setTimeout(send, ms + 30);
  if (frame) return;
  const step = () => {
    send();
    frame = performance.now() < until ? requestAnimationFrame(step) : 0;
  };
  frame = requestAnimationFrame(step);
}

/** Called by `applyAppearance` whenever the theme is (re)applied. */
export function setChromeTheme(nextDark: boolean) {
  dark = nextDark;
  sent = "";
  send();
  burst();
}

/** Installed once, by `main.tsx`: anything mounted into or locking `<body>` re-measures. */
export function startChromeTint(): () => void {
  const observer = new MutationObserver(() => burst());
  observer.observe(document.body, {
    childList: true,
    attributes: true,
    attributeFilter: ["data-scroll-locked", "style", "class"],
  });
  const onResize = () => burst(120);
  // A scrim's fade ending is exactly when its final shade is known.
  const onAnimationEnd = () => send();
  // Shown again after being hidden or covered: whatever opened meanwhile has
  // only now actually been drawn.
  const onShown = () => {
    if (document.visibilityState === "visible") burst();
  };
  window.addEventListener("resize", onResize);
  document.addEventListener("animationend", onAnimationEnd, true);
  document.addEventListener("transitionend", onAnimationEnd, true);
  document.addEventListener("visibilitychange", onShown);
  window.addEventListener("focus", onShown);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", onResize);
    document.removeEventListener("animationend", onAnimationEnd, true);
    document.removeEventListener("transitionend", onAnimationEnd, true);
    document.removeEventListener("visibilitychange", onShown);
    window.removeEventListener("focus", onShown);
    if (frame) cancelAnimationFrame(frame);
  };
}
