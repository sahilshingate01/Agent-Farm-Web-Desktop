import { useEffect, useMemo, useState, type ImgHTMLAttributes } from "react";
import { hasNativeBridge, invokeNative } from "@/lib/native";
import { cn } from "@/lib/utils";

type AssetPayload = {
  mime: string;
  encoding: "utf8" | "base64";
  content: string;
};

function joinDocRelative(docPath: string | undefined, src: string): string | null {
  if (!src || /^(https?:|data:|blob:|file:|zero:)/i.test(src)) return null;
  if (src.startsWith("/")) return src.replace(/^\/+/, "");
  const baseDir = docPath?.includes("/") ? docPath.slice(0, docPath.lastIndexOf("/")) : "";
  const parts = [...(baseDir ? baseDir.split("/") : []), ...src.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/**
 * Resolves doc-relative markdown images (e.g. `docs/architecture.svg`) through
 * the native workspace bridge so preview doesn't 404 on relative paths.
 */
export function WorkspaceMarkdownImage({
  src,
  alt,
  className,
  docPath,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & { docPath?: string }) {
  const absoluteRemote = Boolean(src && /^(https?:|data:|blob:)/i.test(src));
  const relativePath = useMemo(() => joinDocRelative(docPath, String(src || "")), [docPath, src]);
  const [href, setHref] = useState<string | null>(absoluteRemote ? String(src) : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (absoluteRemote) {
      setHref(String(src));
      setFailed(false);
      return;
    }
    if (!relativePath || !hasNativeBridge()) {
      setHref(null);
      setFailed(true);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    setHref(null);
    void invokeNative<AssetPayload>("farm.workspace.asset", { path: relativePath })
      .then((asset) => {
        if (cancelled) return;
        if (asset.encoding === "utf8") {
          objectUrl = URL.createObjectURL(new Blob([asset.content], { type: asset.mime }));
        } else {
          const binary = atob(asset.content);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: asset.mime }));
        }
        setHref(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [absoluteRemote, relativePath, src]);

  if (failed || !href) {
    return (
      <span
        className="my-3 block rounded-lg border border-dashed border-border bg-muted/30 px-3 py-6 text-center type-caption text-muted-foreground"
        data-streamdown="image-fallback"
      >
        {alt || src || "Image unavailable"}
      </span>
    );
  }

  return (
    <img
      {...rest}
      src={href}
      alt={alt || ""}
      className={cn("my-4 max-w-full rounded-lg border border-border/60", className)}
      data-streamdown="image"
    />
  );
}
