"use strict";

const $ = (id) => document.getElementById(id);
const DEFAULT_CODE = `#include <stdlib.h>

extern int __VERIFIER_nondet_int(void);

struct node {
    struct node *left;
    struct node *right;
};

int main(void)
{
    /* a binary tree of unknown shape */
    struct node *root = malloc(sizeof *root);
    root->left = root->right = NULL;
    while (__VERIFIER_nondet_int()) {
        struct node *n = root;
        while (n->left && n->right)
            n = __VERIFIER_nondet_int() ? n->left : n->right;
        struct node *leaf = malloc(sizeof *leaf);
        leaf->left = leaf->right = NULL;
        if (!n->left)
            n->left = leaf;
        else
            n->right = leaf;
    }

    /*
     * Free it in constant space: rotate left children up, then free the root.
     * One line is missing here. Run Forester to see what goes wrong, then fix it.
     */
    while (root) {
        if (root->left) {
            struct node *l = root->left;
            l->right = root;
            root = l;
        } else {
            struct node *next = root->right;
            free(root);
            root = next;
        }
    }
    return 0;
}
`;

// ---------------------------------------------------------------------------------------------
// Editor

const editor = CodeMirror.fromTextArea($("code"), {
  mode: "text/x-csrc",
  lineNumbers: true,
  indentUnit: 4,
  tabSize: 4,
  indentWithTabs: false,
  viewportMargin: Infinity,
  extraKeys: {
    "Ctrl-Enter": () => run(),
    "Cmd-Enter": () => run(),
    Tab: (cm) => cm.replaceSelection("    "),
  },
});

let marks = [];
function clearMarks() {
  for (const m of marks) m.clear ? m.clear() : editor.removeLineClass(m.line, "background", m.cls);
  marks = [];
}
function markLine(lineNo, kind, message) {
  const line = lineNo - 1;
  if (line < 0 || line >= editor.lineCount()) return;
  const cls = kind === "error" ? "cm-line-err" : "cm-line-warn";
  editor.addLineClass(line, "background", cls);
  marks.push({ line, cls });
  const el = document.createElement("div");
  el.className = `cm-callout ${kind}`;
  el.textContent = `▲ ${kind}: ${message}`;
  marks.push(editor.addLineWidget(line, el, { coverGutter: false, noHScroll: true }));
}
editor.on("change", () => { if (marks.length) clearMarks(); });

// ---------------------------------------------------------------------------------------------
// Examples, options and shareable links

let examples = [];
const exampleSel = $("example");

async function loadExamples() {
  try {
    examples = await (await fetch("examples.json")).json();
  } catch { examples = []; }
  exampleSel.innerHTML = '<option value="">— your program —</option>';
  let group = null, optgroup = null;
  for (const ex of examples) {
    if (ex.story !== group) {
      group = ex.story;
      optgroup = document.createElement("optgroup");
      optgroup.label = group;
      exampleSel.appendChild(optgroup);
    }
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = ex.label;
    optgroup.appendChild(opt);
  }
}

async function selectExample(id) {
  const ex = examples.find((e) => e.id === id);
  if (!ex) return false;
  const code = await (await fetch(`../cases/${ex.id}.c`)).text();
  editor.setValue(code);
  $("filename").value = `${ex.id}.c`;
  setArgs(ex.args);
  exampleSel.value = id;
  updateLabels();
  return true;
}

exampleSel.addEventListener("change", () => {
  if (exampleSel.value) selectExample(exampleSel.value);
});
editor.on("change", (cm, change) => {
  if (change.origin !== "setValue") exampleSel.value = "";
});

