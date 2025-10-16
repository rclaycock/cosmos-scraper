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

// Basic helper
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
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari"
  });

  await page.goto(COSMOS_URL, { waitUntil: "domcontentloaded", timeout: 120000 });

  // Give Next.js time to hydrate and lazy media to attach
  await page.waitForTimeout(3000);

  // If the page uses infinite scroll, scroll a bit to ensure videos load posters
  try {
    await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 4; i++) {
        window.scrollBy(0, window.innerHeight);
        await sleep(400);
      }
      window.scrollTo(0, 0);
      await sleep(200);
    });
  } catch {}

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
      const src =
        v.currentSrc ||
        v.src ||
        (v.querySelector("source") ? v.querySelector("source").src : null);
      if (src && /\.(mp4|webm|m4v|mov)(\?|$)/i.test(src)) {
        out.push({
          type: "video",
          src,
          poster: v.poster || null,
          w: v.videoWidth || null,
          h: v.videoHeight || null
        });
      }
    });

    // Deduplicate obvious CDN variants by URL without query
    const norm = m => {
      try {
        const u = new URL(m.src, location.href);
        return { ...m, src: u.origin + u.pathname };
      } catch { return m; }
    };

    return out.map(norm);
  });

  await browser.close();

  const payload = {
    ok: true,
    source: COSMOS_URL,
    count: items.length,
    items: uniq(items)
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_FILE} with ${payload.count} items`);
})();