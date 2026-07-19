/**
 * Image asset loader + cache. All art is pixel-art PNG; the caller draws it with
 * smoothing disabled (see PixelSurface). Local assets live under `/assets/...`;
 * backend sprites are absolute URLs from the API (`spriteUrl`).
 */

const cache = new Map<string, HTMLImageElement>();

/** Load one image (cached by URL). Rejects on error so callers can fall back. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // backend sends permissive CORS
    img.onload = () => {
      cache.set(url, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`failed to load image: ${url}`));
    img.src = url;
  });
}

/** Load many images at once; the result maps each key to its loaded image. */
export async function loadImages<K extends string>(
  entries: Record<K, string>,
): Promise<Record<K, HTMLImageElement>> {
  const keys = Object.keys(entries) as K[];
  const imgs = await Promise.all(keys.map((k) => loadImage(entries[k])));
  const out = {} as Record<K, HTMLImageElement>;
  keys.forEach((k, i) => {
    out[k] = imgs[i]!;
  });
  return out;
}

/** A synchronously-available cached image, or undefined if not loaded yet. */
export function cached(url: string): HTMLImageElement | undefined {
  return cache.get(url);
}

/** Base path for the reused sheet assets (grass, fence, flowers, panels, …). */
export const SHEET = "/assets/sheet";
