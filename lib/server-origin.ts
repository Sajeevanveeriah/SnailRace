/**
 * The one origin decision, made once.
 *
 * Checkout and Payment Link creation embed a return URL, and the naive
 * version - echo whatever `Origin` header arrived - is an open-redirect
 * shaped hole: a cross-site POST could mint a real Stripe session whose
 * success page belongs to the attacker. So the redirect target is only ever
 * the deployment's own origin or the explicitly configured application URL,
 * and a request claiming any other origin is refused outright rather than
 * quietly corrected. Origin is a browser CSRF boundary, not authentication.
 */
export interface OriginCheck {
  /** The application base URL safe to build return URLs from. */
  origin: string;
  /** False for missing, opaque, malformed or foreign Origin headers. */
  ok: boolean;
}

export function checkOrigin(request: Request): OriginCheck {
  const requestOrigin = new URL(request.url).origin;
  const configured = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '';
  let appBase = requestOrigin;
  let allowedOrigin = requestOrigin;

  if (configured.trim()) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        allowedOrigin = url.origin;
        appBase = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
      }
    } catch {
      /* A malformed configured URL falls back to the request URL. */
    }
  }

  const header = request.headers.get('origin');
  if (!header || header === 'null') return { origin: appBase, ok: false };

  try {
    const supplied = new URL(header);
    if (supplied.origin === header.replace(/\/$/, '') && supplied.origin === allowedOrigin) {
      return { origin: appBase, ok: true };
    }
  } catch {
    /* Unparseable Origin is treated as foreign. */
  }
  return { origin: appBase, ok: false };
}
