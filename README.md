# Verifying tree programs with Forester

A static page that shows how [Forester](https://www.fit.vut.cz/research/group/verifit/public/tools/forester/),
a shape analyser based on forest automata, finds memory-safety bugs in C programs with trees, skip lists,
nested lists and the Deutsch–Schorr–Waite traversal, and proves the fixed versions safe. The
[playground](playground/) runs Forester in the browser.

```
cases/*.c              the example programs (one per code version)
cases/results.json     Forester's recorded output, verdicts and times
build.py               the stories (prose + line ranges); renders template.html -> index.html
                       and playground/template.html -> playground/index.html
template.html, style.css
playground/            the in-browser playground (forester.wasm: clang 14 + Forester)
wasm/build.sh          builds playground/forester.{js,wasm}:  wasm/build.sh WORK_DIR
wasm/driver.cc         clang -> mem2reg -> lowerswitch, global-vars, nestedgep -> Forester, in one process
wasm/patches/          adapt Forester (2020) and a current Code Listener's LLVM front-end to each other
wasm/run-cases.mjs     records cases/results.json with the wasm build:  node wasm/run-cases.mjs [--check]
```

Forester was developed as a GCC plug-in in the [Predator repository](https://github.com/kdudka/predator)
until 2020 (`fa/`, last in 306ddb3c). This build combines that version with a current Code Listener,
whose LLVM front-end works with LLVM 14, and the patches in `wasm/patches/`:

- `cl-parallel-phi.patch`: assign the values of phi nodes in parallel (after `mem2reg`, loops that swap
  pointers have phi nodes that read each other).
- `forester-llvm.patch`: treat `char *` like `void *` when a `malloc`'d block gets its type; keep
  pointer-typed temporaries in the stack frame so the nodes they point to are not garbage; support `i8`
  constants and Boolean xor; recognise `__VERIFIER_nondet_int`; fix the nesting of a CMake macro.
- `forester-var-names.patch`: label the registers that hold C variables with those variables' names
  (from `llvm.dbg.value`, prefixed by `~`), so heap graphs and notes show `n` rather than an empty name.

The playground shows the heap graphs that Forester writes (`playground/heapview.js`, drawn with
[viz.js](https://github.com/mdaines/viz-js)): one per step of the error trace with `print-trace`, and
one per call of `__VERIFIER_plot("name")`. By default it hides the stack slots of unnamed temporaries.

Rebuild after changing a program or a story:

```shell
wasm/build.sh ~/forester-wasm     # once; the LLVM part takes a few hours
node wasm/run-cases.mjs
python3 build.py
```

`index.html` is generated but committed, so GitHub Pages can serve the repository as it is.
