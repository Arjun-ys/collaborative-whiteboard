/**
 * Shared theme color swap table.
 *
 * Each pair maps a [darkModeColor, lightModeColor]. When the theme toggles,
 * the local view resolves these ink colors against its background. Shared
 * snapshots use dark-theme ink; custom accent colors are left untouched.
 *
 * IMPORTANT: per AGENTS.md Rule #4, both the Zustand store `toggleTheme` and
 * the Whiteboard canvas theme listener must use this shared source of truth.
 */
export const THEME_SWAP_PAIRS: readonly (readonly [string, string])[] = [
  ['#ffffff', '#000000'],   // pure white <-> pure black
  ['#f3f4f6', '#1e293b'],   // light gray <-> dark slate
  ['#f8fafc', '#0f172a'],   // near-white <-> near-black
  ['#f8fafc', '#13141f'],   // near-white <-> legacy/default dark ink
  ['#f1f5f9', '#172033'],   // soft white <-> app shell ink
  ['#e2e8f0', '#334155'],   // cool gray <-> slate-700
] as const;

/**
 * Return the swapped color for the given theme, or `null` if the color
 * is not a theme-ink color and should be left unchanged.
 */
export const swapThemeColor = (
  color: string | undefined | null,
  targetTheme: 'light' | 'dark',
): string | null => {
  if (!color) return null;

  const normalized = color.trim().toLowerCase();
  for (const [dark, light] of THEME_SWAP_PAIRS) {
    if (targetTheme === 'light' && normalized === dark) return light;
    if (targetTheme === 'dark' && normalized === light) return dark;
  }

  return null;
};
