import { Link } from "@/i18n/navigation";
import { LinkPendingTab } from "@/components/ui/link-pending";
import { cn } from "@/lib/utils";

/**
 * Filters as links, not buttons.
 *
 * The active filter lives in the URL exactly as it does on the catalogue, so a
 * filtered admin view is shareable, survives a refresh, and needs no client
 * JavaScript to render.
 *
 * `param` because not every list filters on the same thing — orders filter by
 * status, the catalogue by category — and `keep` because a filter must not
 * silently discard the search term sitting beside it.
 */
export function FilterChips({
  basePath,
  active,
  options,
  param = "status",
  keep = {},
}: {
  basePath: string;
  active: string | null;
  /** `count` is optional: a category list would just be repeating the total. */
  options: { value: string | null; label: string; count?: number }[];
  param?: string;
  keep?: Record<string, string>;
}) {
  const href = (value: string | null) => {
    const params = new URLSearchParams(keep);
    if (value) params.set(param, value);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <ul className="scrollbar-none flex gap-2 overflow-x-auto pb-0.5">
      {options.map((option) => {
        const on = option.value === active;
        return (
          <li key={option.value ?? "__default"} className="shrink-0">
            <Link
              href={href(option.value)}
              aria-current={on ? "true" : undefined}
              className={cn(
                // `relative` + `overflow-hidden` are what the in-chip indicator
                // needs to sit inside the chip's own rounded edge.
                "relative inline-flex items-center gap-2 overflow-hidden rounded-chip border px-3.5 py-1.5 text-[0.8rem] font-bold transition-colors",
                on
                  ? "border-brand bg-brand/8 text-brand"
                  : "border-line text-muted hover:border-muted hover:text-ink",
              )}
            >
              {option.label}
              {option.count !== undefined && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[0.7rem] font-extrabold",
                    on ? "bg-brand text-white" : "bg-subtle text-muted",
                  )}
                  data-numeric
                >
                  {option.count}
                </span>
              )}

              {/*
                ⚠️ Every one of these is a real navigation, and they are the
                slowest presses in the back office: the chip changes a URL
                param, which re-runs the board's query and its counts. Nothing
                else on the row moves in the meantime, so without this the
                press looks like it missed — which is exactly how somebody ends
                up pressing "Delivered" three times.

                A `"use client"` component inside a Server Component's `<Link>`,
                which is legal and is why this file does not need the directive
                itself. It only reports while the navigation is blocked, so a
                warm prefetch never draws it.
              */}
              <LinkPendingTab onBrand={false} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
