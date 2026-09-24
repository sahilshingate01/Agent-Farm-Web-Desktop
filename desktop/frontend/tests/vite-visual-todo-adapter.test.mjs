import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("Vite adapts a configured widget component export to the public contract", async () => {
  const directory = mkdtempSync(join(tmpdir(), "visual-todo-widget-"));
  const modulePath = join(directory, "widget.mjs");
  writeFileSync(
    modulePath,
    "export const LegacyWidget = () => null;\n"
      + "export const loadAllAnnotations = () => new Map();\n"
      + "export const saveAnnotations = () => undefined;\n",
  );
  const previousPath = process.env.VISUAL_TODO_WIDGET_PATH;
  const previousExport = process.env.VISUAL_TODO_WIDGET_EXPORT;
  process.env.VISUAL_TODO_WIDGET_PATH = modulePath;
  process.env.VISUAL_TODO_WIDGET_EXPORT = "LegacyWidget";
  try {
    const configModule = await import(
      `../vite.config.js?test=${Date.now()}`
    );
    const config = configModule.default();
    const adapter = config.plugins.find(
      (plugin) => plugin.name === "visual-todo-widget-adapter",
    );
    assert.ok(adapter);
    const id = adapter.resolveId("virtual:visual-todo-widget-adapter");
    const source = adapter.load(id);
    assert.match(source, /LegacyWidget/);
    assert.match(source, /export const VisualTodo/);
    assert.equal(
      config.resolve.alias["visual-todo-widget"],
      "virtual:visual-todo-widget-adapter",
    );
  } finally {
    if (previousPath === undefined) delete process.env.VISUAL_TODO_WIDGET_PATH;
    else process.env.VISUAL_TODO_WIDGET_PATH = previousPath;
    if (previousExport === undefined) delete process.env.VISUAL_TODO_WIDGET_EXPORT;
    else process.env.VISUAL_TODO_WIDGET_EXPORT = previousExport;
  }
});
