/**
 * A rendered paper, drawn onto a canvas at printer resolution.
 *
 * ---------------------------------------------------------------------------
 * Why the browser draws it, and how
 * ---------------------------------------------------------------------------
 * The receipt and the label are React components the dialog path already
 * prints, and they must look the same whichever way they reach paper. Neither
 * printer can shape Arabic — the Canon's driver would, from a PDF, but there
 * is no PDF here, and the LPQ58's own fonts have no Arabic at all — so the
 * browser that already shaped the text on screen draws it, and the printers
 * are sent pictures.
 *
 * The mechanism is an SVG `<foreignObject>`: the paper's DOM is copied with
 * every computed style written inline, its pictures and the page's fonts are
 * embedded as data URLs (an SVG drawn as an image may load nothing from
 * outside itself), and the browser lays the copy out again inside the image
 * and draws it onto a canvas. Same engine, same fonts, same layout — the
 * shaping is the browser's, not a re-implementation of it.
 *
 * ⚠️ **Every font and picture is embedded, or it is simply absent.** An SVG
 * used as an image is sandboxed: a `url()` it cannot resolve renders as
 * nothing, silently, and text falls back to a system face. So the font CSS is
 * rebuilt with the font files inlined, and every `<img>` gets a data URL in
 * place of its `src` — `srcset` is removed, or the image would pick a
 * candidate it cannot load.
 *
 * ⚠️ **Fixed colours on the papers are what keep this theme-proof.** The
 * computed style of a paper drawn on a dark dashboard is still black on white
 * because the sheets set their colours explicitly — the rule
 * `components/admin/repair-print.tsx` already states for printing.
 *
 * ⚠️ **"Same layout" is true only because sizes are NOT copied as measured.**
 * The copy is laid out a second time, inside the image, by a document at
 * scale 1 — while the live page was laid out at the screen's own scale (125%
 * on a laptop, 110% on another, a browser zoom on a third). Glyph advances
 * are rounded per scale, so the same words can measure a fraction of a pixel
 * narrower live than inside the image. See {@link LAYOUT_PROPERTIES}.
 */

const fontCache = new Map<string, Promise<string>>();
const fontFileCache = new Map<string, Promise<string>>();
const imageCache = new Map<string, Promise<string>>();

async function toDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`could not load ${url} (${response.status})`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`could not read ${url}`));
    reader.readAsDataURL(blob);
  });
}

const cachedDataUrl = (cache: Map<string, Promise<string>>, url: string) => {
  let entry = cache.get(url);
  if (!entry) {
    entry = toDataUrl(url);
    entry.catch(() => cache.delete(url));
    cache.set(url, entry);
  }
  return entry;
};

const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, "").toLowerCase();

function fontFaceRules(sheets: StyleSheetList): CSSFontFaceRule[] {
  const found: CSSFontFaceRule[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) found.push(rule);
      else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) walk((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of Array.from(sheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      // A cross-origin stylesheet cannot be read; nothing on a paper uses one.
    }
  }
  return found;
}

