import { doubleCsrf } from "csrf-csrf";
import { env } from "@/config/env";

const isProd = env.NODE_ENV === "production";

/**
 * Double-submit-cookie CSRF protection.
 * The frontend must read the `x-csrf-token` cookie value (non-httpOnly) and
 * echo it back in the `X-CSRF-Token` header on state-changing requests.
 *
 * The web app and the API live on different sites, so in production the cookie
 * must be SameSite=None (which requires Secure) to be sent cross-site.
 */
export const { doubleCsrfProtection, generateToken } = doubleCsrf({
  getSecret: () => env.CSRF_SECRET,
  cookieName: isProd ? "__Host-inaedaa.csrf" : "inaedaa.csrf",
  cookieOptions: {
    httpOnly: true,
    sameSite: isProd ? "none" : "strict",
    secure: isProd,
    path: "/",
  },
  size: 64,
  errorConfig: {
    statusCode: 403,
    message: "Token CSRF tidak valid, muat ulang halaman",
    code: "EBADCSRFTOKEN",
  },
});