function getArgs() {
  const args = [...document.querySelectorAll("[data-arg]")].filter((c) => c.checked).map((c) => c.dataset.arg);
  return args;
}
// examples set the options they need, but leave the "sticky" ones (heap graphs) as they are;
// a shared link sets all of them
function setArgs(args, all) {
  for (const c of document.querySelectorAll("[data-arg]")) {
    if (all || !c.hasAttribute("data-sticky")) c.checked = args.includes(c.dataset.arg);
  }
  updateLabels();
}
function safeName() {
  const name = $("filename").value.trim().replace(/[^A-Za-z0-9._-]/g, "_") || "program.c";
  return name.endsWith(".c") ? name : name + ".c";
}
function analyserArgs() {
  const a = getArgs();
  return a.length ? [`-args=${a.join(",")}`] : [];
}
function updateLabels() {
  $("editor-label").textContent = safeName();
  $("cmdline").textContent = ["$ forester", ...analyserArgs(), safeName()].join(" ");
}
$("filename").addEventListener("input", updateLabels);
document.querySelectorAll("[data-arg]").forEach((c) => c.addEventListener("change", updateLabels));

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(text) {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
async function pack(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return b64url(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function unpack(text) {
  const stream = new Blob([unb64url(text)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

$("share").addEventListener("click", async () => {
  const params = new URLSearchParams();
  if (exampleSel.value) params.set("example", exampleSel.value);
  else {
    params.set("code", await pack(editor.getValue()));
    params.set("file", safeName());
    if (getArgs().length) params.set("args", getArgs().join(","));
  }
  const url = `${location.origin}${location.pathname}#${params}`;
  history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url);
    flash($("share"), "Copied");
  } catch {
    flash($("share"), "Link in address bar");
  }
});
function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = old), 1500);
}

async function fromHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get("example") && (await selectExample(params.get("example")))) return;
  if (params.get("code")) {
    try {
      editor.setValue(await unpack(params.get("code")));
      $("filename").value = params.get("file") || "program.c";
      setArgs((params.get("args") || "").split(",").filter(Boolean), true);
      return;
    } catch { /* fall through to the default program */ }
  }
  editor.setValue(DEFAULT_CODE);
  updateLabels();
}

// ---------------------------------------------------------------------------------------------
// Running Forester in a worker

let worker = null, ready = false, running = false, timerId = null, startedAt = 0;
const runBtn = $("run");

function newWorker() {
  worker = new Worker("worker.js");
  ready = false;
  worker.onmessage = (e) => handle(e.data);
  worker.onerror = (e) => { finish(); showFailure(e.message || "the analyser crashed"); };
}

function setVerdict(cls, text) {
  const v = $("verdict");
  v.className = `verdict ${cls}`;
  v.textContent = text;
}

function startTimer(label) {
  startedAt = performance.now();
  clearInterval(timerId);
  timerId = setInterval(() => {
    $("timer").textContent = `${label} ${((performance.now() - startedAt) / 1000).toFixed(1)} s`;
  }, 100);
}

function finish() {
  running = false;
  clearInterval(timerId);
  runBtn.textContent = "Run Forester";
  runBtn.classList.remove("stop");
}

function run() {
  if (running) { stop(); return; }
  if (!worker) newWorker();
  running = true;
  clearMarks();
  HeapView.clear();
  runBtn.textContent = "Stop";
  runBtn.classList.add("stop");
  updateLabels();
  if (!ready) {
    setVerdict("busy", "downloading the analyser…");
    $("output").textContent = "";
  } else {
    setVerdict("busy", "analysing…");
  }
  startTimer("");
  worker.postMessage({ type: "run", file: safeName(), code: editor.getValue(), args: analyserArgs() });
}

function stop() {
  worker.terminate();
  worker = null;
  finish();
  $("timer").textContent = "";
  setVerdict("idle", "stopped");
  $("output").textContent = "The analysis was stopped. Forester may not terminate on programs outside its scope (see below).";
}

function handle(msg) {
  if (msg.type === "progress") {
    const mb = (n) => (n / 1048576).toFixed(1);
    // with a compressed transfer, content-length is smaller than the data
    const text = msg.total && msg.loaded <= msg.total
      ? `downloading the analyser… ${mb(msg.loaded)} / ${mb(msg.total)} MB`
      : `downloading the analyser… ${mb(msg.loaded)} MB`;
    setVerdict(running ? "busy" : "idle", text);
  } else if (msg.type === "ready") {
    ready = true;
    if (running) { setVerdict("busy", "analysing…"); startTimer(""); }
    else setVerdict("idle", "analyser ready");
  } else if (msg.type === "done") {
    ready = true;
    finish();
    $("timer").textContent = `${(msg.ms / 1000).toFixed(2)} s`;
    showResult(msg.lines, msg.status, msg.graphs || {});
  } else if (msg.type === "failed") {
    finish();
    showFailure(msg.error);
  }
}

