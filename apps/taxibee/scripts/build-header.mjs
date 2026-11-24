import { cp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { build } from "esbuild";

const customer = resolve("../customer");
const bridge = resolve("src/header");
const requireCustomer = createRequire(resolve(customer, "package.json"));
const postcss = requireCustomer("postcss");
const tailwind = requireCustomer("tailwindcss");
const tailwindConfig = requireCustomer("tailwindcss/loadConfig");

export async function buildHeader() {
  const aliases = new Map([
    ["next/link", ["navigation.tsx", "Link"]],
    ["next/navigation", ["navigation.tsx"]],
    ["next/dynamic", ["navigation.tsx", "dynamic"]],
  ]);
  const bridges = new Map([
    ["lib/api", "host.ts"],
    ["lib/auth-context", "host.ts"],
    ["lib/push", "host.ts"],
    ["components/Modal", "Modal.tsx"],
    ["components/home/home-font", "font.ts"],
    ["components/header-drawer/drawer-font", "font.ts"],
  ]);
  const result = await build({
    entryPoints: ["src/header/entry.tsx"],
    outfile: "dist/customer-header.js",
    bundle: true,
    minify: true,
    metafile: true,
    format: "iife",
    jsx: "automatic",
    target: "es2022",
    loader: { ".png": "dataurl" },
    external: ["/brand/*"],
    define: { "process.env.NEXT_PUBLIC_API_URL": '"/api"' },
    plugins: [{
      name: "taxibee-customer-header",
      setup(bundle) {
        bundle.onResolve({ filter: /^next\// }, ({ path }) => {
          const alias = aliases.get(path);
          if (alias) return { path, namespace: "taxibee-next" };
        });
        bundle.onLoad({ filter: /.*/, namespace: "taxibee-next" }, ({ path }) => {
          const [file, name] = aliases.get(path);
          return {
            contents: name ? `export { ${name} as default } from "./${file}";` : `export * from "./${file}";`,
            resolveDir: bridge,
          };
        });
        bundle.onResolve({ filter: /^\./ }, ({ path, resolveDir }) => {
          const absolute = resolve(resolveDir, path);
          for (const [source, file] of bridges) {
            if (absolute === resolve(customer, source)) return { path: resolve(bridge, file) };
          }
        });
        bundle.onResolve({ filter: /^(react(?:-dom)?(?:\/.*)?|lucide-react)$/ }, ({ path }) =>
          ({ path: requireCustomer.resolve(path) }));
        bundle.onResolve({ filter: /^@peebee\/shared$/ }, ({ importer }) => {
          if (["BrandHeader.tsx", "expanded.tsx"].includes(basename(importer))) {
            return { path: resolve(bridge, "practice.ts") };
          }
        });
      },
    }],
  });
  await cp(resolve(customer, "components/header-drawer/fonts/Roboto-Variable.ttf"), "dist/brand/header-roboto.ttf");

  const globals = postcss.parse(await readFile(resolve(customer, "app/globals.css"), "utf8"));
  const home = postcss.parse(await readFile(resolve(customer, "app/personalized-home.css"), "utf8"));
  const chrome = postcss.root();
  const include = /\.(?:customer-header|customer-drawer|customer-preview|customer-menu-catcher|ph-header|ph-brand-link|chat-drawer|app-stage|home-card|edge-carousel)(?:\b|_)/;
  for (const source of [globals, home]) {
    source.walkRules(rule => {
      const theme = rule.selector.startsWith(":root") && rule.nodes.some(node => node.prop?.startsWith("--color-"));
      if (!theme && !include.test(rule.selector)) {
        if (rule.selector !== ":root" && !rule.nodes.some(node => node.prop === "--chat-bg")) return;
        if (!rule.nodes.some(node => node.prop === "--chat-peek" || node.prop === "--chat-bg")) return;
      }
      if (rule.parent?.name === "keyframes") return;
      const copy = rule.clone();
      if (theme) {
        copy.selector = copy.selector.replaceAll(":root", ":root.taxibee-customer-chrome");
      } else {
        copy.selectors = copy.selectors.map(selector => selector.startsWith(":root")
          ? selector.replace(":root", ":root.taxibee-customer-chrome").replace(/ main\b/g, " #main-content")
          : selector.startsWith("html") ? selector.replace(/^html/, "html.taxibee-customer-chrome") : `.taxibee-customer-chrome ${selector}`);
      }
      if (rule.parent?.type === "atrule" && rule.parent.name === "media") {
        chrome.append(rule.parent.clone({ nodes: [copy] }));
      } else chrome.append(copy);
    });
  }
  const config = tailwindConfig(resolve(customer, "tailwind.config.ts"));
  const utilities = await postcss([tailwind({
    ...config,
    content: Object.keys(result.metafile.inputs).filter(path => /\.[jt]sx?$/.test(path) && !path.startsWith("taxibee-next:") && !path.includes("node_modules")),
    important: ':is(#taxibee-header-slot, .chat-drawer, .taxibee-header-dialog, [aria-label="Choose map location"])',
    corePlugins: { preflight: false },
  })]).process("@tailwind utilities;", { from: undefined });
  const bundled = await readFile("dist/customer-header.css", "utf8");
  await writeFile("dist/customer-header.css", `${utilities.css}\n${chrome}\n${bundled}`);
}
