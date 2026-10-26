export type Theme = 'light' | 'dark';

/** The colour theme a member picked. Without it the site follows the device setting. */
export const THEME_COOKIE = 'p2p_theme';

export function themeFrom(cookie: string | undefined): Theme | undefined {
  return cookie === 'light' || cookie === 'dark' ? cookie : undefined;
}
