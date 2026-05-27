/**
 * One-off generator: PNG icons + Apple splash from public/icon.svg
 * Run: node scripts/generate-pwa-icons.mjs
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public/icon.svg");
const iconsDir = path.join(root, "public/icons");
const splashDir = path.join(root, "public/splash");

const FAIRWAY = "#1c4a23";
const CREAM = "#f8f5ee";

async function main() {
  await mkdir(iconsDir, { recursive: true });
  await mkdir(splashDir, { recursive: true });

  for (const size of [180, 192, 512]) {
    const out =
      size === 180
        ? path.join(iconsDir, "apple-touch-icon.png")
        : path.join(iconsDir, `icon-${size}.png`);
    await sharp(src).resize(size, size).png().toFile(out);
    console.log("wrote", out);
  }

  const splashW = 1284;
  const splashH = 2778;
  const logoSize = 220;
  const logo = await sharp(src).resize(logoSize, logoSize).png().toBuffer();
  const splashPath = path.join(splashDir, "apple-splash.png");
  await sharp({
    create: {
      width: splashW,
      height: splashH,
      channels: 3,
      background: CREAM,
    },
  })
    .composite([
      {
        input: logo,
        gravity: "center",
      },
    ])
    .png()
    .toFile(splashPath);
  console.log("wrote", splashPath);

  const androidSplash = path.join(splashDir, "android-splash.png");
  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 3,
      background: FAIRWAY,
    },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(androidSplash);
  console.log("wrote", androidSplash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
