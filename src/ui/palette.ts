// The palette, in one place: the colours this app uses from f-f-9-9-0-0.github.io's (read
// 2026-11-20), plus the colours this app needs that a website does not: a field surface, the
// security-tint line, and an alarm red that is never the site's coral. The page's CSS custom
// properties are written from this object, and the drawings read it directly, so the two cannot
// disagree. If the sites' palette changes, this copy does not follow on its own.

export interface Palette {
  readonly paper: string;
  readonly surface: string;
  readonly field: string;
  readonly rule: string;
  readonly ruleSoft: string;
  readonly ruleStrong: string;
  readonly ink: string;
  readonly inkSoft: string;
  readonly tint: string;
  readonly onTint: string;
  readonly tintLine: string;
  readonly wash: string;
  readonly alarm: string;
  readonly alarmBg: string;
  readonly onAlarm: string;
  readonly legacy: string;
}

const LIGHT: Palette = {
  paper: '#e8ece6',
  surface: '#f4f6f3',
  field: '#fbfcfa',
  rule: '#d3dbd5',
  ruleSoft: '#e0e6e0',
  ruleStrong: '#b4c0b8',
  ink: '#13232a',
  inkSoft: '#4f5f5e',
  tint: '#0d6b68',
  onTint: '#ffffff',
  tintLine: '#0d6b68',
  wash: '#d7e7e2',
  alarm: '#c8102e',
  alarmBg: '#c8102e',
  onAlarm: '#ffffff',
  legacy: '#7a5300',
};

const DARK: Palette = {
  paper: '#142024',
  surface: '#0e1719',
  field: '#0b1315',
  rule: '#22343a',
  ruleSoft: '#1a2a2f',
  ruleStrong: '#35505a',
  ink: '#e3ece8',
  inkSoft: '#9daeab',
  tint: '#5fd1c6',
  onTint: '#0e1719',
  tintLine: '#2a7f79',
  wash: '#173a3c',
  alarm: '#ff6b7d',
  alarmBg: '#b3122b',
  onAlarm: '#ffffff',
  legacy: '#e8c06a',
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

export const currentPalette = (): Palette => (matchMedia(DARK_QUERY).matches ? DARK : LIGHT);

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const declarations = (p: Palette) =>
  Object.entries(p)
    .map(([name, value]) => `--${kebab(name)}: ${value};`)
    .join(' ');

/** The custom properties for both schemes, as CSS text. */
export function paletteCss(): string {
  return `:root { ${declarations(LIGHT)} color-scheme: light; }\n@media ${DARK_QUERY} { :root { ${declarations(DARK)} color-scheme: dark; } }\n`;
}

/** Calls the listener when the system switches between light and dark; returns how to stop. */
export function onSchemeChange(listener: () => void): () => void {
  const query = matchMedia(DARK_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
