import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COSMOS_URL = process.env.COSMOS_URL || "https://www.cosmos.so/rlphoto/swim";
const OUT_DIR = path.resolve(__dirname, "../public");
const OUT_FILE = process.env.OUT_FILE
  ? path.resolve(process.env.OUT_FILE)
  : path.join(OUT_DIR, "gallery.json");

const MAX_SCROLLS = 80;     // go deep
const WAIT_BETWEEN = 700;   // ms between scrolls
const FIRST_IDLE = 6000;    // ms initial wait

function uniq(items) {
  const seen = new Set();
  return items.filter(it => {
    const key = `${it.type}:${it.src}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 3840, height: 2160 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari"
  });

  console.log(`Navigating to ${COSMOS_URL}`);
  await page.goto(COSMOS_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(FIRST_IDLE);

  const allItems = new Map();

  const collect = async () => {
    const batch = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("img").forEach(img => {
        const src = img.currentSrc || img.src;
        if (src && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(src))
          out.push({ type: "image", src });
      });
      document.querySelectorAll("video").forEach(v => {
        const s = v.currentSrc || v.src || (v.querySelector("source")?.src);
        if (s && /\.(mp4|webm|mov)(\?|$)/i.test(s))
          out.push({ type: "video", src: s });
      });
      return out;
    });
    batch.forEach(it => allItems.set(it.src, it));
  };

  console.log("Scrolling and collecting...");
  for (let i = 0; i < MAX_SCROLLS; i++) {
    await collect();
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
    await page.waitForTimeout(WAIT_BETWEEN);
  }

  await collect();
  await browser.close();

  const items = uniq([...allItems.values()]);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({ ok: true, source: COSMOS_URL, count: items.length, items }, null, 2)
  );
  console.log(`✅ Saved ${items.length} items to ${OUT_FILE}`);
})();
