/* Makes the PNG home-screen icons from shared/logo.png (the church logo the
   Driver App uses) on each app's own colour. Run after changing either:
     node tools/make-icons.mjs
   Needs Playwright (see tests/browser/README.md). iPhone uses the 180 px
   apple-touch-icon; Android and desktop use the 192/512 ones from the
   manifest; "maskable" keeps everything inside the safe circle. */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logo = "data:image/png;base64," + readFileSync(join(root, "shared", "logo.png")).toString("base64");
const APPS = [
  { dir: ".", bg: "#5b2a86", label: "USHERS" },
  { dir: "admin", bg: "#0b5f5c", label: "ADMIN" }
];
const SIZES = [
  { name: "apple-touch-icon.png", px: 180, safe: 1 },
  { name: "icon-192.png", px: 192, safe: 1 },
  { name: "icon-512.png", px: 512, safe: 1 },
  { name: "icon-512-maskable.png", px: 512, safe: 0.8 }
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.setContent("<canvas id=c></canvas>");
for (const app of APPS) {
  for (const s of SIZES) {
    const data = await page.evaluate(async ({ logo, px, bg, label, safe }) => {
      const img = new Image();
      img.src = logo;
      await img.decode();
      const c = document.getElementById("c");
      c.width = c.height = px;
      const x = c.getContext("2d");
      x.fillStyle = bg;
      x.fillRect(0, 0, px, px);
      const inner = px * safe, off = (px - inner) / 2;
      const d = inner * 0.6;
      x.drawImage(img, off + (inner - d) / 2, off + inner * 0.1, d, d);
      x.fillStyle = "#ffffff";
      x.font = "700 " + Math.round(inner * 0.15) + "px Helvetica, Arial, sans-serif";
      x.textAlign = "center";
      x.textBaseline = "alphabetic";
      x.fillText(label, px / 2, off + inner * 0.88);
      return c.toDataURL("image/png");
    }, { logo, px: s.px, bg: app.bg, label: app.label, safe: s.safe });
    writeFileSync(join(root, app.dir, s.name), Buffer.from(data.split(",")[1], "base64"));
    console.log(join(app.dir, s.name));
  }
}
await browser.close();
