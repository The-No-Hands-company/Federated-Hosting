import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const TEMPLATES: Record<string, {
  label:    string;
  desc:     string;
  files:    Record<string, string>;
  install?: string;
  dev?:     string;
  build?:   string;
  out?:     string;
}> = {
  html: {
    label: "Plain HTML",
    desc:  "Zero dependencies. index.html + CSS + JS. Deploy as-is.",
    files: {
      "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Site</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Hello from NexusHosting 🚀</h1>
    <p>Edit <code>index.html</code> and deploy with <code>nh deploy . --site &lt;id&gt;</code></p>
  </main>
  <script src="app.js"></script>
</body>
</html>`,
      "style.css": `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #0a0a0f; color: #e4e4f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
main { text-align: center; padding: 2rem; }
h1 { font-size: 2.5rem; margin-bottom: 1rem; }
p { color: #9ca3af; }
code { background: #1a1a26; padding: 0.2em 0.5em; border-radius: 4px; font-size: 0.9em; }`,
      "app.js":    `console.log("Site loaded ⚡");`,
      ".fh/config.json": `{"outputDir": "."}`,
    },
  },

  vite: {
    label: "Vite + React",
    desc:  "React 18, Vite 5, TypeScript. Build → dist/. Fast HMR in dev.",
    files: {
      "package.json": `{
  "name": "my-nexus-site",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { "@types/react": "^18.3.12", "@types/react-dom": "^18.3.1", "@vitejs/plugin-react": "^4.3.4", "typescript": "^5.7.3", "vite": "^6.0.7" }
}`,
      "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()] });`,
      "tsconfig.json": `{ "compilerOptions": { "target": "ES2022", "lib": ["ES2022","DOM","DOM.Iterable"], "module": "ESNext", "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true, "noEmit": true } }`,
      "index.html": `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Site</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`,
      "src/main.tsx": `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);`,
      "src/App.tsx": `export default function App() {
  return (
    <main style={{ fontFamily: "system-ui", background: "#0a0a0f", color: "#e4e4f0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "2rem" }}>
      <div>
        <h1 style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>Hello from NexusHosting 🚀</h1>
        <p style={{ color: "#9ca3af" }}>Edit <code>src/App.tsx</code> and run <code>nh deploy dist --site &lt;id&gt;</code></p>
      </div>
    </main>
  );
}`,
      ".fh/config.json": `{"buildCommand": "npm run build", "outputDir": "dist"}`,
      ".gitignore": "node_modules\ndist\n.env\n",
    },
    install: "npm install",
    dev:     "npm run dev",
    build:   "npm run build",
    out:     "dist",
  },

  astro: {
    label: "Astro",
    desc:  "Content-focused. Static output by default. Zero JS unless needed.",
    files: {
      "package.json": `{
  "name": "my-nexus-site",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "dev": "astro dev", "build": "astro build", "preview": "astro preview" },
  "dependencies": { "astro": "^5.2.0" }
}`,
      "astro.config.mjs": `import { defineConfig } from "astro/config";\nexport default defineConfig({});`,
      "src/pages/index.astro": `---
const title = "My NexusHosting Site";
---
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>{title}</title>
<style>body{font-family:system-ui;background:#0a0a0f;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}h1{font-size:2.5rem}p{color:#9ca3af}</style>
</head>
<body><h1>Hello from NexusHosting 🚀</h1><p>Edit <code>src/pages/index.astro</code></p></body>
</html>`,
      ".fh/config.json": `{"buildCommand": "npm run build", "outputDir": "dist"}`,
      ".gitignore": "node_modules\ndist\n.env\n",
    },
    install: "npm install",
    dev:     "npm run dev",
    build:   "npm run build",
    out:     "dist",
  },

  nextjs: {
    label: "Next.js (static export)",
    desc:  "Next.js 15 with static export. Full RSC + SSG. Deploy the out/ folder.",
    files: {
      "package.json": `{
  "name": "my-nexus-site",
  "version": "0.1.0",
  "scripts": { "dev": "next dev", "build": "next build", "start": "next start" },
  "dependencies": { "next": "^15.1.3", "react": "^19.0.0", "react-dom": "^19.0.0" },
  "devDependencies": { "@types/node": "^22", "@types/react": "^19", "typescript": "^5" }
}`,
      "next.config.ts": `import type { NextConfig } from "next";
const config: NextConfig = { output: "export" };
export default config;`,
      "app/page.tsx": `export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", background: "#0a0a0f", color: "#e4e4f0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>Hello from NexusHosting 🚀</h1>
        <p style={{ color: "#9ca3af" }}>Edit <code>app/page.tsx</code> and deploy the <code>out/</code> folder</p>
      </div>
    </main>
  );
}`,
      "app/layout.tsx": `export const metadata = { title: "My Site" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}`,
      "tsconfig.json": `{ "compilerOptions": { "lib": ["dom","esnext"], "module": "esnext", "moduleResolution": "bundler", "jsx": "preserve", "strict": true, "noEmit": true } }`,
      ".fh/config.json": `{"buildCommand": "npm run build", "outputDir": "out"}`,
      ".gitignore": "node_modules\n.next\nout\n.env\n",
    },
    install: "npm install",
    dev:     "npm run dev",
    build:   "npm run build",
    out:     "out",
  },

  svelte: {
    label: "SvelteKit (static)",
    desc:  "SvelteKit with static adapter. Minimal, fast, no virtual DOM.",
    files: {
      "package.json": `{
  "name": "my-nexus-site",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "dev": "vite dev", "build": "vite build", "preview": "vite preview" },
  "devDependencies": { "@sveltejs/adapter-static": "^3.0.8", "@sveltejs/kit": "^2.15.0", "svelte": "^5.17.3", "vite": "^6.0.7" }
}`,
      "svelte.config.js": `import adapter from "@sveltejs/adapter-static";
export default { kit: { adapter: adapter({ fallback: "404.html" }) } };`,
      "vite.config.ts": `import { sveltekit } from "@sveltejs/kit/vite";\nimport { defineConfig } from "vite";\nexport default defineConfig({ plugins: [sveltekit()] });`,
      "src/routes/+page.svelte": `<main>
  <h1>Hello from NexusHosting 🚀</h1>
  <p>Edit <code>src/routes/+page.svelte</code></p>
</main>
<style>
  main{font-family:system-ui;background:#0a0a0f;color:#e4e4f0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
  h1{font-size:2.5rem;margin-bottom:1rem}p{color:#9ca3af}
</style>`,
      "src/routes/+layout.ts": `export const prerender = true;`,
      ".fh/config.json": `{"buildCommand": "npm run build", "outputDir": "build"}`,
      ".gitignore": "node_modules\nbuild\n.svelte-kit\n.env\n",
    },
    install: "npm install",
    dev:     "npm run dev",
    build:   "npm run build",
    out:     "build",
  },
};


// Dynamic site scaffolds (--type nlpl|node|python)

const NLPL_MAIN = [
  "import network",
  "import io",
  "",
  "// NexusHosting injects PORT via environment.",
  "// Your server MUST call network.serve_http to handle requests.",
  "",
  "function handle_request with request returns String",
  '  set path to network.get_path from request',
  '  if path equals "/"',
  '    set body to "<!DOCTYPE html><html><head><title>My NLPL App</title></head><body><h1>Hello from NLPL!</h1></body></html>"',
  '    return "HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\n\\r\\n" + body',
  "  end",
  '  if path equals "/api/health"',
  '    return "HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n{\\"ok\\":true}"',
  "  end",
  '  return "HTTP/1.1 404 Not Found\\r\\nContent-Type: text/plain\\r\\n\\r\\nNot found"',
  "end",
  "",
  "call network.serve_http with handle_request, PORT",
].join("\n");

const NODE_MAIN = [
  "const http = require('http');",
  "const url  = require('url');",
  "const PORT        = parseInt(process.env.PORT ?? '3000', 10);",
  "const SITE_DOMAIN = process.env.SITE_DOMAIN ?? 'localhost';",
  "",
  "function router(req, res) {",
  "  const { pathname } = url.parse(req.url ?? '/');",
  "  if (pathname === '/' || pathname === '') {",
  "    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });",
  "    res.end(`<!DOCTYPE html><html><head><title>My App</title></head><body><h1>Hello from Node.js!</h1><p>Domain: ${SITE_DOMAIN}</p></body></html>`);",
  "    return;",
  "  }",
  "  if (pathname === '/api/health') {",
  "    res.writeHead(200, { 'Content-Type': 'application/json' });",
  "    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));",
  "    return;",
  "  }",
  "  res.writeHead(404, { 'Content-Type': 'text/plain' });",
  "  res.end('Not found');",
  "}",
  "",
  "const server = http.createServer(router);",
  "server.listen(PORT, '0.0.0.0', () => console.log(`[server] Listening on port ${PORT}`));",
  "process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 4900).unref(); });",
].join("\n");

const NODE_PKG = JSON.stringify({
  name: "my-nexus-node-app",
  version: "0.1.0",
  main: "server.js",
  scripts: { start: "node server.js", dev: "PORT=3000 node server.js" },
  engines: { node: ">=18" },
}, null, 2);

const PY_MAIN = [
  '"""NexusHosting Python HTTP server scaffold. Uses stdlib only."""',
  "import os, json, signal, http.server, urllib.parse",
  "PORT        = int(os.environ.get('PORT', '3000'))",
  "SITE_DOMAIN = os.environ.get('SITE_DOMAIN', 'localhost')",
  "class Handler(http.server.BaseHTTPRequestHandler):",
  "  def do_GET(self):",
  "    p = urllib.parse.urlparse(self.path).path",
  "    if p in ('/', ''):",
  "      b = f'<h1>Hello from Python!</h1><p>{SITE_DOMAIN}</p>'.encode()",
  "      self.send_response(200); self.send_header('Content-Type','text/html'); self.end_headers(); self.wfile.write(b)",
  "    elif p == '/api/health':",
  "      b = json.dumps({'ok': True}).encode()",
  "      self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(b)",
  "    else:",
  "      self.send_response(404); self.send_header('Content-Type','text/plain'); self.end_headers(); self.wfile.write(b'Not found')",
  "  def log_message(self, fmt, *a): print(f'[server] {fmt % a}')",
  "def main():",
  "  srv = http.server.HTTPServer(('0.0.0.0', PORT), Handler)",
  "  print(f'[server] Listening on port {PORT}')",
  "  signal.signal(signal.SIGTERM, lambda *_: srv.shutdown())",
  "  srv.serve_forever()",
  "if __name__ == '__main__': main()",
].join("\n");

const DYNAMIC_SCAFFOLDS: Record<string, { label: string; desc: string; entryFile: string; files: Record<string, string> }> = {
  nlpl: {
    label: "NLPL Application", entryFile: "server.nlpl",
    desc:  "NLPL HTTP server — requires NLPL interpreter on the node.",
    files: {
      "server.nlpl": NLPL_MAIN,
      "README.md": "# NLPL App\n\nDeploy: `nh deploy . --site <id>`\nStart the process from the NexusHosting dashboard.\n\nLocal dev: `PORT=3000 python3 /opt/nlpl/src/main.py server.nlpl`\n",
    },
  },
  node: {
    label: "Node.js Server", entryFile: "server.js",
    desc:  "Node.js HTTP server — listens on PORT env var.",
    files: {
      "server.js":    NODE_MAIN,
      "package.json": NODE_PKG,
      "README.md": "# Node.js App\n\nDeploy: `nh deploy . --site <id>`\nStart the process from the NexusHosting dashboard.\n\nLocal dev: `PORT=3000 node server.js`\n",
    },
  },
  python: {
    label: "Python HTTP Server", entryFile: "server.py",
    desc:  "Python 3 HTTP server — stdlib only, no pip required.",
    files: {
      "server.py": PY_MAIN,
      "README.md": "# Python App\n\nDeploy: `nh deploy . --site <id>`\nStart the process from the NexusHosting dashboard.\n\nLocal dev: `PORT=3000 python3 server.py`\n",
    },
  },
};



export const createCommand = new Command("create")
  .description("Scaffold a new site project from a template")
  .argument("[dir]", "Directory to create the project in")
  .option("--template <name>", `Template to use: ${Object.keys(TEMPLATES).join(", ")}`)
  .option("--no-install", "Skip npm install")
  .option("--type <type>", "Dynamic site type: nlpl, node, python")
  .addHelpText("after", `
Templates:
${Object.entries(TEMPLATES).map(([k, v]) => `  ${k.padEnd(10)} ${v.label.padEnd(22)} ${v.desc}`).join("\n")}
`)
  .action(async (dir: string | undefined, opts: { template?: string; type?: string; install: boolean }) => {
    console.log();
    console.log(chalk.bold("  ⚡ Nexus Hosting — Create new site\n"));

    // ── Dynamic site type (--type nlpl|node|python) ──────────────────────────
    if (opts.type && opts.type !== "static") {
      const scaffold = DYNAMIC_SCAFFOLDS[opts.type];
      if (!scaffold) {
        console.error(chalk.red(`  Unknown type: ${opts.type}`));
        console.error(chalk.dim("  Available: nlpl, node, python"));
        process.exit(1);
      }
      const projectDir = path.resolve(dir ?? `my-${opts.type}-app`);
      const dirName    = path.basename(projectDir);
      if (fs.existsSync(projectDir) && fs.readdirSync(projectDir).length > 0) {
        console.error(chalk.red(`  Directory already exists and is not empty: ${projectDir}`));
        process.exit(1);
      }
      console.log(`  Creating ${chalk.bold(dirName)} — ${chalk.cyan(scaffold.label)}\n`);
      for (const [relPath, fileContent] of Object.entries(scaffold.files)) {
        const absPath = path.join(projectDir, relPath);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, fileContent);
        console.log(`  ${chalk.dim("+")} ${relPath}`);
      }
      console.log();
      console.log(chalk.green("  ✓ Project created!\n"));
      console.log(`  ${chalk.dim("Directory:")} ${chalk.cyan(projectDir)}`);
      console.log(`  ${chalk.dim("Type:")}      ${scaffold.label}`);
      console.log(`  ${chalk.dim("Entry:")}     ${scaffold.entryFile}`);
      console.log();
      console.log(chalk.bold("  Next steps:\n"));
      console.log(`  ${chalk.dim("1.")} Create an ${opts.type} site on NexusHosting:`);
      console.log(`     ${chalk.cyan(`nh sites create --name "${dirName}" --type ${opts.type}`)}`);
      console.log(`  ${chalk.dim("2.")} Deploy your files:`);
      console.log(`     ${chalk.cyan(`nh deploy . --site <id>`)}`);
      console.log(`  ${chalk.dim("3.")} Start the process from the NexusHosting dashboard`);
      console.log(`     ${chalk.dim("(Deploy page → Runtime Server panel → Start)")}`);
      console.log();
      return;
    }

    // ── Static site template ──────────────────────────────────────────────────
    // Pick template
    let templateName = opts.template;
    if (!templateName) {
      console.log("  Choose a template:\n");
      Object.entries(TEMPLATES).forEach(([k, v], i) => {
        console.log(`  ${chalk.cyan(`${i + 1}.`)} ${chalk.bold(v.label).padEnd(26)} ${chalk.dim(v.desc)}`);
      });
      console.log();

      const { default: enquirer } = await import("enquirer" as any).catch(() => ({ default: null }));
      if (enquirer) {
        const { choice } = await (enquirer as any).prompt({
          type: "select", name: "choice", message: "Template",
          choices: Object.entries(TEMPLATES).map(([k, v]) => ({ name: k, message: `${v.label} — ${v.desc}` })),
        });
        templateName = choice;
      } else {
        // Fallback: just pick plain HTML
        templateName = "html";
        console.log(chalk.dim("  Defaulting to plain HTML template.\n"));
      }
    }

    const template = TEMPLATES[templateName!];
    if (!template) {
      console.error(chalk.red(`  Unknown template: ${templateName}`));
      console.error(chalk.dim(`  Available: ${Object.keys(TEMPLATES).join(", ")}`));
      process.exit(1);
    }

    // Target directory
    const projectDir = path.resolve(dir ?? templateName!);
    const dirName    = path.basename(projectDir);

    if (fs.existsSync(projectDir) && fs.readdirSync(projectDir).length > 0) {
      console.error(chalk.red(`  Directory already exists and is not empty: ${projectDir}`));
      process.exit(1);
    }

    console.log(`  Creating ${chalk.bold(dirName)} with ${chalk.cyan(template.label)} template…\n`);

    // Write files
    for (const [relPath, content] of Object.entries(template.files)) {
      const absPath = path.join(projectDir, relPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content);
      console.log(`  ${chalk.dim("+")} ${relPath}`);
    }

    console.log();

    // Install dependencies
    if (opts.install && template.install) {
      const spinner = ora(`  Installing dependencies (${template.install})…`).start();
      try {
        execSync(template.install, { cwd: projectDir, stdio: "pipe" });
        spinner.succeed(chalk.green("  Dependencies installed"));
      } catch {
        spinner.warn(chalk.yellow("  Install failed — run it manually: ") + chalk.white(template.install));
      }
    }

    console.log();
    console.log(chalk.green("  ✓ Project created!\n"));
    console.log(`  ${chalk.dim("Directory:")} ${chalk.cyan(projectDir)}`);
    console.log(`  ${chalk.dim("Template:")}  ${template.label}`);
    if (template.out) {
      console.log(`  ${chalk.dim("Output:")}    ${template.out}${chalk.dim("/  ← deploy this folder")}`);
    }
    console.log();
    console.log(chalk.bold("  Next steps:\n"));
    console.log(`  ${chalk.dim("$")} cd ${dirName}`);
    if (template.install && !opts.install) console.log(`  ${chalk.dim("$")} ${template.install}`);
    if (template.dev)   console.log(`  ${chalk.dim("$")} ${template.dev}   ${chalk.dim("# start dev server")}`);
    if (template.build) console.log(`  ${chalk.dim("$")} ${template.build}  ${chalk.dim("# build for production")}`);
    if (template.out) {
      console.log(`  ${chalk.dim("$")} nh deploy ${template.out} --site <id>  ${chalk.dim("# deploy to NexusHosting")}`);
    } else {
      console.log(`  ${chalk.dim("$")} nh deploy . --site <id>  ${chalk.dim("# deploy to NexusHosting")}`);
    }
    console.log();
  });
