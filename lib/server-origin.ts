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

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const hostnameOf = (url: URL): string => url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

const effectivePort = (url: URL): string =>
  url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '');

/**
 * Next normalises loopback hosts in some server paths, so a request made to
 * 127.0.0.1 can reach a route handler as localhost. Treat only the three
 * literal loopback spellings as equivalent, and only with the same scheme and
 * effective port. This keeps the production host boundary exact.
 */
const sameLoopbackOrigin = (left: URL, right: URL): boolean =>
  LOOPBACK_HOSTS.has(hostnameOf(left)) &&
  LOOPBACK_HOSTS.has(hostnameOf(right)) &&
  left.protocol === right.protocol &&
  effectivePort(left) === effectivePort(right);

export function checkOrigin(request: Request): OriginCheck {
  const requestUrl = new URL(request.url);
  const requestOrigin = requestUrl.origin;
  const configured = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '';
  let appBase = requestOrigin;
  let allowedOrigin = requestOrigin;
  let hasConfiguredOrigin = false;

  if (configured.trim()) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        allowedOrigin = url.origin;
        appBase = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
        hasConfiguredOrigin = true;
      }
    } catch {
      /* A malformed configured URL falls back to the request URL. */
    }
  }

  const header = request.headers.get('origin');
  if (!header || header === 'null') return { origin: appBase, ok: false };

  try {
    const supplied = new URL(header);
    const isCanonicalOrigin = supplied.origin === header.replace(/\/$/, '');
    if (isCanonicalOrigin && supplied.origin === allowedOrigin) {
      return { origin: appBase, ok: true };
    }
    if (isCanonicalOrigin && !hasConfiguredOrigin && sameLoopbackOrigin(supplied, requestUrl)) {
      return { origin: supplied.origin, ok: true };
    }
  } catch {
    /* Unparseable Origin is treated as foreign. */
  }
  return { origin: appBase, ok: false };
}
