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
    <h1>Hello from FedHost 🚀</h1>
    <p>Edit <code>index.html</code> and deploy with <code>fh deploy . --site &lt;id&gt;</code></p>
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
  "name": "my-fedhost-site",
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
        <h1 style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>Hello from FedHost 🚀</h1>
        <p style={{ color: "#9ca3af" }}>Edit <code>src/App.tsx</code> and run <code>fh deploy dist --site &lt;id&gt;</code></p>
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
  "name": "my-fedhost-site",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "dev": "astro dev", "build": "astro build", "preview": "astro preview" },
  "dependencies": { "astro": "^5.2.0" }
}`,
      "astro.config.mjs": `import { defineConfig } from "astro/config";\nexport default defineConfig({});`,
      "src/pages/index.astro": `---
const title = "My FedHost Site";
---
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>{title}</title>
<style>body{font-family:system-ui;background:#0a0a0f;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}h1{font-size:2.5rem}p{color:#9ca3af}</style>
</head>
<body><h1>Hello from FedHost 🚀</h1><p>Edit <code>src/pages/index.astro</code></p></body>
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
  "name": "my-fedhost-site",
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
        <h1 style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>Hello from FedHost 🚀</h1>
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
  "name": "my-fedhost-site",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "dev": "vite dev", "build": "vite build", "preview": "vite preview" },
  "devDependencies": { "@sveltejs/adapter-static": "^3.0.8", "@sveltejs/kit": "^2.15.0", "svelte": "^5.17.3", "vite": "^6.0.7" }
}`,
      "svelte.config.js": `import adapter from "@sveltejs/adapter-static";
export default { kit: { adapter: adapter({ fallback: "404.html" }) } };`,
      "vite.config.ts": `import { sveltekit } from "@sveltejs/kit/vite";\nimport { defineConfig } from "vite";\nexport default defineConfig({ plugins: [sveltekit()] });`,
      "src/routes/+page.svelte": `<main>
  <h1>Hello from FedHost 🚀</h1>
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

export const createCommand = new Command("create")
  .description("Scaffold a new static site project from a template")
  .argument("[dir]", "Directory to create the project in")
  .option("--template <name>", `Template to use: ${Object.keys(TEMPLATES).join(", ")}`)
  .option("--no-install", "Skip npm install")
  .addHelpText("after", `
Templates:
${Object.entries(TEMPLATES).map(([k, v]) => `  ${k.padEnd(10)} ${v.label.padEnd(22)} ${v.desc}`).join("\n")}
`)
  .action(async (dir: string | undefined, opts: { template?: string; install: boolean }) => {
    console.log();
    console.log(chalk.bold("  ⚡ FedHost — Create new site\n"));

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
      console.log(`  ${chalk.dim("$")} fh deploy ${template.out} --site <id>  ${chalk.dim("# deploy to FedHost")}`);
    } else {
      console.log(`  ${chalk.dim("$")} fh deploy . --site <id>  ${chalk.dim("# deploy to FedHost")}`);
    }
    console.log();
  });
