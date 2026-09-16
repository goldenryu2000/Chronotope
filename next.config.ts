import type { NextConfig } from "next";

/*
 * Everything below lives in this file, not in src/, on purpose. Next compiles
 * next.config.ts on its own and cannot resolve a relative import of another
 * TypeScript file (`./src/x` and `./src/x.ts` both fail with "Cannot find
 * module"). Named exports declared here load fine, and the tests import them
 * from here.
 */

export interface HeaderOptions {
  /** `next dev`: React needs eval for its error stacks, and Turbopack's HMR uses a websocket. */
  dev: boolean;
  /** Served over HTTPS. `next start` on a laptop is plain http. */
  https: boolean;
  /** Origins besides this one that the browser fetches artifacts and tiles from. */
  assetOrigins: string[];
}

/** The origin of an absolute URL. A path, or nothing, is this origin and needs no entry. */
export function originOf(url: string | undefined): string | null {
  if (!url || !/^https?:\/\//.test(url)) return null;
  return new URL(url).origin;
}

/**
 * A static policy, not a nonce.
 *
 * A nonce has to be fresh per response, so Next would render every page per
 * request. That throws away the prerendered entity pages and the ISR in front of
 * the database, which exist to keep Neon's free compute alive. `'unsafe-inline'`
 * is the price: Next's own inline RSC payload scripts and the theme bootstrap
 * in app/layout.tsx need it. The site has no accounts and renders no
 * user-authored HTML. Revisit with nonces or `experimental.sri` when authoring (M3) lands.
 *
 * The MapLibre worker is served from /maplibre/ (see src/lib/maplibre-worker.ts),
 * hence `worker-src 'self'`. `blob:` is kept for MapLibre's image decoding.
 */
export function contentSecurityPolicy({ dev, https, assetOrigins }: HeaderOptions): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${assetOrigins.join(" ")}${dev ? " ws:" : ""}`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(https ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.map((directive) => directive.replace(/\s+/g, " ").trim()).join("; ");
}

export function securityHeaders(options: HeaderOptions): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Older browsers ignore frame-ancestors; this says the same thing to them.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    // No `preload`: getting a domain off the browser preload list takes months.
    ...(options.https
      ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
      : []),
  ];
}

/**
 * What a Vercel build must have, checked before it starts.
 *
 * Each of these fails silently in production otherwise: a relative artifact
 * base 404s every atlas, a missing tiles base draws no borders, and a missing
 * source URL breaks the GPL offer on /credits.
 */
export function productionEnvProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set");
  for (const name of ["NEXT_PUBLIC_ARTIFACT_BASE_URL", "NEXT_PUBLIC_TILES_BASE_URL", "NEXT_PUBLIC_SOURCE_URL"]) {
    if (!env[name]?.startsWith("https://")) problems.push(`${name} must be an https URL`);
  }
  return problems;
}

if (process.env.VERCEL === "1") {
  const problems = productionEnvProblems(process.env);
  if (problems.length > 0) {
    throw new Error(`Refusing to build for Vercel:\n- ${problems.join("\n- ")}`);
  }
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const assetOrigins = [
      originOf(process.env.NEXT_PUBLIC_ARTIFACT_BASE_URL),
      originOf(process.env.NEXT_PUBLIC_TILES_BASE_URL),
    ].filter((origin): origin is string => origin !== null);

    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          dev: process.env.NODE_ENV === "development",
          // Vercel sets VERCEL=1 at build and at runtime. Locally `next start`
          // is http, and upgrade-insecure-requests would send it to https.
          https: process.env.VERCEL === "1",
          assetOrigins: [...new Set(assetOrigins)],
        }),
      },
    ];
  },
};

export default nextConfig;
