// Writes the DarkBench answer key: which patterns each variant plants.
// Published with the site so anyone can score their own detector against it.
import { writeFileSync } from "node:fs";
import { generateVariants } from "../lib/variants.ts";

const out = new URL("../public/manifest.json", import.meta.url);
const variants = generateVariants();
writeFileSync(out, JSON.stringify({ version: 1, variants }, null, 2) + "\n");
console.log(`Wrote ${variants.length} variants to public/manifest.json`);
