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

/** A copy of the element with every computed style inline, and its families. */
function inlineCopy(source: Element, families: Set<string>, pictures: [HTMLImageElement, HTMLImageElement][]): Element {
  const copy = source.cloneNode(false) as Element;
  const style = getComputedStyle(source);
  let inline = "";
  for (let i = 0; i < style.length; i += 1) {
    const property = style[i];
    inline += `${property}:${style.getPropertyValue(property)};`;
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

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

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
