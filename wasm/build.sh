#!/usr/bin/env bash
# Builds Forester + Code Listener's LLVM front-end + clang 14 into one WebAssembly module for the
# playground:  playground/forester.js, playground/forester.wasm
#
# Forester is taken from the last revision of kdudka/predator that still contained it (fa/ in
# 306ddb3c, 2020).  Code Listener (cl/) comes from a current revision, whose LLVM front-end works
# with LLVM 14.  wasm/patches/ adapt both to each other, see the comments in the patches.
#
# Usage: wasm/build.sh WORK_DIR
#
# WORK_DIR receives the sources and the builds (about 15 GB).  Needs: git, curl, cmake, ninja,
# a host C++ compiler (for LLVM's tablegen) and Boost headers in /usr/include/boost.  emsdk is
# installed into WORK_DIR.  The LLVM build takes a few hours on 4 cores; re-running the script
# skips the steps that are already done.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$(mkdir -p "${1:?usage: $0 WORK_DIR}" && cd "$1" && pwd)"
JOBS="${JOBS:-$(nproc)}"

LLVM_VERSION=14.0.6
EMSDK_VERSION="${EMSDK_VERSION:-latest}"
PREDATOR_REPO=https://github.com/kdudka/predator.git
CL_REV="${CL_REV:-15eb53c6}"         # Code Listener (cl/, include/cl/)
FORESTER_REV="${FORESTER_REV:-306ddb3c}"  # Forester (fa/, include/forester-builtins/)
PASSES_REPO=https://github.com/VeriFIT/ProStatA.git
MUSL_VERSION=1.2.5

cd "$W"

# --- emsdk -----------------------------------------------------------------------------------
if [ ! -d emsdk ]; then
    git clone -q --depth 1 https://github.com/emscripten-core/emsdk.git
    emsdk/emsdk install "$EMSDK_VERSION"
    emsdk/emsdk activate "$EMSDK_VERSION"
fi
# shellcheck disable=SC1091
source emsdk/emsdk_env.sh >/dev/null 2>&1

# --- sources ---------------------------------------------------------------------------------
LLVM_SRC="$W/llvm-project-$LLVM_VERSION.src"
if [ ! -d "$LLVM_SRC" ]; then
    curl -sL "https://github.com/llvm/llvm-project/releases/download/llvmorg-$LLVM_VERSION/llvm-project-$LLVM_VERSION.src.tar.xz" | tar xJ
    # std::is_pod is gone from recent libc++ (used by emscripten)
    sed -i 's/std::is_pod</std::is_trivial</g' \
        "$LLVM_SRC/llvm/include/llvm/Demangle/ItaniumDemangle.h" \
        "$LLVM_SRC/llvm/lib/ProfileData/RawMemProfReader.cpp" \
        "$LLVM_SRC/llvm/lib/MC/MCSchedule.cpp"
    sed -i '0,/^#include <cassert>/s//#include <cassert>\n#include <type_traits>/' \
        "$LLVM_SRC/llvm/include/llvm/Demangle/ItaniumDemangle.h"
