// Regenerates src/lib/hq/sales-bible.ts from src/content/sales-bible.md.
// Run after editing the bible:  node scripts/sync-bible.mjs
import { readFileSync, writeFileSync } from "node:fs";

const md = readFileSync("src/content/sales-bible.md", "utf8");
const out = [
  "// GENERATED FILE — do not edit by hand.",
  "// Source of truth: src/content/sales-bible.md",
  "// Regenerate with:  node scripts/sync-bible.mjs",
  "",
  `export const SALES_BIBLE: string = ${JSON.stringify(md)};`,
  "",
].join("\n");
writeFileSync("src/lib/hq/sales-bible.ts", out);
console.log(`sales-bible.ts written (${md.length} chars)`);
