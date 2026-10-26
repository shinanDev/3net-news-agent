// Brand settings for the newsletter (config/brand.json): colors derived from the logo
// (#0074C7, #1F9EFF) for a dark theme, a font stack without web fonts, and the repository link.

import { readFile } from "node:fs/promises";

export const DEFAULT_BRAND_PATH = "config/brand.json";

export interface Brand {
  name: string;
  colors: {
    pageBackground: string;
    cardBackground: string;
    text: string;
    mutedText: string;
    accent: string;
    /** Text on the accent color (score badge). */
    onAccent: string;
    /** Thin decorative lines; not used for text. */
    divider: string;
  };
  fontStack: string;
  repoUrl: string;
}

const COLOR_KEYS = ["pageBackground", "cardBackground", "text", "mutedText", "accent", "onAccent", "divider"] as const;

export async function loadBrand(path = DEFAULT_BRAND_PATH): Promise<Brand> {
  const b = JSON.parse(await readFile(path, "utf8")) as Partial<Brand>;
  const colors = (b.colors ?? {}) as Record<string, unknown>;
  // Values go into style attributes, so only plain hex colors and simple font names are accepted.
  const bad = COLOR_KEYS.filter((k) => typeof colors[k] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(colors[k] as string));
  if (bad.length) throw new Error(`${path}: colors must be #RRGGBB: ${bad.join(", ")}`);
  if (typeof b.name !== "string" || !b.name.trim()) throw new Error(`${path}: name missing`);
  if (typeof b.fontStack !== "string" || !/^[A-Za-z0-9 ,-]+$/.test(b.fontStack)) {
    throw new Error(`${path}: fontStack must be a comma-separated list of font names`);
  }
  if (typeof b.repoUrl !== "string" || !b.repoUrl.startsWith("https://")) throw new Error(`${path}: repoUrl must be https`);
  return b as Brand;
}

/** WCAG 2 contrast ratio of two #RRGGBB colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
