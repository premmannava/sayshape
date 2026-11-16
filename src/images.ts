/**
 * Image loading for the engine. A spec can name any URL, and a model writes
 * specs, so images only load from the page's own origin or from hosts the app
 * allows: otherwise a generated screen could make the browser contact any
 * server (tracking, probing internal addresses).
 */

/** An image ready to draw. */
export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export type ImageStatus = "loading" | "ready" | "error" | "blocked";

export interface ImageState {
  status: ImageStatus;
  image?: LoadedImage;
  /** When it finished loading, for fading in. */
  readyAt?: number;
}

/**
 * Image hosts models already know addresses on: reference pictures, photos,
 * placeholders, flags, logos, posters, covers and the like. Nothing uses this
 * list unless a host passes it as `imageHosts` (and to the model guide): the
 * engine's own default stays "your own site only".
 *
 * What may be on it:
 * - It answered a real image with `Access-Control-Allow-Origin` when asked from
 *   another site (checked November 2026), since images load with CORS. Hosts
 *   models often write that send no such header (randomuser.me, i.pravatar.cc,
 *   assets.coingecko.com, cdn.nba.com, static.wikia.nocookie.net) would never
 *   draw, so they're left out.
 * - Where an address redirects, the host it lands on is listed too (picsum to
 *   fastly.picsum, Open Library covers to archive.org), because a chat app's
 *   sandbox checks every hop.
 * - It serves its own files. Never a host that fetches an address written in
 *   the URL (image proxies and resizers, screenshot and favicon services,
 *   gravatar's `d=`, shields.io's endpoint badges), and never a wildcard over
 *   storage anyone can rent (`*.amazonaws.com`, `*.cloudfront.net`,
 *   `storage.googleapis.com`): either would let a spec reach any server again.
 * - No paid stock libraries, whose addresses need a signature a model can't know.
 */
export const COMMON_IMAGE_HOSTS: readonly string[] = Object.freeze([
  // Reference pictures and photos
  "upload.wikimedia.org", "images.unsplash.com", "images.pexels.com", "cdn.pixabay.com", "picsum.photos", "fastly.picsum.photos",
  // Placeholders and avatars
  "placehold.co", "via.placeholder.com", "dummyimage.com", "ui-avatars.com", "api.dicebear.com", "avatars.githubusercontent.com",
  // Sample data
  "dummyjson.com", "cdn.dummyjson.com", "fakestoreapi.com",
  // Files in public repositories and packages
  "raw.githubusercontent.com", "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com",
  // Logos, icons and flags
  "cdn.simpleicons.org", "api.iconify.design", "img.icons8.com", "cdn-icons-png.flaticon.com", "flagcdn.com", "flagicons.lipis.dev",
  // Films, television and video
  "image.tmdb.org", "m.media-amazon.com", "images-na.ssl-images-amazon.com", "i.ytimg.com", "img.youtube.com",
  // Music
  "i.scdn.co", "*.mzstatic.com",
  // Games and anime
  "images.igdb.com", "cdn.akamai.steamstatic.com", "shared.akamai.steamstatic.com", "cdn.myanimelist.net",
  // Books
  "covers.openlibrary.org", "archive.org", "*.us.archive.org", "i.gr-assets.com",
  // Food
  "www.themealdb.com", "www.thecocktaildb.com", "images.openfoodfacts.org",
  // Animals
  "images.dog.ceo", "cdn2.thedogapi.com",
  // Space
  "images-assets.nasa.gov", "cdn.esahubble.org", "cdn.eso.org",
  // Sport
  "a.espncdn.com", "www.mlbstatic.com", "media.api-sports.io",
  // Weather
  "openweathermap.org", "cdn.weatherapi.com",
  // Money
  "coin-images.coingecko.com",
  // Pictures people share
  "i.imgur.com", "pbs.twimg.com", "lh3.googleusercontent.com", "media.giphy.com", "i.giphy.com",
  // Shops
  "cdn.shopify.com", "i.ebayimg.com",
  // News
  "ichef.bbci.co.uk",
  // QR codes
  "api.qrserver.com",
]);

export type ImageLoader = (url: string) => Promise<LoadedImage>;

/** Loads with an <img>, requesting CORS so the canvas stays readable (for tests and capture). */
export const browserImageLoader: ImageLoader = (url) =>
  new Promise((resolve, reject) => {
    if (typeof Image === "undefined") { reject(new Error("No Image in this environment")); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`Couldn't load ${url}`));
    img.src = url;
  });

/** Whether a host matches an allowlist entry: exact, or "*.example.com" for any subdomain. */
function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) return host.endsWith(p.slice(1)) && host.length > p.length - 1;
  return host === p;
}

export interface ImagePolicy {
  /** The page's origin; images from it are always allowed. */
  origin: string;
  /** Base URL for relative src values. */
  base: string;
  hosts: readonly string[];
}

/**
 * Resolve a spec's src against the policy. Returns the absolute URL, or the
 * reason it isn't allowed.
 */
export function resolveImageUrl(src: string, policy: ImagePolicy): { url: string } | { blocked: string } {
  let u: URL;
  try { u = new URL(src, policy.base); } catch { return { blocked: `"${src}" isn't a valid URL` }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { blocked: `${u.protocol} URLs aren't allowed` };
  if (u.username || u.password) return { blocked: "URLs with credentials aren't allowed" };
  if (u.origin === policy.origin) return { url: u.href };
  if (u.protocol !== "https:") return { blocked: `${u.host} must use https` };
  const host = u.hostname.toLowerCase();
  if (policy.hosts.some((h) => hostMatches(host, h))) return { url: u.href };
  return { blocked: `${host} isn't in imageHosts` };
}

/** Caches loads by URL and tells the engine when one settles. */
export class ImageCache {
  private entries = new Map<string, ImageState>();
  private pending = new Set<Promise<unknown>>();
  private warned = new Set<string>();

  constructor(
    private policy: () => ImagePolicy,
    private loader: ImageLoader,
    private onSettle: () => void,
    private now: () => number,
    private warn: (message: string) => void,
    private max = 200,
  ) {}

  get(src: string): ImageState {
    const r = resolveImageUrl(src, this.policy());
    if ("blocked" in r) {
      if (!this.warned.has(src)) {
        this.warned.add(src);
        this.warn(`Image "${src}" was not loaded: ${r.blocked}. Allow its host with the imageHosts option.`);
      }
      return { status: "blocked" };
    }
    const hit = this.entries.get(r.url);
    if (hit) {
      // Keep recently used images at the end, so the oldest are evicted first.
      this.entries.delete(r.url);
      this.entries.set(r.url, hit);
      return hit;
    }
    const entry: ImageState = { status: "loading" };
    this.entries.set(r.url, entry);
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
    const p = this.loader(r.url).then(
      (image) => { entry.status = "ready"; entry.image = image; entry.readyAt = this.now(); },
      () => { entry.status = "error"; },
    ).finally(() => { this.pending.delete(p); this.onSettle(); });
    this.pending.add(p);
    return entry;
  }

  /** Resolves once every image requested so far has loaded or failed. */
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
