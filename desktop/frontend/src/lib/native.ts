declare global {
  interface Window {
    zero?: { invoke<T>(command: string, payload?: unknown): Promise<T> };
  }
}

export async function invokeNative<T>(command: string, payload: unknown = {}): Promise<T> {
  if (!window.zero) throw new Error("Open this interface through the Usage Farm Native desktop app.");
  return window.zero.invoke<T>(command, payload);
}

export function hasNativeBridge() {
  return typeof window !== "undefined" && Boolean(window.zero);
}
