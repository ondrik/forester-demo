#!/usr/bin/env python3
"""Builds index.html from template.html, the stories below, cases/*.c and cases/results.json.

Usage: python3 build.py          (run node wasm/run-cases.mjs first to refresh Forester's results)
"""
import difflib
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
REPO = "https://github.com/ondrik/forester-demo"

# Each story is a data structure; each step is a version of the program checked by Forester.
# "show" lists the line ranges displayed on the page (the whole file is one click away).
STORIES = [
    {
        "id": "tree-destroy",
        "title": "Destroying a binary tree without a stack",
        "tag": "binary tree",
        "intro": """<code>create()</code> grows a binary tree of unknown shape: each round of the loop
walks down a random path and hangs a new leaf on it. <code>destroy()</code> frees the tree without
recursion and without extra memory: it repeatedly walks down to some leaf and frees it. Forester
has to consider trees of every size and shape.""",
        "steps": [
            {
                "case": "tree-destroy",
                "label": "Freeing a leaf",
                "show": [(34, 47)],
                "after": """The leaf is freed, but its parent still points to it. In the next round, the
walk down from the root follows that dangling link, and the pointer that line 39 dereferences
is no longer valid. Forester reports it on the first tree where this happens.""",
            },
            {
                "case": "tree-destroy-fixed",
                "label": "The fix: unlink the leaf from its parent",
                "show": [(34, 51)],
                "after": """With the link cleared, the parent becomes a leaf itself, and the loop frees
the tree bottom-up. <i>The program is SAFE</i>: no invalid dereference and no garbage, for trees
of any shape.""",
            },
        ],
    },
    {
        "id": "tree-stack",
        "title": "A tree and a stack together",
        "tag": "tree + list",
        "intro": """A common way to avoid recursion: keep the nodes still to be visited on an explicit
stack, here a singly linked list of items that point into the tree. The heap now holds two
different structures that point into each other.""",
        "steps": [
            {
                "case": "tree-stack",
                "label": "Freeing the node too early",
                "show": [(46, 62)],
                "after": """The node is freed between pushing its two children, so line 59 reads
<code>n-&gt;right</code> from freed memory. The bug needs a node with a right child, and
Forester finds one.""",
            },
            {
                "case": "tree-stack-fixed",
                "label": "The fix: push both children first",
                "show": [(46, 62)],
                "after": """Both children are on the stack before <code>free(n)</code>. Forester
verifies the combination of the tree and the list of stack items.""",
            },
        ],
    },
    {
        "id": "skiplist",
        "title": "Inserting into a skip list",
        "tag": "skip list",
        "intro": """A skip list keeps its nodes on several linked levels. Every node is on level 1,
and some are also on level 2, so a search can skip ahead. Each level is an ordinary list, but the
levels share their nodes, so the heap is neither a list nor a tree. <code>insert()</code> adds a
node at an arbitrary position with an arbitrary height.""",
        "steps": [
            {
                "case": "skiplist",
                "label": "Tall nodes only on the upper level",
                "show": [(26, 60)],
                "after": """The tall nodes are linked into level 2 but not into level 1, and their
<code>next1</code> is never set. Forester reports a run in which line 55 reads such an
uninitialised <code>next1</code>. Even without that, <code>destroy()</code> walks level 1 only
and would leak the tall nodes.""",
            },
            {
                "case": "skiplist-fixed",
                "label": "The fix: every node on level 1",
                "show": [(26, 59)],
                "after": """Every new node goes to level 1, and tall ones also to level 2. Forester
verifies the insertion and the destruction for skip lists of any length and any mix of
heights.""",
            },
        ],
    },
    {
        "id": "list-of-lists",
        "title": "Freeing a list of lists",
        "tag": "nested lists",
        "intro": """A hash table with chaining, reduced to its shape: an outer list of buckets, each
with its own inner list of items. The inner lists have unknown lengths, and so does the outer
one.""",
        "steps": [
            {
                "case": "list-of-lists",
                "label": "Freeing only the buckets",
                "show": [(33, 46)],
                "after": """<code>free(b)</code> drops the last pointer to the bucket's items. Forester
reports <i>garbage detected</i>: memory that is still allocated but can no longer be reached,
that is, a leak.""",
            },
            {
                "case": "list-of-lists-fixed",
                "label": "The fix: free the items first",
                "show": [(33, 51)],
                "after": """With the inner loop, every item is freed before its bucket. In the abstract
heaps, Forester represents the inner lists by a <i>box</i>, a reusable automaton for a repeated
substructure, which it finds automatically.""",
            },
        ],
    },
    {
        "id": "dsw",
        "title": "Deutsch–Schorr–Waite tree traversal",
        "tag": "pointer reversal",
        "intro": """The Deutsch–Schorr–Waite algorithm visits every node of a tree without a stack
and without recursion: it rotates the child pointers of each node so that they temporarily
point back up. After three visits, each node has its original children again. Garbage collectors
use it because it needs no extra memory. It is also a classic challenge for verification
tools, because during the traversal the heap does not look like a tree at all. This is the
variant by Lindstrom, with a sentinel node.""",
        "steps": [
            {
                "case": "tree-dsw",
                "label": "One assignment out of order",
                "show": [(32, 54)],
                "after": """Line 43 overwrites <code>n-&gt;left</code> before it is saved in
<code>succ</code>, so the left subtree loses its only pointer as soon as it is not empty:
<i>garbage detected</i>.""",
            },
            {
                "case": "tree-dsw-fixed",
                "label": "Save, rotate, move",
                "show": [(32, 54)],
                "after": """The correct rotation. Forester verifies the whole program: building a tree
of any shape, the traversal with its reversed pointers, and the destruction with an explicit
stack.""",
            },
        ],
    },
]

