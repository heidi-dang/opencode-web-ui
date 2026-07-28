#!/usr/bin/env node
/**
 * Sync Better Harness i18n keys to all locale files.
 * Reads the authoritative English dict, extracts BH keys,
 * and appends any missing keys to every other locale.
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALE_DIR = join(__dirname, "..", "src", "i18n");

// Read English source
const enContent = readFileSync(join(LOCALE_DIR, "en.ts"), "utf-8");

// Extract all BH keys from English
const bhKeys = [];
const regex = /^\s+"(better-harness\.[^"]+)":\s*"([^"]*)",?\s*$/gm;
let match;
while ((match = regex.exec(enContent)) !== null) {
  bhKeys.push({ key: match[1], value: match[2] });
}

console.log(`Found ${bhKeys.length} Better Harness keys in English`);

// Process each locale file
const files = readdirSync(LOCALE_DIR).filter(f => f.endsWith(".ts") && f !== "en.ts" && f !== "parity.test.ts");

for (const file of files) {
  const filePath = join(LOCALE_DIR, file);
  let content = readFileSync(filePath, "utf-8");

  // Find closing brace
  const lastBrace = content.lastIndexOf("}");
  if (lastBrace === -1) {
    console.error(`Cannot find closing brace in ${file}`);
    continue;
  }

  // Extract existing BH keys
  const existingKeys = new Set();
  const existingRegex = /^\s+"(better-harness\.[^"]+)":/gm;
  let m;
  while ((m = existingRegex.exec(content)) !== null) {
    existingKeys.add(m[1]);
  }

  // Find missing keys
  const missing = bhKeys.filter(k => !existingKeys.has(k.key));
  if (missing.length === 0) {
    console.log(`${file}: up to date`);
    continue;
  }

  // Build insert block
  const insertBlock = "\n" + missing.map(k => `  "${k.key}": "${k.value}",`).join("\n");

  // Insert before closing brace
  content = content.slice(0, lastBrace) + insertBlock + "\n" + content.slice(lastBrace);

  writeFileSync(filePath, content);
  console.log(`${file}: added ${missing.length} keys (${missing.map(k => k.key).join(", ")})`);
}

console.log("Done");
