import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { generateNpmLicenseBundle } from "../../scripts/generate-npm-license-bundle.mjs";

const visualTodoAdapterId = "\0visual-todo-widget-adapter";

function visualTodoAdapter(modulePath, componentExport) {
  return {
    name: "visual-todo-widget-adapter",
    resolveId(id) {
      return id === "virtual:visual-todo-widget-adapter"
        ? visualTodoAdapterId
        : null;
    },
    load(id) {
      if (id !== visualTodoAdapterId) return null;
      return `
        import * as widget from ${JSON.stringify(modulePath)};
        export const VisualTodo = widget[${JSON.stringify(componentExport)}];
        export const loadAllAnnotations =
          widget.loadAllAnnotations || (() => new Map());
        export const saveAnnotations =
          widget.saveAnnotations || (() => undefined);
        if (!VisualTodo) {
          throw new Error(
            "Configured visual TODO widget does not export ${componentExport}.",
          );
        }
      `;
    },
  };
}

function shipLegalNotices() {
  return {
    name: "ship-legal-notices",
    closeBundle() {
      const repositoryRoot = path.resolve(import.meta.dirname, "../..");
      const legalDir = path.resolve(import.meta.dirname, "dist/legal");
      mkdirSync(legalDir, { recursive: true });
      copyFileSync(
        path.join(repositoryRoot, "LICENSE"),
        path.join(legalDir, "AGPL-3.0.txt"),
      );
      copyFileSync(
        path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"),
        path.join(legalDir, "THIRD_PARTY_NOTICES.md"),
      );
      copyFileSync(
        path.join(import.meta.dirname, "public/fonts/Geist-LICENSE.txt"),
        path.join(legalDir, "OFL-1.1.txt"),
      );
      generateNpmLicenseBundle({
        lockPath: path.join(import.meta.dirname, "package-lock.json"),
        packageRoot: import.meta.dirname,
        outputPath: path.join(legalDir, "NPM-DEPENDENCY-LICENSES.txt"),
      });
      const appBundle = path.join(import.meta.dirname, "dist/assets/app.js");
      if (existsSync(appBundle)) {
        writeFileSync(
          appBundle,
          readFileSync(appBundle, "utf8").replace(/[ \t]+$/gm, ""),
        );
      }
    },
  };
}

export default defineConfig(() => {
  const optionalVisualTodoWidget = process.env.VISUAL_TODO_WIDGET_PATH;
  const visualTodoWidgetExport = String(
    process.env.VISUAL_TODO_WIDGET_EXPORT || "VisualTodo",
  ).trim();
  if (
    optionalVisualTodoWidget
    && !existsSync(path.resolve(optionalVisualTodoWidget))
  ) {
    throw new Error(
      `VISUAL_TODO_WIDGET_PATH does not exist: ${optionalVisualTodoWidget}`,
    );
  }
  const visualTodoWidget = optionalVisualTodoWidget
    && existsSync(path.resolve(optionalVisualTodoWidget))
    ? "virtual:visual-todo-widget-adapter"
    : path.resolve(import.meta.dirname, "./src/lib/visual-todo-widget-unavailable.tsx");
  return {
  plugins: [
    ...(optionalVisualTodoWidget
      ? [visualTodoAdapter(
          path.resolve(optionalVisualTodoWidget),
          visualTodoWidgetExport,
        )]
      : []),
    react(),
    tailwindcss(),
    shipLegalNotices(),
  ],
  server: {
    host: "127.0.0.1",
    port: 7417,
    strictPort: true,
    proxy: {
      // 4547 — the visualTodo dev worker's port; farmd owns 4546 (controller.mjs
      // visualTodoWarmWorker must agree with this target).
      "/__visual_todo_worker": {
        target: "http://127.0.0.1:4547",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/__visual_todo_worker/, ""),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "visual-todo-widget": visualTodoWidget,
      react: path.resolve(import.meta.dirname, "./node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "./node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (asset) => asset.names.some((name) => name.endsWith(".css")) ? "assets/app.css" : "assets/[name][extname]",
      },
    },
  },
  };
});
