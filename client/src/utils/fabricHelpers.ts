/**
 * Shared constants for Fabric.js object serialization.
 *
 * Every call to `fabric.Object.toObject()` that persists to Yjs must include
 * these custom properties so they survive the serialize → enliven round-trip.
 * Keeping the list in one place prevents the subtle bug where a new custom
 * property is added in one handler but forgotten in another.
 */
export const CUSTOM_FABRIC_PROPS = [
  'id',
  'creatorId',
  'backgroundColor',
  'padding',
  'shadow',
  '_isSticky',
  '_stickyBaseFontSize',
  '_stickyBaseWidth',
  '_stickyScale',
] as const;
