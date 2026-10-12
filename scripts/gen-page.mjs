import fs from "node:fs";
fs.writeFileSync("src/page.mjs", "// Generated from web/index.html (run: node scripts/gen-page.mjs)\nexport const PAGE = " + JSON.stringify(fs.readFileSync("web/index.html", "utf8")) + ";\n");
