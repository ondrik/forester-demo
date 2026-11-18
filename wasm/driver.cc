// Forester in one process: clang (C -> LLVM IR, i386) + mem2reg + the passes of Code Listener's
// LLVM front-end (-lowerswitch -global-vars -nestedgep) + Forester itself (-fa):
//
//   clang -g -m32 -S -emit-llvm -Xclang -disable-O0-optnone file.c -o - |
//   opt -mem2reg -lowerswitch -load libpasses.so -global-vars -nestedgep -load libfa.so -fa
//
// mem2reg turns the local variables (allocas, which Forester does not support) into SSA values.
//
// Usage: forester FILE.c [Forester options, e.g. -args=print-trace]
//
// The clang resource headers are expected in /clang/include, the libc headers (musl, i386) in
// /usr/include and Forester's builtins in /forester (all embedded in the WebAssembly module).

#include "clang/Basic/DiagnosticOptions.h"
#include "clang/CodeGen/CodeGenAction.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/CompilerInvocation.h"
#include "clang/Frontend/TextDiagnosticPrinter.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/LegacyPassManager.h"
#include "llvm/IR/Module.h"
#include "llvm/AsmParser/Parser.h"
#include "llvm/Support/SourceMgr.h"
#include "llvm/Pass.h"
#include "llvm/PassInfo.h"
#include "llvm/PassRegistry.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Transforms/Utils.h"

#include <cstdlib>
#include <memory>
#include <string>
#include <vector>

using namespace llvm;

int main(int argc, char **argv) {
    if (argc < 2) {
        errs() << "usage: " << argv[0] << " FILE.c [Forester options]\n";
        return 2;
    }
    const std::string file = argv[1];
    std::string base = file.substr(file.find_last_of('/') + 1);
    // PREDATOR_ROOT prefixes the header directories (for testing a native build of this driver)
    const char *rootEnv = getenv("PREDATOR_ROOT");
    const std::string root = rootEnv ? rootEnv : "";
    const std::string resDir = root + "/clang", resInc = root + "/clang/include",
                      libcInc = root + "/usr/include", builtinsInc = root + "/forester";

    // 1. C -> LLVM IR
    std::vector<const char *> cc1 = {
        "-triple", "i386-unknown-linux-gnu",
        "-emit-llvm",
        // as the clang driver does: Forester crashes on (mem2reg'd) values with names
        "-discard-value-names",
        "-debug-info-kind=constructor", "-dwarf-version=5", "-debugger-tuning=gdb",
        "-disable-O0-optnone",
        "-nostdsysteminc",
        "-resource-dir", resDir.c_str(),
        "-internal-isystem", resInc.c_str(),
        "-internal-externc-isystem", libcInc.c_str(),
        "-I", builtinsInc.c_str(),
        "-D", "FORESTER",
        "-w",
        "-fgnuc-version=4.2.1",
        "-ferror-limit", "19",
        "-main-file-name", base.c_str(),
        "-x", "c", file.c_str(),
    };

    IntrusiveRefCntPtr<clang::DiagnosticOptions> diagOpts = new clang::DiagnosticOptions();
    auto *diagPrinter = new clang::TextDiagnosticPrinter(errs(), &*diagOpts);
    IntrusiveRefCntPtr<clang::DiagnosticIDs> diagIDs(new clang::DiagnosticIDs());
    clang::DiagnosticsEngine diags(diagIDs, &*diagOpts, diagPrinter);

    auto ci = std::make_unique<clang::CompilerInstance>();
    if (!clang::CompilerInvocation::CreateFromArgs(ci->getInvocation(), cc1, diags))
        return 2;
    ci->createDiagnostics();

    LLVMContext ctx, optCtx;  // optCtx: for the module as opt would read it
    clang::EmitLLVMOnlyAction act(&ctx);
    if (!ci->ExecuteAction(act))
        return 3;  // compilation errors were printed by clang
    std::unique_ptr<Module> mod = act.takeModule();
    if (!mod)
        return 3;

    // Round-trip the module through its textual form, exactly as in the clang | opt pipeline
    // above; the LLVM front-end of Code Listener relies on what the parser does to unnamed
    // values and basic blocks.
    {
        std::string text;
        raw_string_ostream os(text);
        mod->print(os, nullptr);
        os.flush();
        SMDiagnostic err;
        mod.reset();
        mod = parseAssemblyString(text, err, optCtx);
        if (!mod) {
            err.print("forester", errs());
            return 4;
        }
    }

    // 2. Forester's options (cl::opt in the LLVM front-end)
    std::vector<const char *> opts = {"forester", "-preserve-ec"};
    for (int i = 2; i < argc; ++i)
        opts.push_back(argv[i]);
    if (!cl::ParseCommandLineOptions(opts.size(), opts.data(), "Forester\n", &errs()))
        return 2;

    // 3. -mem2reg -lowerswitch -global-vars -nestedgep -fa
    PassRegistry &reg = *PassRegistry::getPassRegistry();
    legacy::PassManager pm;
    pm.add(createPromoteMemoryToRegisterPass());
    pm.add(createLowerSwitchPass());
    for (const char *name : {"global-vars", "nestedgep", "fa"}) {
        const PassInfo *info = reg.getPassInfo(StringRef(name));
        if (!info) {
            errs() << "internal error: pass '" << name << "' is not linked in\n";
            return 4;
        }
        pm.add(info->createPass());
    }
    pm.run(*mod);
    errs().flush();
    return 0;
}
