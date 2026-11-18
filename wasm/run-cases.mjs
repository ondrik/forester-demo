// Runs playground/forester.wasm (under Node) on every cases/*.c and records Forester's
// diagnostics, verdict and time in cases/results.json (read by build.py).
//   node wasm/run-cases.mjs           record
//   node wasm/run-cases.mjs --check   compare with the recorded results instead
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const createForester = createRequire(import.meta.url)(path.join(root, "playground/forester.js"));
const check = process.argv.includes("--check");
const resultsFile = path.join(root, "cases/results.json");

// Forester's own diagnostics: "file:line[:col]: kind: message [-fa]", without internal locations
export function clean(lines) {
  const out = [];
  let verdict = "unknown";
  for (const raw of lines) {
    // "#58:~n": register #58 holds the C variable n (wasm/patches/forester-var-names.patch)
    const l = raw.replace(/\x1b\[[0-9;]*m/g, "").replace(/(#\d+):~/g, "$1:");
    if (/The program is SAFE\./.test(l)) verdict = "safe";
    if (!l.endsWith(" [-fa]") || l.includes("[internal location]")) continue;
    out.push(l.slice(0, -" [-fa]".length));
  }
  if (out.some((l) => / error: /.test(l))) verdict = "bug";
  return { output: out, verdict };
}

const cases = readdirSync(path.join(root, "cases")).filter((f) => f.endsWith(".c")).sort();
const old = check ? JSON.parse(readFileSync(resultsFile, "utf8")).cases : null;
const results = {};
let failed = 0;
for (const file of cases) {
  const name = file.slice(0, -2);
  const src = readFileSync(path.join(root, "cases", file), "utf8");
  const m = src.split("\n")[0].match(/\/\* forester-args: (.*) \*\//);
  const args = m ? [`-args=${m[1]}`] : [];
  const lines = [];
  const fa = await createForester({ print: (t) => lines.push(t), printErr: (t) => lines.push(t) });
  fa.FS.mkdirTree("/work");
  fa.FS.writeFile(`/work/${file}`, src);
  fa.FS.chdir("/work");
  const t0 = performance.now();
  const status = fa.callMain([file, ...args]);
  const seconds = (performance.now() - t0) / 1000;
  const { output, verdict } = clean(lines);
  const errors = output.filter((l) => / error: /.test(l)).length;
  results[name] = { command: ["forester", ...args, file].join(" "), status, verdict, errors,
                    output, seconds: Math.round(seconds * 1000) / 1000 };
  let mark = "";
  if (check) {
    const same = old[name] && old[name].verdict === verdict && JSON.stringify(old[name].output) === JSON.stringify(output);
    if (!same) failed++;
    mark = same ? "ok   " : "DIFF ";
  }
  console.log(`${mark}${file.padEnd(24)} ${verdict.padEnd(7)} ${seconds.toFixed(2)} s  ${output.find((l) => / error: /.test(l)) || ""}`);
}
if (!check) {
  const meta = JSON.parse(readFileSync(path.join(root, "wasm/versions.json"), "utf8"));
  writeFileSync(resultsFile, JSON.stringify({ ...meta, cases: results }, null, 2) + "\n");
}
process.exit(failed ? 1 : 0);