fi
[ -d predator-git ] || git clone -q --bare "$PREDATOR_REPO" predator-git
if [ ! -d forester-src ]; then
    mkdir forester-src
    git -C predator-git archive "$CL_REV" cl include/cl build-aux | tar x -C forester-src
    git -C predator-git archive "$FORESTER_REV" fa include/forester-builtins | tar x -C forester-src
    echo "#define CL_GIT_SHA1 \"$(git -C predator-git rev-parse "$CL_REV")\"" > forester-src/cl/version_cl.h
    for p in "$ROOT"/wasm/patches/*.patch; do patch -s -d forester-src -p1 < "$p"; done
fi
SRC="$W/forester-src"
[ -d passes ] || git clone -q --depth 1 "$PASSES_REPO" passes
if [ ! -d "musl-$MUSL_VERSION" ]; then
    curl -sL "https://musl.libc.org/releases/musl-$MUSL_VERSION.tar.gz" | tar xz
fi

# --- LLVM + clang for wasm (static libraries) ------------------------------------------------
if [ ! -x native/bin/clang-tblgen ]; then
    cmake -G Ninja -S "$LLVM_SRC/llvm" -B native -DCMAKE_BUILD_TYPE=Release \
        -DLLVM_ENABLE_PROJECTS=clang -DLLVM_TARGETS_TO_BUILD=X86
    ninja -C native -j"$JOBS" llvm-tblgen clang-tblgen
fi
if [ ! -f llvm-wasm/build.ninja ]; then
    emcmake cmake -G Ninja -S "$LLVM_SRC/llvm" -B llvm-wasm \
        -DCMAKE_BUILD_TYPE=MinSizeRel -DLLVM_ENABLE_PROJECTS=clang -DLLVM_TARGETS_TO_BUILD=WebAssembly \
        -DLLVM_TABLEGEN="$W/native/bin/llvm-tblgen" -DCLANG_TABLEGEN="$W/native/bin/clang-tblgen" \
        -DLLVM_HOST_TRIPLE=wasm32-unknown-emscripten -DLLVM_DEFAULT_TARGET_TRIPLE=x86_64-unknown-linux-gnu \
        -DLLVM_ENABLE_THREADS=OFF -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF \
        -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_UTILS=OFF -DLLVM_BUILD_TOOLS=OFF \
        -DCLANG_BUILD_TOOLS=OFF -DCLANG_INCLUDE_TESTS=OFF -DCLANG_INCLUDE_DOCS=OFF -DLLVM_INCLUDE_DOCS=OFF \
        -DCLANG_ENABLE_ARCMT=OFF -DCLANG_ENABLE_STATIC_ANALYZER=OFF -DLLVM_ENABLE_TERMINFO=OFF \
        -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_LIBXML2=OFF -DLLVM_ENABLE_LIBEDIT=OFF -DLLVM_ENABLE_PIC=OFF \
        -DLLVM_ENABLE_BINDINGS=OFF -DLLVM_ENABLE_LIBPFM=OFF \
        -DCMAKE_CXX_FLAGS="-Wno-everything" -DCMAKE_C_FLAGS="-Wno-everything"
fi
[ -n "${SKIP_LLVM:-}" ] || ninja -C llvm-wasm -j"$JOBS" clangCodeGen clangFrontend clangDriver LLVMTransformUtils LLVMIRReader LLVMBitWriter

# CrashRecoveryContext is the only LLVM object with setjmp/longjmp: rebuild it with wasm-native
# setjmp/longjmp, which (unlike Emscripten's JS-based one) can be linked with -fwasm-exceptions
CRC=lib/Support/CMakeFiles/LLVMSupport.dir/CrashRecoveryContext.cpp.o
if [ ! -f llvm-wasm/crc-wasm-sjlj.stamp ] || [ llvm-wasm/$CRC -nt llvm-wasm/crc-wasm-sjlj.stamp ]; then
    cmd="$(ninja -C llvm-wasm -t commands $CRC | tail -1)"
    (cd llvm-wasm && eval "$cmd -fwasm-exceptions -sSUPPORT_LONGJMP=wasm")
    (cd llvm-wasm && emar r lib/libLLVMSupport.a $CRC)
    touch llvm-wasm/crc-wasm-sjlj.stamp
fi

# --- Forester + Code Listener + passes for wasm --------------------------------------------------------------
OBJ="$W/forester-wasm"
mkdir -p "$OBJ/boost-inc"
ln -sfn /usr/include/boost "$OBJ/boost-inc/boost"
LLVM_INC=(-isystem "$LLVM_SRC/llvm/include" -isystem "$W/llvm-wasm/include"
          -isystem "$LLVM_SRC/clang/include" -isystem "$W/llvm-wasm/tools/clang/include")
DEFS=(-D_GNU_SOURCE -D__STDC_CONSTANT_MACROS -D__STDC_FORMAT_MACROS -D__STDC_LIMIT_MACROS
      -DNDEBUG -DHAVE_ISATTY=0)
CXXFLAGS=(-O2 -std=c++17 -fwasm-exceptions -Wno-everything "${DEFS[@]}" -include cstdlib -include cstring -include iterator -include algorithm -include functional
          -isystem "$SRC/include" -isystem "$OBJ/boost-inc" "${LLVM_INC[@]}")

compile() {  # compile SRC OUT [extra flags...]
    local src="$1" out="$2"; shift 2
    if [ ! -f "$out" ] || [ "$src" -nt "$out" ]; then
        case "$src" in
            *.c) emcc -O2 -std=gnu99 -Wno-everything "${DEFS[@]}" -isystem "$SRC/include" -c "$src" -o "$out" ;;
            *)   em++ "${CXXFLAGS[@]}" "$@" -c "$src" -o "$out" ;;
        esac
    fi
    echo "$out"
}

OBJS=()
pids=()
build_obj() { OBJS+=("$2"); compile "$@" >/dev/null & pids+=($!); if [ ${#pids[@]} -ge "$JOBS" ]; then wait "${pids[0]}"; pids=("${pids[@]:1}"); fi; }

CL_SRCS=(builtins.cc callgraph.cc cl_chain.cc cl_dotgen.cc cl_easy.cc cl_factory.cc cl_locator.cc
         cl_pp.cc cl_storage.cc cl_typedot.cc cldebug.cc clf_intchk.cc clf_opchk.cc clf_unilabel.cc
         clf_unswitch.cc clutil.cc clplot.cc code_listener.cc killer.cc loopscan.cc memdebug.cc
         pointsto.cc pointsto_fics.cc ssd.cc stopwatch.cc storage.cc version.c)
FA_SRCS=($(sed -n '/^add_library(forester STATIC/,/)/p' "$SRC/fa/CMakeLists.txt" | grep -o '[a-z_]*\.cc'))
mkdir -p "$OBJ/cl" "$OBJ/fa" "$OBJ/passes"
# first: clplug.cc registers its pass under this name in a static initializer
printf '#include <string>\nstd::string plugName = "fa";\n' > "$OBJ/fa_name.cc"
build_obj "$OBJ/fa_name.cc" "$OBJ/fa_name.cc.o"
for s in "${CL_SRCS[@]}"; do build_obj "$SRC/cl/$s" "$OBJ/cl/$s.o"; done
build_obj "$SRC/cl/llvm/clplug.cc" "$OBJ/cl/clplug.cc.o" -fno-rtti
for s in "${FA_SRCS[@]}"; do build_obj "$SRC/fa/$s" "$OBJ/fa/$s.o"; done
for s in global_vars.cc elim_const_expr.cc nestedgep.cc; do
    build_obj "$W/passes/passes/$s" "$OBJ/passes/$s.o" -fno-rtti
done
build_obj "$ROOT/wasm/driver.cc" "$OBJ/driver.cc.o" -fno-rtti -std=c++17
for p in "${pids[@]}"; do wait "$p"; done

[ -z "${ONLY_OBJS:-}" ] || exit 0

# --- the virtual file system: headers ----------------------------------------------------------
FS="$OBJ/fs"
rm -rf "$FS" && mkdir -p "$FS/usr" "$FS/clang/include" "$FS/forester"
make -s -C "musl-$MUSL_VERSION" ARCH=i386 prefix="$FS/usr" install-headers
for h in stddef.h __stddef_max_align_t.h stdarg.h stdbool.h stdint.h limits.h float.h stdalign.h \
         stdnoreturn.h iso646.h varargs.h inttypes.h; do
    cp "$LLVM_SRC/clang/lib/Headers/$h" "$FS/clang/include/"
done
cp "$SRC/include/forester-builtins/verifier-builtins.h" "$FS/forester/"

# --- link --------------------------------------------------------------------------------------
LIBS=$(ls "$W"/llvm-wasm/lib/libclang*.a "$W"/llvm-wasm/lib/libLLVM*.a)
mkdir -p "$ROOT/playground"
em++ -O2 -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -o "$ROOT/playground/forester.js" "${OBJS[@]}" \
    -Wl,--start-group $LIBS -Wl,--end-group \
    -sMODULARIZE=1 -sEXPORT_NAME=createForester -sENVIRONMENT=worker,node \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=16MB \
    -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain \
    -sFILESYSTEM=1 --embed-file "$FS@/"
ls -la "$ROOT/playground/forester.js" "$ROOT/playground/forester.wasm"
