/**
 * Lightweight debug logger that is automatically silenced in production builds.
 *
 * In development (`import.meta.env.DEV === true`) all messages go to the
 * browser console.  In production the calls are effectively no-ops, avoiding
 * the performance cost of serializing hundreds of log arguments per second
 * on a busy collaborative board.
 */

const IS_DEV = import.meta.env.DEV;

export const logger = {
  log: IS_DEV ? console.log.bind(console) : () => {},
  warn: IS_DEV ? console.warn.bind(console) : () => {},
  error: console.error.bind(console), // errors always surface
};
