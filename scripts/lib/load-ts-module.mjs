// Offline-only TS loader. Never falls back to Node resolution or application imports.
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

export async function loadTsModule(entry, { allowedFiles, stubs = {}, sources = {}, globals = {} }) {
  if (!vm.SourceTextModule) throw new Error("Run Node 22 with --experimental-vm-modules");
  const allowed = new Set(allowedFiles.map((file) => path.resolve(file)));
  const overrides = new Map(Object.entries(sources).map(([file, text]) => [path.resolve(file), text]));
  // No process, require, network, filesystem or production environment in the VM.
  const context = vm.createContext({ Date, console, ...globals });
  const modules = new Map();
  async function getModule(id) {
    if (modules.has(id)) return modules.get(id);
    if (Object.hasOwn(stubs, id)) {
      const exports = stubs[id];
      const mod = new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      }, { context, identifier: `offline-stub:${id}` });
      modules.set(id, mod);
      return mod;
    }
    if (!allowed.has(id)) throw new Error(`Offline loader blocked unstubbed import: ${id}`);
    const source = overrides.get(id) ?? await readFile(id, "utf8");
    const result = ts.transpileModule(source, {
      fileName: id,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      reportDiagnostics: true,
    });
    const errors = result.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (f) => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => "\n",
    }));
    const mod = new vm.SourceTextModule(result.outputText, {
      context, identifier: id,
      importModuleDynamically: async (specifier, referrer) => {
        const dependency = await resolve(specifier, referrer);
        if (dependency.status === "unlinked") await dependency.link(resolve);
        if (dependency.status === "linked") await dependency.evaluate();
        return dependency;
      },
    });
    modules.set(id, mod);
    return mod;
  }
  async function resolve(specifier, referrer) {
    if (Object.hasOwn(stubs, specifier)) return getModule(specifier);
    if (!specifier.startsWith(".")) throw new Error(`Offline loader blocked package: ${specifier}`);
    const target = path.resolve(path.dirname(referrer.identifier), specifier);
    return getModule(path.extname(target) ? target : `${target}.ts`);
  }
  const root = await getModule(path.resolve(entry));
  await root.link(resolve);
  await root.evaluate();
  return root.namespace;
}
