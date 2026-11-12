import type { CSSProperties, ImgHTMLAttributes } from "react";

/**
 * `next/image`, as a plain `<img>`.
 *
 * The dashboard's components draw photographs with it — a ticket's before and
 * after shots, the papers' logo and QR, the lightbox. Everything Next's
 * component buys depends on a server: a loader that rewrites the URL to a
 * resized copy, a `srcset` built from `deviceSizes`, the blur placeholder. None
 * of that exists here. A repair photo taken at the counter is on this disk
 * (`desk-photo://`) and is drawn at the size the browser decides; one already
 * uploaded is an absolute R2 URL the site's own loader would pass through
 * unchanged anyway.
 *
 * ⚠️ `fill` is the one prop with real layout meaning and must keep it. Every
 * caller wraps it in a `relative` box of a fixed size and lets the image fill
 * it — drop the absolute positioning and a 44px thumbnail becomes a
 * full-width photograph that pushes the row it sits in off the screen.
 *
 * `sizes`, `quality`, `placeholder` and the rest are accepted and dropped: a
 * component copied from the site must not have to know it is not on the site.
 */
type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> & {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  /** Fills the nearest positioned ancestor, as Next's own does. */
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  quality?: number;
  unoptimized?: boolean;
  placeholder?: string;
  blurDataURL?: string;
};

export default function Image({
  fill,
  sizes: _sizes,
  priority,
  quality: _quality,
  unoptimized: _unoptimized,
  placeholder: _placeholder,
  blurDataURL: _blurDataURL,
  style,
  loading,
  ...rest
}: ImageProps) {
  const box: CSSProperties | undefined = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style }
    : style;
  return (
    <img
      {...rest}
      style={box}
      loading={priority ? "eager" : loading}
      decoding={priority ? "sync" : "async"}
    />
  );
}