C_KEYWORDS = {"struct", "int", "char", "void", "return", "while", "for", "if", "else", "static",
              "extern", "sizeof", "typeof", "size_t", "NULL"}
C_TOKEN = re.compile(r"""(?P<comment>/\*.*?\*/|//[^\n]*)|(?P<pre>^\s*#\s*\w+)|(?P<string>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(?P<word>\b[A-Za-z_]\w*\b)""", re.M)


def highlight_c(line):
    out, pos = [], 0
    for m in C_TOKEN.finditer(line):
        out.append(html.escape(line[pos:m.start()]))
        text = html.escape(m.group())
        kind = m.lastgroup
        if kind == "comment":
            out.append(f'<span class="c">{text}</span>')
        elif kind == "pre":
            out.append(f'<span class="k">{text}</span>')
        elif kind == "string":
            out.append(f'<span class="s">{text}</span>')
        elif m.group() in C_KEYWORDS:
            out.append(f'<span class="k">{text}</span>')
        elif m.group() in ("malloc", "free", "abort") or m.group().startswith("__VERIFIER"):
            out.append(f'<span class="f">{text}</span>')
        else:
            out.append(text)
        pos = m.end()
    out.append(html.escape(line[pos:]))
    return "".join(out)


DIAG = re.compile(r"^(?P<file>[^:]+):(?P<line>\d+):(?:(?P<col>\d+):)? (?P<kind>error|warning|note): (?P<msg>.*)$")


def diagnostics(output):
    """Returns {line: [(kind, message)]} for the source lines that Forester's report points at."""
    marks = {}
    for text in output:
        m = DIAG.match(text)
        if m:
            entry = (m["kind"], m["msg"])
            if entry not in marks.setdefault(int(m["line"]), []):
                marks[int(m["line"])].append(entry)
    return marks


def changed_lines(old, new):
    """1-based numbers of the lines of `new` that differ from `old`."""
    changed = set()
    matcher = difflib.SequenceMatcher(a=old, b=new, autojunk=False)
    for tag, _, _, j1, j2 in matcher.get_opcodes():
        if tag in ("replace", "insert"):
            changed.update(range(j1 + 1, j2 + 1))
    return changed


def render_code(lines, show, marks, changed):
    rows = []
    for i, (start, end) in enumerate(show):
        if i or start > 1:
            rows.append('<div class="ln gap"><span class="no">⋮</span><span class="tx"></span></div>')
        for no in range(start, min(end, len(lines)) + 1):
            kinds = [k for k, _ in marks.get(no, [])]
            cls = "ln"
            if "error" in kinds:
                cls += " err"
            elif "warning" in kinds:
                cls += " warn"
            elif "note" in kinds:
                cls += " noteline"
            if no in changed:
                cls += " add"
            rows.append(f'<div class="{cls}"><span class="no">{no}</span>'
                        f'<span class="tx">{highlight_c(lines[no - 1]) or " "}</span></div>')
            for kind, msg in marks.get(no, []):
                if kind in ("error", "warning"):
                    rows.append(f'<div class="callout {kind}"><span class="no"></span>'
                                f'<span class="tx">▲ {kind}: {html.escape(msg)}</span></div>')
        if end < len(lines) and i == len(show) - 1:
            rows.append('<div class="ln gap"><span class="no">⋮</span><span class="tx"></span></div>')
    return "".join(rows)


def render_output(output, verdict="safe"):
    if not output:
        if verdict == "safe":
            return '<span class="quiet">The program is SAFE.</span>'
        return '<span class="quiet">(no diagnostics)</span>'
    out = []
    for text in output:
        m = DIAG.match(text)
        if m:
            out.append(f'<span class="loc">{html.escape(text[:m.start("kind")])}</span>'
                       f'<span class="{m["kind"]}">{m["kind"]}:</span> {html.escape(m["msg"])}')
        else:
            out.append(html.escape(text))
    return "\n".join(out)


