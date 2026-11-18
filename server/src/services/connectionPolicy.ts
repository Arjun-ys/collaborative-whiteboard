import type { IncomingMessage } from 'http';

export const allowedOriginsFromEnv = (value: string | undefined) => (value ?? '').split(',').filter((origin) => origin.trim()).map((origin) => {
  const parsed = new URL(origin.trim());
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin.trim()) throw new Error('ALLOWED_ORIGINS must contain HTTP(S) origins without paths');
  return parsed.origin;
});

export const validRoomPath = (pathname: string) => /^\/[a-zA-Z0-9_-]{1,128}$/.test(pathname) && pathname !== '/health';

export const permittedWsOrigin = (request: Pick<IncomingMessage, 'headers'>, allowedOrigins: string[], development = false) => {
  const origin = request.headers.origin;
  // Native clients do not supply Origin. This policy controls browser origins,
  // not room authentication; rooms still use anonymous link-based access.
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false;
    const serverUrl = new URL(`http://${request.headers.host}`);
    return parsed.host === request.headers.host || allowedOrigins.includes(origin) ||
      (development && parsed.hostname === serverUrl.hostname);
  } catch { return false; }
};
