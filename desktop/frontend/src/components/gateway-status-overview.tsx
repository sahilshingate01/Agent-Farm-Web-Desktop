import { useMemo, useState } from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightLeftIcon,
  CheckCircle2Icon,
  Clock3Icon,
  CopyIcon,
  KeyRoundIcon,
  NetworkIcon,
  PlusIcon,
  RadioTowerIcon,
  RouteIcon,
  ServerIcon,
  Trash2Icon,
  WaypointsIcon,
  ZapIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  GatewayApiKey,
  GatewayRequestActivity,
  GatewaySettings,
  GatewayStatus,
  GatewayTrafficRank,
  GatewayTrafficWindow,
} from "@/types/farm";

const WINDOW_ORDER: GatewayTrafficWindow["id"][] = ["1h", "4h", "8h", "24h", "7d", "30d"];

function compactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value);
}

function compactUsd(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(value) < 0.01 ? 4 : 2,
    maximumFractionDigits: Math.abs(value) < 0.01 ? 4 : 2,
  }).format(value);
}

function relativeTime(value?: string | null) {
  if (!value) return "Never";
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed)) return "Unknown";
  if (elapsed < 5_000) return "Just now";
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1_000)}s ago`;
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}h ago`;
  return `${Math.floor(elapsed / (24 * 60 * 60_000))}d ago`;
}

function duration(value?: number) {
  if (value == null) return "—";
  if (value < 1_000) return `${value}ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function clientLabel(value: string) {
  const [, agent] = value.split(" · ");
  return agent || value;
}

function requestTone(request: GatewayRequestActivity) {
  if (request.state === "active") return "bg-primary";
  if (request.state === "completed") return "bg-emerald-500";
  return "bg-destructive";
}

function cacheLabel(request: GatewayRequestActivity) {
  const usage = request.usage;
  if (!usage || usage.estimated) return null;
  const activity = [
    (usage.cached_input_tokens || 0) > 0
      ? `${compactNumber(usage.cached_input_tokens || 0)} cache read`
      : null,
    (usage.cache_creation_input_tokens || 0) > 0
      ? `${compactNumber(usage.cache_creation_input_tokens || 0)} cache write`
      : null,
  ].filter(Boolean);
  if (activity.length) return activity.join(" · ");
  if (usage.cache_status === "miss") return "cache miss";
  return request.cacheRequested ? "cache not reported" : null;
}

function usageSavingsLabel(usage?: GatewayRequestActivity["usage"]) {
  if (usage?.cache_savings_usd == null) return null;
  return usage.cache_savings_usd >= 0
    ? `${compactUsd(usage.cache_savings_usd)} saved`
    : `${compactUsd(Math.abs(usage.cache_savings_usd))} cache investment`;
}

function RequestRow({ request }: { request: GatewayRequestActivity }) {
  const cache = cacheLabel(request);
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 border-t px-4 py-2.5 first:border-t-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn("size-2 shrink-0 rounded-full", requestTone(request), request.state === "active" && "animate-pulse motion-reduce:animate-none")} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <code className="truncate font-mono text-xs font-semibold">{request.model || "Unknown model"}</code>
            <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[0.65rem]">{request.protocol}</Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{clientLabel(request.client)}</p>
        </div>
      </div>
      <div className="min-w-0">
        <p className="truncate font-mono text-xs">{request.route || request.path}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{request.provider}{request.account ? ` · ${request.account}` : ""}</p>
      </div>
      <div className="text-right">
        <p className="font-mono text-xs font-medium">
          {request.state === "active" ? "Routing now" : request.state === "completed" ? compactNumber(request.usage?.total_tokens || 0) + " tok" : "Failed"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {request.state === "active"
            ? relativeTime(request.startedAt)
            : [
              duration(request.durationMs),
              cache,
              usageSavingsLabel(request.usage),
            ].filter(Boolean).join(" · ")}
        </p>
      </div>
      {request.error && <p className="col-span-3 truncate pl-4 text-xs text-destructive">{request.error}</p>}
    </div>
  );
}

function Ranking({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: GatewayTrafficRank[] }) {
  const max = Math.max(1, ...rows.map((row) => row.requests));
  return (
    <div className="min-w-0 border-t pt-4 first:border-t-0 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0 lg:first:border-l-0 lg:first:pl-0">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      {rows.length ? (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <code className="truncate font-mono">{row.id}</code>
                <span className="shrink-0 text-muted-foreground">{row.requests} req</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/75" style={{ width: `${Math.max(8, (row.requests / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No inference in this window.</p>
      )}
    </div>
  );
}

