import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));

const nodeBuiltinIds = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

/**
 * Rollup plugin that resolves Node built-in imports to an empty stub module.
 * The UI transitively imports server-only code (logging, config/paths) that
 * references Node APIs.  Instead of externalising them (which makes the browser
 * try to fetch "node:fs" as a script), we replace them with an empty ES module
 * so Rollup can tree-shake the dead code away.
 */
function stubNodeBuiltins(): Plugin {
  const STUB_PREFIX = "\0node-builtin-stub:";
  return {
    name: "stub-node-builtins",
    enforce: "pre",
    resolveId(source) {
      if (nodeBuiltinIds.has(source)) {
        return `${STUB_PREFIX}${source}`;
      }
    },
    load(id) {
      if (!id.startsWith(STUB_PREFIX)) {
        return;
      }
      const mod = id.slice(STUB_PREFIX.length);
      const bare = mod.startsWith("node:") ? mod.slice(5) : mod;
      // Resolve the real Node module to discover its export names so the stub
      // can re-export matching noops.  This runs at build time in Node.
      try {
        const real = require(bare);
        const names = Object.keys(real).filter((k) => k !== "default");
        const lines = [
          "const noop = () => {};",
          "const stub = new Proxy({}, { get: () => noop });",
          "export default stub;",
          ...names.map((n) => `export const ${n} = noop;`),
        ];
        return lines.join("\n");
      } catch {
        return "const noop = () => {}; export default noop;";
      }
    },
  };
}

function normalizeBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed === "./") {
    return "./";
  }
  if (trimmed.endsWith("/")) {
    return trimmed;
  }
  return `${trimmed}/`;
}

export default defineConfig(() => {
  const envBase = process.env.OPENCLAW_CONTROL_UI_BASE_PATH?.trim();
  const base = envBase ? normalizeBase(envBase) : "./";
  return {
    base,
    publicDir: path.resolve(here, "public"),
    plugins: [stubNodeBuiltins()],
    optimizeDeps: {
      include: ["lit/directives/repeat.js"],
    },
    define: {
      // Server-only code that leaks into the bundle references process globals.
      // Provide browser-safe stubs so the dead code doesn't throw at runtime.
      "process.env": "{}",
      "process.argv": "[]",
      "process.platform": JSON.stringify("browser"),
    },
    build: {
      outDir: path.resolve(here, "../dist/control-ui"),
      emptyOutDir: true,
      sourcemap: true,
      // Keep CI/onboard logs clean; current control UI chunking is intentionally above 500 kB.
      chunkSizeWarningLimit: 1024,
      rollupOptions: {
        output: {
          // Inject a process.cwd shim at the top of every chunk.  Rollup's
          // `intro` string is prepended inside the module wrapper so it
          // executes within the same <script type="module"> and is allowed
          // by CSP script-src 'self'.
          intro: "if(typeof process==='undefined')globalThis.process={cwd(){return'/'},env:{},argv:[],platform:'browser'};",
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
    },
    plugins: [
      {
        name: "control-ui-dev-stubs",
        configureServer(server) {
          server.middlewares.use("/__openclaw/control-ui-config.json", (_req, res) => {
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                basePath: "/",
                assistantName: "",
                assistantAvatar: "",
                assistantAgentId: "",
              }),
            );
          });
        },
      },
    ],
  };
});
