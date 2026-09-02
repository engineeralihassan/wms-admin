/**
 * Central icon registry — named 24x24 SVG path data.
 *
 * Why a registry (not emoji or per-component SVG):
 *  - Consistency: every action button, everywhere, renders the same crisp,
 *    currentColor-tinted vector — matching the sidebar nav icons.
 *  - One source of truth: add/adjust an icon here and it updates app-wide.
 *  - Accessibility: icons are decorative (aria-hidden); the button keeps its label.
 *
 * Paths are single-path, 24x24 viewBox, using the Material "filled" style so they
 * read well at 16–18px inside compact action buttons.
 */
export const ICONS = {
  view: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5Zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  submit: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2 .01 7Z',
  withdraw: 'M9 14 4 9l5-5v3h6a6 6 0 0 1 0 12h-4v-2h4a4 4 0 0 0 0-8H9v3Z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z',
  cancel:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 0 1-8-8c0-1.85.63-3.55 1.69-4.9L16.9 18.31A7.9 7.9 0 0 1 12 20Zm6.31-3.1L7.1 5.69A7.9 7.9 0 0 1 12 4a8 8 0 0 1 8 8c0 1.85-.63 3.55-1.69 4.9Z',
  delete:
    'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z',
  members:
    'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z',
  assign:
    'M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Zm-9-1V8H4v3H1v2h3v3h2v-3h3v-2H6Zm9 3c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4Z',
  status:
    'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z',
  externalLink:
    'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7ZM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7Z',
} as const;

/** Union of all registered icon names. */
export type IconName = keyof typeof ICONS;

/** Resolve a name to its SVG path, or null if the name isn't registered. */
export function iconPath(name: string | undefined): string | null {
  if (!name) return null;
  return (ICONS as Record<string, string>)[name] ?? null;
}