function makeApiKey(): GatewayApiKey {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return {
    id: crypto.randomUUID(),
    name: "",
    key: `farm_sk_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
    createdAt: new Date().toISOString(),
  };
}

export function GatewayStatusOverview({
  status,
  settings,
  onSaveSettings,
  notify,
}: {
  status: GatewayStatus;
  settings: GatewaySettings;
  onSaveSettings: (settings: GatewaySettings) => Promise<void>;
  notify: (message: string) => void;
}) {
  const [windowId, setWindowId] = useState<GatewayTrafficWindow["id"]>("1h");
  const [keyName, setKeyName] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const traffic = useMemo(
    () => status.trafficWindows?.find((item) => item.id === windowId) || status.trafficWindows?.[0],
    [status.trafficWindows, windowId],
  );
  const active = status.activeRequests || [];
  const recent = status.recentRequests || [];
  const clients = status.clients || [];
  const latest = recent[0];
  const inferenceFresh = Boolean(status.lastInferenceAt && Date.now() - Date.parse(status.lastInferenceAt) < 2 * 60_000);
  const state = !status.running
    ? { title: "Gateway offline", detail: "Start the listener to accept client traffic.", icon: ServerIcon, tone: "bg-muted-foreground" }
    : active.length
      ? { title: "Inference flowing", detail: `${active.length} request${active.length === 1 ? " is" : "s are"} being routed now.`, icon: ZapIcon, tone: "bg-primary" }
      : inferenceFresh
        ? { title: "Client traffic confirmed", detail: `Last inference ${relativeTime(status.lastInferenceAt)}.`, icon: CheckCircle2Icon, tone: "bg-emerald-500" }
        : clients.length
          ? { title: "Client connected", detail: "The API is reachable; waiting for an inference request.", icon: NetworkIcon, tone: "bg-amber-500" }
          : { title: "Listening for clients", detail: "No API client has contacted this gateway in the last 10 minutes.", icon: RadioTowerIcon, tone: "bg-muted-foreground" };
  const StateIcon = state.icon;

  const copy = async (value: string, message: string) => {
    await navigator.clipboard?.writeText(value);
    notify(message);
  };
  const generateKey = async () => {
    const name = keyName.trim();
    if (!name) return notify("Name the client before generating a key.");
    const generated = { ...makeApiKey(), name };
    const next = { ...settings, apiKeys: [...(settings.apiKeys || []), generated] };
    setSavingKey(true);
    try {
      await onSaveSettings(next);
      setKeyName("");
      await copy(generated.key, `${name} key generated and copied.`);
    } finally {
      setSavingKey(false);
    }
  };
  const revokeKey = async (id: string, name: string) => {
    if (!window.confirm(`Revoke the ${name} key? That client will stop authenticating immediately.`)) return;
    setSavingKey(true);
    try {
      await onSaveSettings({ ...settings, apiKeys: (settings.apiKeys || []).filter((key) => key.id !== id) });
      notify(`${name} key revoked.`);
    } finally {
      setSavingKey(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.75fr)]">
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="relative mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background">
                <span className={cn("absolute right-0 top-0 size-2.5 translate-x-1/3 -translate-y-1/3 rounded-full ring-4 ring-card", state.tone, active.length > 0 && "animate-pulse motion-reduce:animate-none")} />
                <StateIcon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xl font-semibold tracking-tight">{state.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{state.detail}</p>
                <button
                  type="button"
                  className="mt-3 flex max-w-full items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left transition-colors hover:bg-muted"
                  onClick={() => void copy(status.url, "Gateway URL copied.")}
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", status.running ? "bg-emerald-500" : "bg-muted-foreground")} />
                  <code className="truncate font-mono text-xs">{status.url}/v1</code>
                  <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </div>
            </div>
            {latest ? (
              <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4 sm:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">Last model</p><p className="mt-1 truncate font-mono text-xs font-semibold">{latest.model}</p></div>
                <div><p className="text-xs text-muted-foreground">Provider</p><p className="mt-1 truncate text-sm font-medium">{latest.provider}</p></div>
                <div><p className="text-xs text-muted-foreground">Last result</p><p className="mt-1 text-sm font-medium capitalize">{latest.state}</p></div>
                <div><p className="text-xs text-muted-foreground">Observed</p><p className="mt-1 text-sm font-medium">{relativeTime(latest.startedAt)}</p></div>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 border-t bg-muted/20 xl:border-l xl:border-t-0">
            {[
              ["Active inference", active.length, "right now"],
              ["API clients", clients.length, "last 10 min"],
              ["Process", status.pid || "—", status.running ? "running" : "stopped"],
              ["Route", status.rota?.account || "—", status.rota?.strategy || settings.rotaStrategy || "smart"],
            ].map(([label, value, caption], index) => (
              <div key={String(label)} className={cn("p-4", index % 2 === 1 && "border-l", index >= 2 && "border-t")}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 truncate font-mono text-lg font-semibold">{value}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{caption}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Traffic</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Requests and reported token usage from this gateway only.</p>
          </div>
          <div className="flex rounded-lg border bg-muted/30 p-0.5">
            {WINDOW_ORDER.map((id) => {
              const item = status.trafficWindows?.find((entry) => entry.id === id);
              return (
                <button key={id} type="button" onClick={() => setWindowId(id)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", windowId === id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>{item?.label || id}</button>
              );
            })}
          </div>
        </div>
        <div className="grid overflow-hidden rounded-xl border bg-card sm:grid-cols-2 xl:grid-cols-6">
          {[
            ["Requests", traffic?.requests || 0, `${traffic?.active || 0} active`],
            ["Tokens", compactNumber(traffic?.totalTokens || 0), `${compactNumber(traffic?.inputTokens || 0)} in · ${compactNumber(traffic?.outputTokens || 0)} out`],
            ["Cache", compactNumber(traffic?.cacheReadTokens || 0), `${compactNumber(traffic?.cacheWriteTokens || 0)} written · ${traffic?.cacheHits || 0} hit / ${traffic?.cacheMisses || 0} miss / ${traffic?.cacheUnreported || 0} unreported`],
            [
              "Savings",
              (traffic?.cachePricedRequests || 0) > 0
                ? compactUsd(traffic?.cacheSavingsUsd || 0)
                : compactNumber(traffic?.cacheNetInputTokensSaved || 0),
              (traffic?.cachePricedRequests || 0) > 0
                ? `${traffic?.cachePricedRequests || 0} priced request(s) · estimated`
                : "net base-input-token equivalents",
            ],
            ["Errors", traffic?.errors || 0, traffic?.requests ? `${Math.round(((traffic?.errors || 0) / traffic.requests) * 100)}% of requests` : "No requests"],
            ["Estimated", traffic?.estimatedRequests || 0, "requests without exact provider usage"],
          ].map(([label, value, caption], index) => (
            <div key={String(label)} className={cn("p-4", index > 0 && "border-t sm:border-l sm:border-t-0", index % 2 === 0 && index > 0 && "sm:border-l-0 sm:border-t xl:border-l xl:border-t-0")}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 font-mono text-2xl font-semibold tracking-tight">{value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-4 rounded-xl border bg-card p-4 lg:grid-cols-3 lg:p-5">
          <Ranking title="Top models" icon={<RouteIcon className="size-4" />} rows={traffic?.topModels || []} />
          <Ranking title="Top endpoints" icon={<WaypointsIcon className="size-4" />} rows={traffic?.topEndpoints || []} />
          <Ranking title="Top providers" icon={<ServerIcon className="size-4" />} rows={traffic?.topProviders || []} />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2"><ActivityIcon className="size-4" />Inference activity</CardTitle>
                <CardDescription>Start and completion events prove when a client is actually routing work.</CardDescription>
              </div>
              {active.length > 0 && <Badge className="gap-1.5"><span className="size-1.5 animate-pulse rounded-full bg-primary-foreground motion-reduce:animate-none" />{active.length} live</Badge>}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {recent.length ? recent.slice(0, 10).map((request) => <RequestRow key={request.requestId} request={request} />) : (
              <div className="px-5 py-10 text-center"><ZapIcon className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No inference recorded yet</p><p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Model discovery alone does not count. Send a completion, response, or message request to see confirmed traffic here.</p></div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><NetworkIcon className="size-4" />Current connections</CardTitle>
            <CardDescription>Authenticated API clients seen during the last 10 minutes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {clients.length ? clients.map((client) => (
              <div key={client.client} className="rounded-lg border bg-background p-3">
                <div className="flex items-start gap-2">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", (client.inFlight || 0) > 0 ? "animate-pulse bg-primary motion-reduce:animate-none" : "bg-emerald-500")} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{clientLabel(client.client)}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{client.lastModel || client.lastPath || "API discovery"}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(client.lastSeenAt)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-4 text-xs text-muted-foreground">
                  <span>{client.inferenceCount || 0} inference</span><span>{client.requestCount || 0} API calls</span>{client.keyName && <span>{client.keyName}</span>}
                </div>
              </div>
            )) : <p className="py-6 text-center text-xs text-muted-foreground">No clients connected.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangleIcon className="size-4" />Errors</CardTitle>
            <CardDescription>Failed or interrupted inference requests.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(status.recentErrors || []).length ? (status.recentErrors || []).slice(0, 8).map((error) => (
              <div key={error.requestId} className="border-l-2 border-destructive pl-3 py-1">
                <div className="flex items-center justify-between gap-3"><code className="truncate font-mono text-xs font-semibold">{error.model || error.path}</code><span className="shrink-0 text-xs text-muted-foreground">{relativeTime(error.startedAt)}</span></div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{error.error || `Request ended with ${error.statusCode || "an error"}.`}</p>
              </div>
            )) : <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><CheckCircle2Icon className="size-4 text-emerald-500" />No inference errors recorded.</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock3Icon className="size-4" />Gateway log</CardTitle>
            <CardDescription>Listener lifecycle, rota handoffs, and process errors.</CardDescription>
          </CardHeader>
          <CardContent>
            {(status.runtimeLogs || []).length ? <div className="max-h-56 space-y-2 overflow-y-auto font-mono text-xs text-muted-foreground">{(status.runtimeLogs || []).slice(0, 12).map((line, index) => <p key={`${index}-${line}`} className="border-l pl-3 leading-relaxed">{line}</p>)}</div> : <p className="py-6 text-sm text-muted-foreground">No runtime log entries yet.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRoundIcon className="size-4" />API keys</CardTitle>
            <CardDescription>Issue a separate key per client so connections are identifiable and independently revocable.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Client name, e.g. Continue on MacBook" onKeyDown={(event) => { if (event.key === "Enter") void generateKey(); }} />
              <Button onClick={() => void generateKey()} disabled={savingKey}><PlusIcon data-icon="inline-start" />Generate</Button>
            </div>
            {(settings.apiKeys || []).length ? <div className="divide-y rounded-lg border">{(settings.apiKeys || []).map((key) => (
              <div key={key.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{key.name}</p><code className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">farm_sk_••••{key.key.slice(-8)}</code></div>
                <span className="hidden text-xs text-muted-foreground sm:block">{relativeTime(key.createdAt)}</span>
                <Button variant="ghost" size="icon-sm" aria-label={`Copy ${key.name} key`} onClick={() => void copy(key.key, `${key.name} key copied.`)}><CopyIcon /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Revoke ${key.name} key`} disabled={savingKey} onClick={() => void revokeKey(key.id, key.name)}><Trash2Icon /></Button>
              </div>
            ))}</div> : <p className="text-xs text-muted-foreground">No managed keys. With no legacy or managed key, any process on this Mac can connect.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ArrowRightLeftIcon className="size-4" />Auto-switching</CardTitle>
            <CardDescription>The virtual <code className="font-mono">rota</code> route chooses a silo per request.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-background p-4">
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Strategy</span><Badge variant="secondary">{status.rota?.strategy || settings.rotaStrategy || "smart"}</Badge></div>
              <div className="mt-3 flex items-center gap-3 border-t pt-3"><RouteIcon className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">Current lane</p><p className="truncate font-mono text-sm font-semibold">{status.rota?.account || "No lane selected yet"}</p></div></div>
              {status.rota?.pickedAt && <p className="mt-3 text-xs text-muted-foreground">Selected {relativeTime(status.rota.pickedAt)}{status.rota.score != null ? ` · score ${status.rota.score.toFixed(2)}` : ""}</p>}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Change selection policy in Crew rotation below. Direct model IDs always bypass the rota.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
