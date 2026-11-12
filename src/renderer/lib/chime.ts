/**
 * The desk's chime — two soft notes, synthesised, no sound file.
 *
 * Played when news arrives while the window is in front (a new ticket, a
 * refusal); when it is not, Windows' own notification carries the sound
 * (`src/main/notify.ts`). The same idea as the dashboard's
 * `lib/sound/chime.ts`: a sine pair with a quick attack and a long tail, quiet
 * enough to live beside a till.
 *
 * ⚠️ An `AudioContext` made before any press is created suspended by
 * Chromium's autoplay rule, and a desk opened at seven in the morning and left
 * running has had no press yet when the first booking arrives. `resume()` is
 * tried on every chime; Electron does not gate it, a browser might, and a
 * refused resume costs one silent notice rather than an error.
 */
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

function note(ctx: AudioContext, frequency: number, start: number, length: number, gain: number) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(gain, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(env).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

export function chime(kind: "news" | "problem" = "news") {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;
  if (kind === "problem") {
    // Falling: something needs a look.
    note(ctx, 740, now, 0.35, 0.09);
    note(ctx, 554, now + 0.16, 0.5, 0.08);
    return;
  }
  // Rising: something arrived.
  note(ctx, 880, now, 0.4, 0.08);
  note(ctx, 1318.5, now + 0.13, 0.6, 0.06);
}