function showFailure(text) {
  setVerdict("bug", "the analyser failed");
  $("output").textContent = text;
  worker && worker.terminate();
  worker = null;
}

const ANSI = /\x1b\[[0-9;]*m/g;
const DIAG = /^(?<file>[^:\s]+):(?<line>\d+):(?:(?<col>\d+):)? (?<kind>fatal error|error|warning|note): (?<msg>.*)$/;

// Forester's messages end with " [-fa]"; its internal log lines carry "[internal location]".
// Keeps the verdict and internal errors (with the internal path removed), drops the rest.
// The notes about written heap graphs become the states of the heap view.  "#58:~n" is register
// #58, which holds the C variable n (see wasm/patches/forester-var-names.patch).
function cleanLines(lines) {
  const out = [];
  let safe = false, internalError = false;
  const stripped = lines.map((l) => l.replace(ANSI, "").replace(/ \[-fa\]$/, "").replace(/(#\d+):~/g, "$1:"));
  const { lines: rest, states } = HeapView.extract(stripped);
  const trace = states.filter((s) => s.name.startsWith("trace-") && s.line).map((s) => s.line);
  for (const l of rest) {
    if (!l) continue;
    if (/The program is SAFE\./.test(l)) { safe = true; continue; }
    if (l.includes("[internal location]")) {
      const m = l.match(/: error: (.*?) \[internal location\]/);
      // a leak found when main() returns has no location: it is a verdict, not a failure
      if (m && /^garbage detected/.test(m[1])) out.push(`forester: error: ${m[1]} (when main returns)`);
      else if (m && !/has detected some errors/.test(m[1])) { out.push(`forester: error: ${m[1]}`); internalError = true; }
      continue;
    }
    if (/(^|: )(log|debug): /.test(l)) continue;
    out.push(l);
  }
  return { out, safe, internalError, trace, states };
}

function locLink(text, line, col) {
  const a = document.createElement("a");
  a.className = "loc";
  a.href = "#";
  a.textContent = text;
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    editor.focus();
    editor.setCursor({ line: line - 1, ch: Math.max(0, (col || 1) - 1) });
    editor.scrollIntoView(null, 120);
  });
  return a;
}

function showResult(rawLines, status, graphs) {
  const { out: lines, safe, internalError, trace, states } = cleanLines(rawLines);
  const out = $("output");
  out.textContent = "";
  let errors = 0;
  const file = safeName();
  const marked = new Set();
  for (const text of lines) {
    const row = document.createElement("div");
    const m = text.match(DIAG);
    if (m) {
      const { line, kind, msg } = m.groups;
      const kindCls = kind === "fatal error" ? "error" : kind;
      const locText = text.slice(0, text.indexOf(kind + ":"));
      const loc = m.groups.file === file ? locLink(locText, Number(line), Number(m.groups.col)) : document.createElement("span");
      if (m.groups.file !== file) { loc.className = "loc"; loc.textContent = locText; }
      const k = document.createElement("span");
      k.className = kindCls;
      k.textContent = `${kind}:`;
      row.append(loc, k, ` ${msg}`);
      if (kindCls === "error") errors++;
      if ((kindCls === "error" || kindCls === "warning") && m.groups.file === file) {
        const key = `${line}|${kindCls}|${msg}`;
        if (!marked.has(key)) { marked.add(key); markLine(Number(line), kindCls, msg); }
      }
    } else {
      row.textContent = text;
      if (/: error: /.test(text)) { row.className = "error-row"; errors++; }
    }
    out.appendChild(row);
  }
  if (safe) {
    const row = document.createElement("div");
    row.className = "quiet";
    row.textContent = "The program is SAFE.";
    out.appendChild(row);
  }
  if (trace.length) {
    // consecutive duplicates come from several microinstructions on one line
    const steps = trace.filter((l, i) => i === 0 || l !== trace[i - 1]);
    const row = document.createElement("div");
    row.className = "trace";
    row.append(`error trace (${steps.length} steps, by line): `);
    steps.forEach((l, i) => {
      if (i) row.append(" → ");
      row.append(locLink(String(l), l));
    });
    out.appendChild(row);
  }
  HeapView.show(states, graphs);
  if (status === 3) {
    setVerdict("bug", "does not compile");
  } else if (status !== 0) {
    setVerdict("bug", `the analyser failed (status ${status})`);
  } else if (safe) {
    setVerdict("safe", "verified · the program is SAFE");
  } else if (internalError) {
    setVerdict("unk", "no verdict · not supported by Forester");
  } else if (errors) {
    setVerdict("bug", "bug found");
  } else {
    setVerdict("unk", "no verdict");
    if (!lines.length) out.innerHTML = '<span class="quiet">(no output)</span>';
  }
}

runBtn.addEventListener("click", run);

// ---------------------------------------------------------------------------------------------
// Forester's heap graphs, simplified for reading
//
// A graph is a forest automaton: one cluster per tree automaton (TA k), in it one cluster per
// state; ellipses are nodes (a stack frame "fnc:line", a struct, the global variables), boxes
// below them are their fields, red boxes are data values and references to other trees.  The
// simplified view hides the stack slots of unnamed temporaries, Forester's own slots (_pABP,
// _retaddr), the values that only those point to, and then the clusters that became empty.

const HIDDEN_FIELDS = new Set(["", "_pABP", "_retaddr", "__fake_global__"]);
const NODE = /^\s*"([^"]+)" \[shape=(\w+), style=filled, fillcolor=(\w+), label="((?:[^"\\]|\\.)*)"\];$/;
const EDGE = /^\s*"([^"]+)" -> "([^"]+)"/;

function simplifyFA(dot) {
  const lines = dot.split("\n");
  const nodes = new Map(), edges = [];
  for (const l of lines) {
    let m = l.match(NODE);
    if (m) { nodes.set(m[1], { shape: m[2], fill: m[3], label: m[4] }); continue; }
    m = l.match(EDGE);
    if (m) edges.push([m[1], m[2]]);
  }
  const gone = new Set();
  for (const [id, n] of nodes) if (n.fill === "pink" && HIDDEN_FIELDS.has(n.label)) gone.add(id);
  for (let changed = true; changed;) {
    changed = false;
    const live = edges.filter(([a, b]) => !gone.has(a) && !gone.has(b));
    const hasIn = new Set(live.map((e) => e[1])), hasOut = new Set(live.map((e) => e[0]));
    for (const [id, n] of nodes) {
      if (gone.has(id)) continue;
      const orphanValue = n.fill === "red" && !hasIn.has(id);
      const emptyGlobals = n.label === "__global_vars_block" && !hasOut.has(id);
      if (orphanValue || emptyGlobals) { gone.add(id); changed = true; }
    }
  }
  // drop the lines of removed nodes and edges, then the clusters left without nodes
  const stack = [[]];
  for (const l of lines) {
    let m = l.match(NODE);
    if (m && gone.has(m[1])) continue;
    m = l.match(EDGE);
    if (m && (gone.has(m[1]) || gone.has(m[2]))) continue;
    if (/^\s*subgraph /.test(l)) { stack.push({ lines: [l], hasNode: false }); continue; }
    if (/^\s*}\s*$/.test(l) && stack.length > 1) {
      const sg = stack.pop();
      sg.lines.push(l);
      const parent = stack[stack.length - 1];
      if (sg.hasNode) {
        (Array.isArray(parent) ? parent : parent.lines).push(...sg.lines);
        if (!Array.isArray(parent)) parent.hasNode = true;
      }
      continue;
    }
    const top = stack[stack.length - 1];
    if (Array.isArray(top)) top.push(l);
    else { top.lines.push(l); if (NODE.test(l)) top.hasNode = true; }
  }
  return stack[0].join("\n")
    .replace(/bgcolor=green/g, 'bgcolor="#eef4ea"')
    .replace(/bgcolor=orange/g, 'bgcolor="#fbf3e4"')
    .replace(/fillcolor=pink/g, "fillcolor=white")
    .replace(/fillcolor=red/g, 'fillcolor="#fde0d9"')
    .replace(/fillcolor=lightblue/g, 'fillcolor="#dbe6ff"');
}

HeapView.init({ editor, simplify: simplifyFA });

(async () => {
  await loadExamples();
  await fromHash();
  // start downloading the analyser right away
  newWorker();
  worker.postMessage({ type: "load" });
})();
