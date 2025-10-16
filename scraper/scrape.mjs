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

// Tunables
const MAX_SCROLLS = Number(process.env.MAX_SCROLLS || 20);      // was 4
const WAIT_BETWEEN = Number(process.env.WAIT_BETWEEN || 600);   // ms between scrolls
const FIRST_IDLE = Number(process.env.FIRST_IDLE || 5000);      // initial hydrate wait

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
  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
    viewport: { width: 1400, height: 900 }, // decent desktop viewport so masonry layouts load
  });

  await page.goto(COSMOS_URL, { waitUntil: "domcontentloaded", timeout: 120000 });

  // Let Next/React hydrate + first lazy images attach
  await page.waitForTimeout(FIRST_IDLE);

  // Deep scroll to trigger lazy loading
  await page.evaluate(
    async ({ MAX_SCROLLS, WAIT_BETWEEN }) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < MAX_SCROLLS; i++) {
        window.scrollBy(0, Math.floor(window.innerHeight * 0.9));
        await sleep(WAIT_BETWEEN);
      }
      // small bounce to ensure on-screen sources are resolved
      window.scrollTo(0, 0);
      await sleep(400);
    },
    { MAX_SCROLLS, WAIT_BETWEEN }
  );

  // One more idle wait for any late network fetches
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  const items = await page.evaluate(() => {
    const out = [];

    // Images
    document.querySelectorAll("img").forEach(img => {
      const src = img.currentSrc || img.src;
      if (src && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(src)) {
        out.push({
          type: "image",
          src,
          w: img.naturalWidth || null,
          h: img.naturalHeight || null
        });
      }
    });

    // Videos
    document.querySelectorAll("video").forEach(v => {
      const s = v.currentSrc || v.src || (v.querySelector("source")?.src);
      if (s && /\.(mp4|webm|m4v|mov)(\?|$)/i.test(s)) {
        out.push({
          type: "video",
          src: s,
          poster: v.poster || null,
          w: v.videoWidth || null,
          h: v.videoHeight || null
        });
      }
    });

    // Normalise URL (strip query) to dedupe CDN variants
    const normalise = (m) => {
      try {
        const u = new URL(m.src, location.href);
        return { ...m, src: u.origin + u.pathname };
      } catch { return m; }
    };
    return out.map(normalise);
  });

  await browser.close();

  const payload = { ok: true, source: COSMOS_URL, count: items.length, items: uniq(items) };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_FILE} with ${payload.count} items`);
})();
