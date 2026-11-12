#!/usr/bin/env node
/**
 * The app's icons, from the shop's own launcher icon.
 *
 * `public/icon-512.png` on the site is the mark the installed web app already
 * wears — the white diamond with its red dot on the identity's `#333333` — so
 * the desk on the taskbar is the same object as the dashboard on a phone's
 * home screen. Nothing is drawn here; this only resizes.
 *
 *   resources/icon.png   512px — the window, the tray, Windows notifications
 *   resources/icon.ico   16–256px — the .exe and the installer
 *
 * `sharp` is borrowed from the site's own `node_modules` rather than added to
 * the app, which would otherwise ship a native image library it uses once, at
 * build time, on a developer's machine.
 *
 *   node scripts/make-icons.mjs                 # site at ../../Next JS/Al_Isnad
 *   SITE_DIR=/path/to/site node scripts/make-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.resolve(process.env.SITE_DIR ?? path.join(APP, "..", "..", "Next JS", "Al_Isnad"));
const SOURCE = path.join(SITE, "public", "icon-512.png");
const OUT = path.join(APP, "resources");

if (!fs.existsSync(SOURCE)) {
  console.error(`${SOURCE} was not found. Set SITE_DIR to the site's folder.`);
  process.exit(1);
}

const sharp = createRequire(path.join(SITE, "package.json"))("sharp");
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const source = fs.readFileSync(SOURCE);
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(SOURCE, path.join(OUT, "icon.png"));

const images = [];
for (const size of SIZES) {
  const png = await sharp(source).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();
  // A blank square is still a valid ICO; refuse it rather than ship one.
  const { channels } = await sharp(png).stats();
  const spread = channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0);
  if (spread < 10) throw new Error(`${size}px came out flat (spread ${spread.toFixed(1)})`);
  images.push({ size, png });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
const entries = [];
let offset = 6 + 16 * images.length;
for (const { size, png } of images) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  entries.push(entry);
}
fs.writeFileSync(path.join(OUT, "icon.ico"), Buffer.concat([header, ...entries, ...images.map((image) => image.png)]));

console.log(`✓ resources/icon.png (512px) and resources/icon.ico (${SIZES.join(", ")}px)`);
