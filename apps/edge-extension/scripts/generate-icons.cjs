const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a73e8"/>
      <stop offset="100%" stop-color="#1557b0"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  <rect x="36" y="56" width="56" height="44" rx="10" fill="white"/>
  <path d="M48 56 V 44 Q48 28 64 28 Q80 28 80 44 V 56" fill="none" stroke="white" stroke-width="14" stroke-linecap="round"/>
  <circle cx="64" cy="76" r="7" fill="#1a73e8"/>
  <rect x="58" y="76" width="12" height="14" rx="2" fill="#1a73e8"/>
</svg>`;

const sizes = [16, 32, 48, 128];
const outDir = path.join(__dirname, "..", "public", "icons");

async function generate() {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const size of sizes) {
    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, `icon${size}.png`));
    console.log(`Generated icon${size}.png`);
  }
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
