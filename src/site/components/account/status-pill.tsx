import { statusTone, TONE_CHIP } from "@/lib/data/status-tone";
import { cn } from "@/lib/utils";

/**
 * One pill for every lifecycle in the app — order, repair and trade-in.
 *
 * The colour comes from `lib/data/status-tone.ts`, which is also what the
 * dashboard's breakdown bars read, so the two can never disagree about what
 * "shipped" looks like.
 */
export function StatusPill({
  status,
  label,
  className,
}: {
  status: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-chip px-2.5 py-1 text-[0.72rem] font-extrabold",
        TONE_CHIP[statusTone(status)],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
