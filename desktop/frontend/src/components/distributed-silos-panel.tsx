import { useCallback, useEffect, useState } from "react";
import {
  CloudIcon,
  LinkIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TokenChip } from "@/components/ui/token-chip";
import { hasNativeBridge, invokeNative } from "@/lib/native";
import { cn } from "@/lib/utils";
import type { AgensisPairing, DistributedSilo, FarmdStatus } from "@/types/farm";

const stoppedFarmd: FarmdStatus = {
  running: false,
  pid: null,
  url: "http://127.0.0.1:4546",
  startedAt: null,
};

export function DistributedSilosPanel({ notify }: { notify: (message: string) => void }) {
  const [silos, setSilos] = useState<DistributedSilo[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [farmd, setFarmd] = useState<FarmdStatus>(stoppedFarmd);
  const [loading, setLoading] = useState(false);
  const [pairBaseUrl, setPairBaseUrl] = useState("https://agensis.io");
  const [pairing, setPairing] = useState<AgensisPairing | null>(null);
  const [runtime, setRuntime] = useState<"e2b" | "daytona">("e2b");
  const [name, setName] = useState("Cloud coder");
  const [runtimeReference, setRuntimeReference] = useState("");
  const [codingCmd, setCodingCmd] = useState("");
  const [share, setShare] = useState(false);
  const [sharedModelsFile, setSharedModelsFile] = useState("");

  const refresh = useCallback(async () => {
    if (!hasNativeBridge()) return;
    setLoading(true);
    try {
      const [siloResult, farmdResult] = await Promise.all([
        invokeNative<{ data: DistributedSilo[]; errors?: string[] }>("farm.distributed.list"),
        invokeNative<FarmdStatus>("farm.farmd.status"),
      ]);
      setSilos(siloResult.data || []);
      setErrors(siloResult.errors || []);
      setFarmd(farmdResult);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const approvalUrlFor = useCallback((pair: AgensisPairing) => {
    const base = (pair.baseUrl || pairBaseUrl || "https://agensis.io").replace(/\/+$/, "");
    const code = pair.userCode?.trim().toUpperCase() || "";
    // Must stay on /integrations/farm — that SPA route is the login → workspace → approve flow.
    if (pair.verificationUri?.includes("/integrations/farm")) {
      return pair.verificationUri;
    }
    return code
      ? `${base}/integrations/farm?code=${encodeURIComponent(code)}`
      : `${base}/integrations/farm`;
  }, [pairBaseUrl]);

  const openAgensisApproval = async (pair?: AgensisPairing | null) => {
    const active = pair || pairing;
    if (!active) return;
    const url = approvalUrlFor(active);
    try {
      if (hasNativeBridge()) {
        await invokeNative("farm.open.url", { url });
      } else {
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) throw new Error("The browser blocked the popup.");
      }
    } catch (error) {
      notify(
        error instanceof Error
          ? `${error.message} Open: ${url}`
          : `Open this URL: ${url}`,
      );
    }
  };

  const finishPairing = async (pair?: AgensisPairing | null, { quiet }: { quiet?: boolean } = {}) => {
    const active = pair || pairing;
    if (!active) return false;
    if (!quiet) setLoading(true);
    try {
      await invokeNative("farm.agensis.pair.exchange", active);
      setPairing(null);
      notify("Agensis workspace paired.");
      await refresh();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Pending until the manager approves in Agensis (device-code poll).
      if (
        quiet &&
        (/428|authorization_pending|pending|not (yet )?approved|authorization pending/i.test(message) ||
          message.toLowerCase().includes("pending"))
      ) {
        return false;
      }
      if (!quiet) notify(message);
      return false;
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  const startPairing = async () => {
    setLoading(true);
    try {
      const result = await invokeNative<AgensisPairing>("farm.agensis.pair.start", {
        baseUrl: pairBaseUrl,
        name: "Agent Farm desktop",
      });
      setPairing(result);
      // Open the full login→approve surface (not a bare dead page).
      void openAgensisApproval(result);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  // Auto-poll token exchange like `farm pair` CLI — no need to hammer "I approved it".
  useEffect(() => {
    if (!pairing?.deviceCode) return;
    let cancelled = false;
    const intervalMs = Math.max(2, Number(pairing.interval || 5)) * 1000;
    const deadline = Date.now() + Math.max(60, Number(pairing.expiresIn || 600)) * 1000;
    const tick = async () => {
      if (cancelled || Date.now() > deadline) return;
      const ok = await finishPairing(pairing, { quiet: true });
      if (ok || cancelled) return;
    };
    const id = window.setInterval(() => void tick(), intervalMs);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only rebind when device code changes
  }, [pairing?.deviceCode, pairing?.interval, pairing?.expiresIn]);

  const createSilo = async () => {
    if (share && !sharedModelsFile.trim()) {
      notify("Add the shared-model config path inside the sandbox before enabling inference sharing.");
      return;
    }
    setLoading(true);
    try {
      await invokeNative("farm.distributed.create", {
        runtime,
        name,
        share,
        sharedModelsFile: sharedModelsFile.trim(),
        codingCmd: codingCmd.trim(),
        ...(runtime === "e2b" ? { template: runtimeReference.trim() } : { snapshot: runtimeReference.trim() }),
      });
      notify(`${name} created.`);
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const act = async (silo: DistributedSilo, action: "start" | "pause" | "delete") => {
    if (action === "delete" && !window.confirm(`Delete ${silo.name}? This permanently removes its managed sandbox.`)) return;
    setLoading(true);
    try {
      await invokeNative("farm.distributed.action", { id: silo.id, action });
      notify(`${silo.name} ${action === "delete" ? "deleted" : action === "pause" ? "paused" : "started"}.`);
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Distributed silos</CardTitle>
          <CardDescription className="type-caption">
            Bring in any machine running agensis-cli, or provision an isolated E2B or Daytona worker. Shared models appear behind the crew route.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="icon-sm" variant="ghost" aria-label="Refresh distributed silos" disabled={loading} onClick={() => void refresh()}>
            <RefreshCwIcon className={cn(loading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
        <section className="space-y-3 border-t pt-4 lg:border-r lg:border-t-0 lg:pr-5 lg:pt-0">
          <div>
            <p className="type-label">Agensis workspace</p>
            <p className="type-caption mt-1">Pair once, then Farm can discover workspace daemons and shared inference.</p>
          </div>
          {!pairing ? (
            <div className="flex gap-2">
              <Input aria-label="Agensis URL" value={pairBaseUrl} onChange={(event) => setPairBaseUrl(event.target.value)} />
              <Button variant="outline" disabled={loading || !pairBaseUrl.trim()} onClick={() => void startPairing()}>
                <LinkIcon /> Pair
              </Button>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div>
                <p className="type-label">Approval code</p>
                <p className="mt-1 font-mono type-heading">{pairing.userCode}</p>
              </div>
              <ol className="list-decimal space-y-1.5 pl-4 type-caption text-muted-foreground">
                <li>
                  Open Agensis and <strong className="text-foreground">sign in</strong> as a workspace manager
                  (the approval page returns you here with this code).
                </li>
                <li>
                  Choose a <strong className="text-foreground">workspace</strong> and click{" "}
                  <strong className="text-foreground">Approve connection</strong>.
                </li>
                <li>
                  Farm finishes automatically — or click <strong className="text-foreground">I approved it</strong>.
                </li>
              </ol>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void openAgensisApproval()}>
                  Open Agensis
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={loading}
                  onClick={() => void finishPairing()}
                >
                  I approved it
                </Button>
              </div>
              <p className="type-caption break-all text-muted-foreground">
                {approvalUrlFor(pairing)}
              </p>
            </div>
          )}
        </section>

        <section className="space-y-3 border-t pt-4 lg:border-r lg:border-t-0 lg:pr-5 lg:pt-0">
          <div>
            <p className="type-label">Managed sandbox</p>
            <p className="type-caption mt-1">Use a prepared template or snapshot. Tool authentication and model configuration stay inside that environment.</p>
          </div>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
            <select className="h-8 rounded-md border bg-background px-2 type-list" aria-label="Sandbox runtime" value={runtime} onChange={(event) => setRuntime(event.target.value as "e2b" | "daytona")}>
              <option value="e2b">E2B</option>
              <option value="daytona">Daytona</option>
            </select>
            <Input aria-label="Silo name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <Input
            aria-label={runtime === "e2b" ? "E2B template" : "Daytona snapshot"}
            placeholder={runtime === "e2b" ? "Template (optional)" : "Snapshot (optional)"}
            value={runtimeReference}
            onChange={(event) => setRuntimeReference(event.target.value)}
          />
          <Input
            aria-label="Coding command inside the sandbox"
            placeholder="Coding command (optional)"
            value={codingCmd}
            onChange={(event) => setCodingCmd(event.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <TokenChip selected={share} onClick={() => setShare((value) => !value)}>
              {share ? "Inference sharing" : "No shared inference"}
            </TokenChip>
            <Button size="sm" disabled={loading || !name.trim()} onClick={() => void createSilo()}>
              <CloudIcon /> Create
            </Button>
          </div>
          {share && (
            <Input
              aria-label="Shared model config path inside the sandbox"
              placeholder="/path/in/sandbox/shared-models.json"
              value={sharedModelsFile}
              onChange={(event) => setSharedModelsFile(event.target.value)}
            />
          )}
        </section>

        <section className="min-w-0 space-y-3 border-t pt-4 lg:border-t-0 lg:pt-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="type-label">Available crew</p>
              <p className="type-caption mt-1">{silos.length ? `${silos.length} distributed silo${silos.length === 1 ? "" : "s"}` : "No paired or managed silos yet"}</p>
            </div>
            <code className="type-code text-muted-foreground">{farmd.url}</code>
          </div>
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {silos.map((silo) => (
              <div key={silo.id} className="flex items-center gap-3 rounded-lg border bg-background p-3">
                <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate type-list">{silo.name}</p>
                  <p className="truncate type-caption">
                    {silo.runtime} · {silo.locality} · {silo.capabilities?.shared && silo.capabilities?.codingRoute
                      ? "models + coding"
                      : silo.capabilities?.shared
                        ? "models"
                        : silo.capabilities?.codingRoute
                          ? "coding"
                          : "connected"}
                  </p>
                </div>
                <Badge variant={silo.lifecycle === "running" ? "default" : "secondary"}>{silo.lifecycle}</Badge>
                {silo.management === "managed" && silo.lifecycle !== "deleted" && (
                  <div className="flex items-center gap-1">
                    <Button size="icon-xs" variant="ghost" aria-label={`${silo.lifecycle === "running" ? "Pause" : "Start"} ${silo.name}`} disabled={loading} onClick={() => void act(silo, silo.lifecycle === "running" ? "pause" : "start")}>
                      {silo.lifecycle === "running" ? <PauseIcon /> : <PlayIcon />}
                    </Button>
                    <Button size="icon-xs" variant="ghost" aria-label={`Delete ${silo.name}`} disabled={loading} onClick={() => void act(silo, "delete")}>
                      <Trash2Icon />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {errors.length > 0 && <p className="type-caption text-destructive">{errors[0]}</p>}
        </section>
      </CardContent>
    </Card>
  );
}
