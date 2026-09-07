import { readFileSync, writeFileSync } from "node:fs";
const doc = readFileSync("DESIGN.md", "utf8").replace(/\r\n/g, "\n");
const colors = doc.split("colors:\n")[1].split("typography:")[0];
const values = [...colors.matchAll(/^  ([\w-]+): "(#[a-fA-F0-9]+)"/gm)];
const fonts = [...doc.split("typography:\n")[1].split("rounded:")[0].matchAll(/^  ([\w-]+):\n    fontFamily: '(.+)'/gm)];
const radii = [...doc.split("rounded:\n")[1].split("spacing:")[0].matchAll(/^  ([\w-]+): "(.+)"/gm)];
const spacing = [...doc.split("spacing:\n")[1].split("components:")[0].matchAll(/^  ([\w-]+): "(.+)"/gm)];
const declarations = [...values.map(([, k, v]) => `  --${k}: ${v};`), ...fonts.map(([, k, v]) => `  --font-${k}: ${v};`), ...radii.map(([, k, v]) => `  --radius-${k}: ${v};`), ...spacing.map(([, k, v]) => `  --${k}: ${v};`)];
const css = `/* Generated from DESIGN.md by scripts/design-tokens.mjs. */\n:root {\n${declarations.join("\n")}\n}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync("web/app/tokens.css", "utf8") !== css) throw new Error("Design tokens have drifted; run npm run tokens");
} else writeFileSync("web/app/tokens.css", css);
