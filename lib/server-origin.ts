/**
 * The one origin decision, made once.
 *
 * Checkout and Payment Link creation embed a return URL, and the naive
 * version - echo whatever `Origin` header arrived - is an open-redirect
 * shaped hole: a cross-site POST could mint a real Stripe session whose
 * success page belongs to the attacker. So the redirect target is only ever
 * the deployment's own origin or the explicitly configured
 * `NEXT_PUBLIC_SITE_URL`, and a request claiming any other origin is refused
 * outright rather than quietly corrected.
 *
 * Requests with no Origin header (curl, some webviews) are same-origin by
 * definition of what they can do and are served with the configured origin.
 */
export interface OriginCheck {
  /** The origin safe to build return URLs from. */
  origin: string;
  /** False when the request presented a foreign Origin header. */
  ok: boolean;
}

export function checkOrigin(request: Request): OriginCheck {
  const own = new URL(request.url).origin;
  const allowed = new Set<string>([own]);

  const configured = process.env.NEXT_PUBLIC_SITE_URL || '';
  let fallback = own;
  if (configured) {
    try {
      const o = new URL(configured).origin;
      allowed.add(o);
      fallback = o;
    } catch {
      /* A malformed NEXT_PUBLIC_SITE_URL falls back to the request origin. */
    }
  }

  const header = request.headers.get('origin');
  if (!header || header === 'null') return { origin: fallback, ok: !header ? true : false };

  try {
    const o = new URL(header).origin;
    if (allowed.has(o)) return { origin: o, ok: true };
  } catch {
    /* Unparseable Origin is treated as foreign. */
  }
  return { origin: fallback, ok: false };
}