def render_step(number, step, previous, results):
    path = ROOT / "cases" / f"{step['case']}.c"
    lines = path.read_text().splitlines()
    result = results[step["case"]]
    marks = diagnostics(result["output"])
    changed = changed_lines(previous, lines) if previous is not None else set()
    if result["verdict"] == "bug":
        badge = '<span class="verdict bug">bug found</span>'
    elif result["verdict"] == "safe":
        badge = '<span class="verdict safe">verified · the program is SAFE</span>'
    else:
        badge = '<span class="verdict unk">no verdict</span>'
    full = "\n".join(lines)
    return f"""
    <div class="step">
      <div class="step-head"><span class="num">{number}</span><h3>{html.escape(step['label'])}</h3>{badge}</div>
      <div class="pane">
        <div class="pane-label"><span>cases/{step['case']}.c</span>{'<span class="legend"><i class="add-key"></i>changed</span>' if changed else ''}</div>
        <div class="code">{render_code(lines, step['show'], marks, changed)}</div>
      </div>
      <div class="pane out">
        <div class="pane-label"><span>$ {html.escape(result['command'])}</span><span>{result['seconds']:.2f} s</span></div>
        <pre class="term">{render_output(result['output'], result['verdict'])}</pre>
      </div>
      <p class="after">{step['after']}</p>
      <a class="run" href="playground/#example={step['case']}">Open in the playground ↗</a>
      <details>
        <summary>Whole program <span class="file">{len(lines)} lines</span></summary>
        <pre class="full"><code>{"".join(highlight_c(l) + chr(10) for l in lines)}</code></pre>
      </details>
    </div>"""


def main():
    results_file = json.loads((ROOT / "cases" / "results.json").read_text())
    results = results_file["cases"]
    toc, body = [], []
    for story in STORIES:
        toc.append(f'<li><a href="#{story["id"]}">{html.escape(story["title"])}</a> <span class="cwe">{story["tag"]}</span></li>')
        steps, previous = [], None
        for i, step in enumerate(story["steps"]):
            steps.append(render_step(i + 1, step, previous, results))
            previous = (ROOT / "cases" / f"{step['case']}.c").read_text().splitlines()
        body.append(f"""
  <section class="story" id="{story['id']}">
    <div class="story-head">
      <span class="cwe">{story['tag']}</span>
      <h2><a href="#{story['id']}">{html.escape(story['title'])}</a></h2>
    </div>
    <p class="intro">{story['intro']}</p>
    {"".join(steps)}
  </section>""")
    used = {s["case"] for story in STORIES for s in story["steps"]}
    missing = used - results.keys()
    if missing:
        raise SystemExit(f"no results for {sorted(missing)}; run scripts/run-cases.sh")
    shown = [results[c] for c in used]
    page = (ROOT / "template.html").read_text()
    for key, value in {
        "TOC": "\n".join(toc),
        "STORIES": "\n".join(body),
        "TOTAL": str(len(shown)),
        "FOUND": str(sum(1 for r in shown if r["verdict"] == "bug")),
        "PROVED": str(sum(1 for r in shown if r["verdict"] == "safe")),
        "SLOWEST": f"{max(r['seconds'] for r in shown):.2f}",
        "FORESTER": html.escape(results_file["forester"]),
        "CL": html.escape(results_file["cl"]),
        "LLVM": html.escape(results_file["llvm"]),
        "REPO": REPO,
    }.items():
        page = page.replace("{{" + key + "}}", value)
    (ROOT / "index.html").write_text(page)
    print(f"index.html: {len(STORIES)} stories, {len(shown)} programs")
    build_playground(results_file)


def build_playground(results_file):
    examples = []
    for story in STORIES:
        for step in story["steps"]:
            first = (ROOT / "cases" / f"{step['case']}.c").read_text().splitlines()[0]
            m = re.match(r"/\* forester-args: (.*) \*/", first)
            examples.append({"id": step["case"], "story": story["title"], "label": step["label"],
                             "args": m.group(1).split(",") if m else []})
    (ROOT / "playground" / "examples.json").write_text(json.dumps(examples, indent=1) + "\n")
    wasm = ROOT / "playground" / "forester.wasm"
    size = f"{wasm.stat().st_size / 1e6:.0f} MB" if wasm.exists() else "40 MB"
    page = (ROOT / "playground" / "template.html").read_text()
    for key, value in {"SIZE": size, "FORESTER": html.escape(results_file["forester"]),
                       "CL": html.escape(results_file["cl"]), "LLVM": html.escape(results_file["llvm"]),
                       "REPO": REPO}.items():
        page = page.replace("{{" + key + "}}", value)
    (ROOT / "playground" / "index.html").write_text(page)
    print(f"playground/index.html: {len(examples)} examples, analyser {size}")


if __name__ == "__main__":
    main()
