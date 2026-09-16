// @vitest-environment node

import fs from "node:fs/promises";
import { describe, expect, test } from "vitest";

const themeStylesUrl = new URL("../styles/themes.css", import.meta.url);
const applicationStylesUrl = new URL("../styles.css", import.meta.url);

describe("theme CSS contract", () => {
  test("keeps normal-sized semantic text at WCAG AA contrast", async () => {
    const styles = await fs.readFile(themeStylesUrl, "utf8");
    for (const theme of themeNames) {
      const tokens = readThemeTokens(styles, theme);
      const surfaces = [tokens.background, tokens.surface, tokens.container];
      for (const foreground of [tokens.text, tokens.muted, tokens.blocked, tokens.waiting]) {
        for (const background of surfaces) {
          expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
      }

      const tintedWaitingSurface = composite(tokens.waiting, tokens.container, 0.1);
      expect(contrastRatio(tokens.waiting, tintedWaitingSurface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("keeps semantic accents readable as text on their own tinted chips", async () => {
    const styles = await fs.readFile(themeStylesUrl, "utf8");

    for (const theme of themeNames) {
      const tokens = readThemeTokens(styles, theme);
      const accents = [
        tokens.primary,
        tokens.done,
        tokens.trackDemo,
        tokens.trackAi,
        tokens.trackBiz,
      ];
      for (const accent of accents) {
        expect(contrastRatio(accent, tokens.surface)).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(accent, composite(accent, tokens.surface, 0.1)),
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(tokens.onPrimary, tokens.primary)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("keeps the control border perceivable on every surface it sits on", async () => {
    const styles = await fs.readFile(themeStylesUrl, "utf8");

    // WCAG 1.4.11: a border that is what makes a control identifiable needs 3:1.
    // `--color-outline-variant` is that border across the Cockpit; `--color-border-subtle`
    // is decorative only and is deliberately exempt.
    for (const theme of themeNames) {
      const tokens = readThemeTokens(styles, theme);
      for (const surface of [
        tokens.background,
        tokens.surface,
        tokens.container,
        tokens.containerHigh,
      ]) {
        expect(contrastRatio(tokens.outlineVariant, surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test("keeps every semantic colour distinguishable from the others", async () => {
    const styles = await fs.readFile(themeStylesUrl, "utf8");

    // Two semantic tokens that render the same colour silently collapse a
    // distinction the UI is relying on — "done" reading as "primary", say.
    for (const theme of themeNames) {
      const tokens = readThemeTokens(styles, theme);
      const semantic = {
        primary: tokens.primary,
        blocked: tokens.blocked,
        waiting: tokens.waiting,
        done: tokens.done,
        trackDemo: tokens.trackDemo,
        trackAi: tokens.trackAi,
        trackBiz: tokens.trackBiz,
      };
      const names = Object.keys(semantic) as (keyof typeof semantic)[];
      for (let index = 0; index < names.length; index += 1) {
        for (let other = index + 1; other < names.length; other += 1) {
          const distance = channelDistance(semantic[names[index]], semantic[names[other]]);
          expect(
            distance,
            `${theme}: ${names[index]} and ${names[other]} are too close to tell apart`,
          ).toBeGreaterThanOrEqual(60);
        }
      }
    }
  });

  test("gives each theme a distinct step at every rung of the elevation ramp", async () => {
    const styles = await fs.readFile(themeStylesUrl, "utf8");

    for (const theme of themeNames) {
      const tokens = readThemeTokens(styles, theme);
      const ramp = [
        tokens.containerLowest,
        tokens.surface,
        tokens.containerLow,
        tokens.container,
        tokens.containerHigh,
        tokens.containerHighest,
      ];
      for (let index = 1; index < ramp.length; index += 1) {
        expect(
          channelDistance(ramp[index - 1], ramp[index]),
          `${theme}: elevation rungs ${index - 1} and ${index} are the same colour`,
        ).toBeGreaterThan(0);
      }
    }
  });

  test("gives both themes an elevation treatment that their own palette can show", async () => {
    const styles = await fs.readFile(themeStylesUrl, "utf8");

    // A drop shadow is invisible on a near-black page and an inset highlight is
    // invisible on paper, so each theme has to declare both and neutralise one.
    for (const theme of themeNames) {
      const block = readThemeBlock(styles, theme);
      expect(block).toMatch(/--theme-elevation-highlight:/);
      expect(block).toMatch(/--theme-shadow:/);
    }
    expect(styles).toMatch(/box-shadow:\s*\n?\s*var\(--theme-elevation-highlight\),/);
  });

  test("covers the Knowledge Base reader without global utility-class overrides", async () => {
    const [themeStyles, applicationStyles] = await Promise.all([
      fs.readFile(themeStylesUrl, "utf8"),
      fs.readFile(applicationStylesUrl, "utf8"),
    ]);

    expect(applicationStyles).toContain('html[data-theme="warm"] .cockpit-library');
    expect(themeStyles).not.toMatch(/html\[data-theme="warm"\]\s+\.rounded-(?:lg|xl)/);
  });
});

const themeNames = ["minimal", "warm"] as const;

type ThemeName = (typeof themeNames)[number];

interface ThemeTokens {
  background: Rgb;
  surface: Rgb;
  containerLowest: Rgb;
  containerLow: Rgb;
  container: Rgb;
  containerHigh: Rgb;
  containerHighest: Rgb;
  text: Rgb;
  muted: Rgb;
  primary: Rgb;
  onPrimary: Rgb;
  outlineVariant: Rgb;
  blocked: Rgb;
  waiting: Rgb;
  done: Rgb;
  trackDemo: Rgb;
  trackAi: Rgb;
  trackBiz: Rgb;
}

type Rgb = [number, number, number];

function readThemeBlock(styles: string, theme: ThemeName): string {
  const start = styles.indexOf(`html[data-theme="${theme}"]`);
  const openingBrace = styles.indexOf("{", start);
  const closingBrace = styles.indexOf("}", openingBrace);
  return styles.slice(openingBrace + 1, closingBrace);
}

function readThemeTokens(styles: string, theme: ThemeName): ThemeTokens {
  const block = readThemeBlock(styles, theme);
  return {
    background: readRgb(block, "--color-background"),
    surface: readRgb(block, "--color-surface"),
    containerLowest: readRgb(block, "--color-surface-container-lowest"),
    containerLow: readRgb(block, "--color-surface-container-low"),
    container: readRgb(block, "--color-surface-container"),
    containerHigh: readRgb(block, "--color-surface-container-high"),
    containerHighest: readRgb(block, "--color-surface-container-highest"),
    text: readRgb(block, "--color-on-surface"),
    muted: readRgb(block, "--color-on-surface-variant"),
    primary: readRgb(block, "--color-primary"),
    onPrimary: readRgb(block, "--color-on-primary"),
    outlineVariant: readRgb(block, "--color-outline-variant"),
    blocked: readRgb(block, "--color-status-blocked"),
    waiting: readRgb(block, "--color-status-waiting"),
    done: readRgb(block, "--color-status-done"),
    trackDemo: readRgb(block, "--color-track-demo"),
    trackAi: readRgb(block, "--color-track-ai"),
    trackBiz: readRgb(block, "--color-track-biz"),
  };
}

function channelDistance(first: Rgb, second: Rgb): number {
  return first.reduce((total, channel, index) => total + Math.abs(channel - second[index]), 0);
}

function readRgb(block: string, token: string): Rgb {
  const match = new RegExp(`${token}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`).exec(block);
  if (!match) throw new Error(`Missing RGB token: ${token}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function composite(foreground: Rgb, background: Rgb, opacity: number): Rgb {
  return foreground.map((channel, index) =>
    Math.round(channel * opacity + background[index] * (1 - opacity)),
  ) as Rgb;
}

function contrastRatio(first: Rgb, second: Rgb): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function luminance(color: Rgb): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