/** The @font-face rules for these families, with every font file inlined. */
async function embeddedFonts(families: Set<string>): Promise<string> {
  const key = [...families].sort().join("|");
  let entry = fontCache.get(key);
  if (!entry) {
    entry = (async () => {
      const css: string[] = [];
      for (const rule of fontFaceRules(document.styleSheets)) {
        if (!families.has(unquote(rule.style.getPropertyValue("font-family")))) continue;
        const base = rule.parentStyleSheet?.href ?? location.href;
        let text = rule.cssText;
        const urls = [...text.matchAll(/url\((["']?)([^"')]+)\1\)/g)].map((match) => match[2]);
        for (const url of urls) {
          if (url.startsWith("data:")) continue;
          const data = await cachedDataUrl(fontFileCache, new URL(url, base).href);
          text = text.split(url).join(data);
        }
        css.push(text);
      }
      return css.join("\n");
    })();
    entry.catch(() => fontCache.delete(key));
    fontCache.set(key, entry);
  }
  return entry;
}

/**
 * The properties copied as the stylesheet asked for them, never as measured.
 *
 * ⚠️ **This is the fix for the receipt whose notes printed over each other**
 * (2026-11-16, reported from the shop's counter with a photograph).
 * `getComputedStyle` returns *resolved* values, and for these properties the
 * resolved value is the box this page happened to lay out: an auto-width note
 * comes back as `width: 313.969px` — exactly its own text, to the pixel — a
 * three-row grid as three frozen row heights, `mt-auto` as `88.3125px`.
 * Copied like that, every text box in the picture is the width its words
 * measured *on the live page*, and the picture lays the words out again at
 * scale 1, where the same words can come out a hair wider. A hair is enough:
 * the last word no longer fits, wraps to a second line, and the height —
 * frozen at one line — lets that line paint straight over the next note.
 * Measured with a real Edge window forced to 80%, 110% and 125%: every note
 * on the receipt and «عزيزي الزبون» did exactly that, word for word the
 * shop's photograph; at 90% the notes held and the money labels and the
 * phone number broke instead. Only at 100% and 150% did the two layouts
 * happen to agree, and headless Edge ignores the scale for text altogether —
 * which is why no test render had ever shown it.
 *
 * Copied as computed instead (`auto`, `repeat(3, auto)`, `auto`), the picture
 * sizes its boxes to its own text, so a measuring difference between the two
 * layouts can no longer turn into a collision; at worst a line wraps and the
 * box grows with it.
 *
 * ⚠️ **All of these or none of them.** The insets are in the list because an
 * absolutely placed box whose `right` came back as a measured length would
 * now be stretched by it once its width is `auto`; the logical twins are in
 * it because `getComputedStyle` lists them too and whichever is written later
 * wins.
 */
const LAYOUT_PROPERTIES = new Set([
  "width",
  "height",
  "inline-size",
  "block-size",
  "min-width",
  "min-height",
  "min-inline-size",
  "min-block-size",
  "max-width",
  "max-height",
  "max-inline-size",
  "max-block-size",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block-start",
  "margin-block-end",
  "margin-inline-start",
  "margin-inline-end",
  "top",
  "right",
  "bottom",
  "left",
  "inset-block-start",
  "inset-block-end",
  "inset-inline-start",
  "inset-inline-end",
  "grid-template-rows",
  "grid-template-columns",
  "transform-origin",
  "perspective-origin",
]);

/**
 * The computed — not resolved — value of each layout property, or `null` where
 * the measured value is the right one to keep.
 *
 * ⚠️ **Pictures and SVG keep their measured sizes.** Neither has text that can
 * measure differently, an `<img>` whose data URL decodes a moment after layout
 * would be laid out at no height at all if its size were left to the picture,
 * and an SVG shape's `width` is its own geometry.
 *
 * Without CSS Typed OM (Firefox) every value is the measured one, as it always
 * was. The counter runs Chrome, Edge and the Electron desk app, all of which
 * have it.
 */
function declaredLayout(source: Element): ((property: string) => string | null) | null {
  if (!(source instanceof HTMLElement) || source instanceof HTMLImageElement) return null;
  if (typeof source.computedStyleMap !== "function") return null;
  const map = source.computedStyleMap();
  return (property) => {
    try {
      const value = map.get(property);
      return value == null ? null : String(value);
    } catch {
      return null;
    }
  };
}

/** A copy of the element with every computed style inline, and its families. */
function inlineCopy(source: Element, families: Set<string>, pictures: [HTMLImageElement, HTMLImageElement][]): Element {
  const copy = source.cloneNode(false) as Element;
  const style = getComputedStyle(source);
  const declared = declaredLayout(source);
  let inline = "";
  for (let i = 0; i < style.length; i += 1) {
    const property = style[i];
    const value = (declared && LAYOUT_PROPERTIES.has(property) && declared(property)) || style.getPropertyValue(property);
    inline += `${property}:${value};`;
  }
  /*
   * ⚠️ A clamp has to be restated, or the picture stops clamping. Chromium
   * reports `display: -webkit-box` under `-webkit-line-clamp` as
   * `flow-root`, and a flow-root ignores the clamp — which was invisible
   * while heights were copied as measured, because the measured height did
   * the clamping. With heights left to the picture, a fault list long enough
   * to need the clamp would otherwise run to seven lines and push the terms
   * and the foot off the paper.
   */
  if (declared && style.getPropertyValue("-webkit-line-clamp") !== "none") {
    inline += "display:-webkit-box;-webkit-box-orient:vertical;";
  }
  copy.setAttribute("style", inline);
  copy.removeAttribute("class");
  for (const family of style.fontFamily.split(",")) families.add(unquote(family));

  if (source instanceof HTMLImageElement) {
    pictures.push([source, copy as HTMLImageElement]);
    for (const attribute of ["srcset", "sizes", "loading", "decoding", "fetchpriority"]) {
      copy.removeAttribute(attribute);
    }
  }

  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      copy.appendChild(inlineCopy(child as Element, families, pictures));
    } else if (child.nodeType === Node.TEXT_NODE) {
      copy.appendChild(child.cloneNode());
    }
  }
  return copy;
}

/**
 * One painted frame — or, on a page the browser has stopped painting, the same
 * pause by the clock.
 *
 * ⚠️ A hidden page runs no animation frames at all. The papers are drawn in the
 * dashboard's own document, and a ticket's detached window can ask for a print
 * while that dashboard is minimised (`lib/windows/detached.ts`): a frame alone
 * waited for ever, and the run failed thirty seconds later as "drawing the
 * paper timed out" with nothing printed. On a visible page the frame comes
 * first and nothing changes; on a hidden one the browser runs the timer, at
 * worst a second late.
 */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    window.setTimeout(finish, 50);
  });

export type RasterTarget = {
  /** The paper's size — the canvas is this, the element is drawn inside it. */
  widthMm: number;
  heightMm: number;
  /** Pixels per millimetre: 8 for the label printer, 300 dpi for A5. */
  pxPerMm: number;
  /** Where the element's top-left corner lands on the paper. */
  offsetMm?: { x: number; y: number };
};

/** CSS pixels per millimetre — the browser's own conversion, 96 dpi. */
export const CSS_PX_PER_MM = 96 / 25.4;

export async function rasterizeElement(element: HTMLElement, target: RasterTarget): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  const pictures: [HTMLImageElement, HTMLImageElement][] = [];
  const families = new Set<string>();
  const copy = inlineCopy(element, families, pictures) as HTMLElement;
  // The paper's own outer margin centres it on screen; on the canvas the
  // offset does that job, and both together would place it twice.
  copy.style.margin = "0";

  await Promise.all(
    pictures.map(async ([original, clone]) => {
      const url = original.currentSrc || original.src;
      if (!url) return;
      clone.setAttribute("src", url.startsWith("data:") ? url : await cachedDataUrl(imageCache, url));
    }),
  );
  const fonts = await embeddedFonts(families);

  const rect = element.getBoundingClientRect();
  const cssWidth = Math.ceil(rect.width);
  const cssHeight = Math.ceil(rect.height);
  const scale = target.pxPerMm / CSS_PX_PER_MM;

  const markup = new XMLSerializer().serializeToString(copy);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(cssWidth * scale)}" height="${Math.ceil(cssHeight * scale)}" viewBox="0 0 ${cssWidth} ${cssHeight}">` +
    `<foreignObject x="0" y="0" width="${cssWidth}" height="${cssHeight}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;width:${cssWidth}px;height:${cssHeight}px;">` +
    `<style>${fonts}</style>${markup}</div></foreignObject></svg>`;

  const image = new Image();
  image.decoding = "sync";
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  // A data-URL font inside an SVG image can finish loading a frame after the
  // image reports decoded; drawing on the next frame lets it.
  await nextFrame();
  await nextFrame();

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(target.widthMm * target.pxPerMm);
  canvas.height = Math.round(target.heightMm * target.pxPerMm);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw to a canvas");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    Math.round((target.offsetMm?.x ?? 0) * target.pxPerMm),
    Math.round((target.offsetMm?.y ?? 0) * target.pxPerMm),
    Math.ceil(cssWidth * scale),
    Math.ceil(cssHeight * scale),
  );
  return canvas;
}

/** A canvas as base64 PNG, without the data-URL prefix the agent does not want. */
export async function canvasToPngBase64(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The paper could not be encoded as PNG");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return bytesToBase64(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
