import fs from "node:fs";
const src = process.argv[2];
if (!src) { console.error("usage: node scripts/embed-template.mjs your-template.xlsx"); process.exit(1); }
const b64 = fs.readFileSync(src).toString("base64");
fs.writeFileSync(new URL("../lib/template-b64.js", import.meta.url),
  `// Your Excel template (embedded so it always ships with the deployment).\n// To change the template: run  node scripts/embed-template.mjs path/to/new.xlsx\nexport const TEMPLATE_B64 = "${b64}";\n`);
console.log("template embedded");
