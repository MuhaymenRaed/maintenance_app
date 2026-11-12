"use client";

import { Phone } from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/social";
import { whatsappLink } from "@/lib/data/whatsapp";
import { cn } from "@/lib/utils";

/**
 * Reaching the person on the other end of a ticket.
 *
 * Every queue in the back office — orders, repairs, buy-backs, the customer
 * list — ends the same way: someone has to ring the customer. Until now that
 * meant reading a number off the screen and typing it into a phone, which is
 * how a digit gets transposed and a stranger is told their repair is ready.
 *
 * ---------------------------------------------------------------------------
 * Why WhatsApp specifically
 * ---------------------------------------------------------------------------
 * It is how this shop's customers actually answer. A call from an unknown
 * number is ignored in Iraq far more often than a message is, and a message
 * leaves the quote, the ticket code and the price in writing where both sides
 * can re-read it.
 *
 * The text is **pre-filled, never sent**. WhatsApp opens the chat with the
 * message sitting in the compose box, so whoever pressed the button still reads
 * it and decides — which is the right way round for a message about someone's
 * money.
 *
 * The button is **absent** when the stored number cannot be dialled, rather
 * than present and broken. `whatsappNumber` returns null for a placeholder like
 * `07XXXXXXXXX`, and a link built from one opens WhatsApp's "phone number
 * shared via url is invalid" page, which staff read as the feature being broken
 * rather than as the record being incomplete.
 */

export function WhatsAppButton({
  phone,
  message,
  label,
  variant = "solid",
  className,
}: {
  phone: string | null | undefined;
  /** Already localised by the caller — this component holds no copy. */
  message: string;
  label: string;
  variant?: "solid" | "quiet" | "icon";
  className?: string;
}) {
  const href = whatsappLink(phone, message);
  if (!href) return null;

  if (variant === "icon") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        title={label}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border border-success/35 text-success transition-colors hover:bg-success/10",
          className,
        )}
      >
        <WhatsAppIcon className="size-3.5" />
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-control px-3.5 py-2.5 text-[0.78rem] font-extrabold transition-colors",
        variant === "solid"
          ? "bg-success text-white hover:opacity-90"
          : "border border-success/35 text-success hover:bg-success/10",
        className,
      )}
    >
      <WhatsAppIcon className="size-3.5" />
      {label}
    </a>
  );
}

/**
 * A phone number that can be pressed.
 *
 * `data-numeric` and `dir="ltr"` are not decoration: without them Arabic bidi
 * reorders a number that sits inside an Arabic line, and a reordered phone
 * number is a wrong phone number.
 */
export function PhoneLink({
  phone,
  tone = "ink",
  className,
}: {
  phone: string | null | undefined;
  tone?: "ink" | "muted";
  className?: string;
}) {
  if (!phone) return null;
  return (
    <a
      href={`tel:${phone.replace(/\s/g, "")}`}
      dir="ltr"
      data-numeric
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "font-bold transition-colors hover:text-brand",
        tone === "muted" ? "text-muted" : "text-ink",
        className,
      )}
    >
      {phone}
    </a>
  );
}

/**
 * The block that ends every ticket dialog: who they are, both numbers, and the
 * two ways to reach them.
 */
export function ContactPanel({
  name,
  phone,
  phone2,
  whatsappMessage,
  whatsappLabel,
  callLabel,
  children,
}: {
  name: string;
  phone: string;
  phone2?: string | null;
  whatsappMessage: string;
  whatsappLabel: string;
  callLabel: string;
  /** Address, branch, payment — whatever else this ticket knows. */
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-card border border-line bg-canvas p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.92rem] font-extrabold text-ink">{name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem]">
            <span className="inline-flex items-center gap-1.5">
              <Phone className="size-3.5 shrink-0 text-brand" aria-hidden />
              <PhoneLink phone={phone} />
            </span>
            {phone2 && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5 shrink-0 text-muted" aria-hidden />
                <PhoneLink phone={phone2} tone="muted" />
              </span>
            )}
          </p>
        </div>
      </div>

      {children}

      <div className="flex flex-wrap gap-2 border-t border-line/70 pt-3">
        <WhatsAppButton
          phone={phone}
          message={whatsappMessage}
          label={whatsappLabel}
          className="flex-1"
        />
        <a
          href={`tel:${phone.replace(/\s/g, "")}`}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-control border border-line px-3.5 py-2.5 text-[0.78rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand"
        >
          <Phone className="size-3.5" aria-hidden />
          {callLabel}
        </a>
      </div>
    </div>
  );
}
