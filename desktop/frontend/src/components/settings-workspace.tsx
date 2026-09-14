import { useEffect, useState, type ReactNode } from "react";
import {
  CheckIcon,
  FolderPlusIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { invokeNative } from "@/lib/native";
import { appTimeZone, setAppTimeZone, systemTimeZone } from "@/lib/timezone";
import type { BootstrapData, FarmHostDir } from "@/types/farm";
import "./settings-workspace.css";

export type SettingsThemeMode = "light" | "dark" | "system";
export type SettingsUiFont =
  | "geist"
  | "system"
  | "inter"
  | "helvetica"
  | "space-grotesk"
  | "manrope"
  | "dm-sans"
  | "work-sans"
  | "plus-jakarta";
export type SettingsMonoFont =
  | "geist-mono"
  | "jetbrains"
  | "berkeley"
  | "sf-mono"
  | "menlo"
  | "ibm-plex"
  | "space-mono";

type SettingsSection =
  | "preferences"
  | "accounts"
  | "runtime"
  | "project"
  | "profiles"
  | "equipment"
  | "api"
  | "security";

const GROUPS: Array<{
  id: "user" | "project";
  label: string;
  items: Array<{ id: SettingsSection; label: string }>;
}> = [
  {
    id: "user",
    label: "User",
    items: [
      { id: "preferences", label: "Preferences" },
      { id: "accounts", label: "Silos" },
      { id: "runtime", label: "Runtime & CLI" },
    ],
  },
  {
    id: "project",
    label: "This project",
    items: [
      { id: "project", label: "Project" },
      { id: "profiles", label: "Profiles" },
      { id: "equipment", label: "Skills & tools" },
      { id: "api", label: "Gateway" },
      { id: "security", label: "Security" },
    ],
  },
];

const UI_FONTS: Array<[SettingsUiFont, string]> = [
  ["inter", "Inter"],
  ["geist", "Geist Sans"],
  ["system", "System UI"],
  ["space-grotesk", "Space Grotesk"],
  ["manrope", "Manrope"],
  ["dm-sans", "DM Sans"],
  ["work-sans", "Work Sans"],
  ["plus-jakarta", "Plus Jakarta Sans"],
  ["helvetica", "Helvetica Neue"],
];

const SECONDARY_FONTS: Array<[string, string]> = [
  ["jetbrains", "JetBrains Mono"],
  ["geist-mono", "Geist Mono"],
  ["space-grotesk", "Space Grotesk"],
  ["berkeley", "Berkeley Mono"],
  ["ibm-plex", "IBM Plex Mono"],
  ["space-mono", "Space Mono"],
  ["sf-mono", "SF Mono"],
];

const MONO_FONTS: Array<[SettingsMonoFont, string]> = [
  ["jetbrains", "JetBrains Mono"],
  ["geist-mono", "Geist Mono"],
  ["berkeley", "Berkeley Mono"],
  ["ibm-plex", "IBM Plex Mono"],
  ["space-mono", "Space Mono"],
  ["sf-mono", "SF Mono"],
  ["menlo", "Menlo"],
];

function SectionIntro({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="settings-content-intro">
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function SettingsBlock({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-content-block">
      <header>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="settings-block-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-control-row">
      <div>
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="settings-control-value">{children}</div>
    </div>
  );
}

function SettingsSwitch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="settings-switch"
      onClick={() => onCheckedChange(!checked)}
    >
      <span />
    </button>
  );
}

function SettingsSelect({
  value,
  onChange,
  children,
  label,
}: {
  value: string | number;
  onChange: (value: string) => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {children}
    </select>
  );
}

/** Accent theme presets — swatch value is the preset's light-mode primary. */
const APP_THEMES: Array<[value: string, label: string, swatch: string]> = [
  ["azure", "Azure", "oklch(0.6321 0.1983 259.59)"],
  ["meadow", "Meadow", "oklch(0.55 0.15 150)"],
  ["harvest", "Harvest", "oklch(0.6 0.13 65)"],
  ["dusk", "Dusk", "oklch(0.55 0.2 295)"],
  ["clay", "Clay", "oklch(0.58 0.16 30)"],
];

function PreferencesSection({
  themeMode,
  setThemeMode,
  appTheme,
  setAppTheme,
  uiFont,
  setUiFont,
  secondaryFont,
  setSecondaryFont,
  monoFont,
  setMonoFont,
  uiFontSize,
  setUiFontSize,
  codeFontSize,
  setCodeFontSize,
}: Pick<
  SettingsWorkspaceProps,
  | "themeMode"
  | "setThemeMode"
  | "appTheme"
  | "setAppTheme"
  | "uiFont"
  | "setUiFont"
  | "secondaryFont"
  | "setSecondaryFont"
  | "monoFont"
  | "setMonoFont"
  | "uiFontSize"
  | "setUiFontSize"
  | "codeFontSize"
  | "setCodeFontSize"
>) {
  // Dialect and timezone are read at module scope / render sites all over the
  // tree, so switching takes a reload — the two settings here that do.
  const [dialect, setDialect] = useState<"farm" | "stuffy">(() =>
    localStorage.getItem("agensis:dialect") === "stuffy" ? "stuffy" : "farm",
  );
  const [timeZone, setTimeZone] = useState<string>(() => appTimeZone() ?? "auto");
  return (
    <>
      <SectionIntro
        title="Preferences"
        description="Customize how the app looks and behaves."
      />
      <SettingsBlock title="Theme" description="Light, dark, or follow the operating system.">
        <div className="settings-segmented" role="group" aria-label="Theme">
          {(["light", "dark", "system"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              aria-pressed={themeMode === mode}
              onClick={() => setThemeMode(mode)}
            >
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </SettingsBlock>
      <SettingsBlock
        title="Language"
        description="Farm English is the native tongue. Stuffy renames everything for boring people."
      >
        <div className="settings-segmented" role="group" aria-label="Language">
          {([["farm", "Fun"], ["stuffy", "Boring"]] as const).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={dialect === value}
              onClick={() => {
                if (value === dialect) return;
                setDialect(value);
                localStorage.setItem("agensis:dialect", value);
                window.location.reload();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </SettingsBlock>
      <SettingsBlock
        title="Timezone"
        description="Reset times and schedules render in this zone. Provider stamps arrive in UTC."
      >
        <div className="settings-control-group">
          <SettingsRow title="Timezone" description={`Auto uses ${systemTimeZone()}.`}>
            <SettingsSelect
              label="Timezone"
              value={timeZone}
              onChange={(value) => {
                setTimeZone(value);
                setAppTimeZone(value);
                window.location.reload();
              }}
            >
              <option value="auto">Auto ({systemTimeZone()})</option>
              {Intl.supportedValuesOf("timeZone").map((zone) => (
                <option key={zone} value={zone}>{zone}</option>
              ))}
            </SettingsSelect>
          </SettingsRow>
        </div>
      </SettingsBlock>
      <SettingsBlock
        title="Accent theme"
        description="The accent and surface tint used across both light and dark modes."
      >
        <div className="settings-swatch-row" role="group" aria-label="Accent theme">
          {APP_THEMES.map(([value, label, swatch]) => (
            <button
              type="button"
              key={value}
              aria-pressed={appTheme === value}
              onClick={() => setAppTheme(value)}
              className="settings-swatch"
            >
              <span className="settings-swatch-dot" style={{ background: swatch }} />
              {label}
            </button>
          ))}
        </div>
      </SettingsBlock>
      <SettingsBlock
        title="Typography"
        description="Use one interface scale throughout navigation, conversations, panels, and dialogs."
      >
        <div className="settings-control-group">
          <SettingsRow title="Primary UI font" description="Navigation, messages, and controls.">
            <SettingsSelect label="Primary UI font" value={uiFont} onChange={(value) => setUiFont(value as SettingsUiFont)}>
              {UI_FONTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SettingsSelect>
          </SettingsRow>
          <SettingsRow title="Secondary UI font" description="The compressed interface face — buttons, labels, and chips.">
            <SettingsSelect label="Secondary UI font" value={secondaryFont} onChange={(value) => setSecondaryFont(value)}>
              {SECONDARY_FONTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SettingsSelect>
          </SettingsRow>
          <SettingsRow title="Interface size" description="The shared base size for product UI.">
            <SettingsSelect label="Interface size" value={uiFontSize} onChange={(value) => setUiFontSize(Number(value))}>
              {[12, 13, 14, 15, 16].map((size) => <option key={size} value={size}>{size} px</option>)}
            </SettingsSelect>
          </SettingsRow>
          <SettingsRow title="Coding font" description="Terminal, source, routes, and structured data.">
            <SettingsSelect label="Code font" value={monoFont} onChange={(value) => setMonoFont(value as SettingsMonoFont)}>
              {MONO_FONTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SettingsSelect>
          </SettingsRow>
          <SettingsRow title="Code size" description="Monospace content only.">
            <SettingsSelect label="Code size" value={codeFontSize} onChange={(value) => setCodeFontSize(Number(value))}>
              {[9, 10, 11, 12, 13, 14].map((size) => <option key={size} value={size}>{size} px</option>)}
            </SettingsSelect>
          </SettingsRow>
        </div>
      </SettingsBlock>
    </>
  );
}

function AccountsSection({
  data,
  refresh,
}: {
  data: BootstrapData;
  refresh: () => Promise<void>;
}) {
  const [dirs, setDirs] = useState<FarmHostDir[]>(data.hostDirs || []);
  const [hostPath, setHostPath] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDirs(data.hostDirs || []);
  }, [data.hostDirs]);

  const run = async (label: string, work: () => Promise<{ dirs?: FarmHostDir[]; message?: string }>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const result = await work();
      if (Array.isArray(result.dirs)) setDirs(result.dirs);
      if (result.message) setNotice(result.message);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionIntro title="Silos" description="Provider homes available to agent silos." />
      <SettingsBlock title="Connected silos" description="Credentials remain inside each account’s mounted provider home.">
        <div className="settings-list">
          {data.accounts.length ? data.accounts.map((account) => (
            <div key={account.name} className="settings-list-row">
              <span className={cn("settings-status-dot", account.running && "is-live")} />
              <div><strong>{account.name}</strong><p>{account.providers.join(" · ") || "No providers discovered"}</p></div>
              <span>{account.running ? "Running" : "Stopped"}</span>
            </div>
          )) : <p className="settings-empty">No silo homes were discovered.</p>}
        </div>
      </SettingsBlock>

      {(data.host?.providers?.length ?? 0) > 0 && (
        <SettingsBlock
          title="Host mode"
          description="Run jobs on this Mac with your own provider CLIs — not inside a silo. Pick Host when creating a session."
        >
          <div className="settings-list">
            <div className="settings-list-row">
              <span className="settings-status-dot is-live" />
              <div>
                <strong>host</strong>
                <p>{data.host!.providers.join(" · ")}</p>
              </div>
              <span>This Mac</span>
            </div>
          </div>
        </SettingsBlock>
      )}

      <SettingsBlock
        title="Shared host folders"
        description="Extra Mac folders mounted into every local silo (virtiofs). After add or remove, reload running silos so mounts apply."
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void run("reload", () =>
                invokeNative<{ dirs: FarmHostDir[]; message?: string }>(
                  "farm.hostDirs.reload",
                  {},
                ),
              )
            }
          >
            <RefreshCwIcon />
            {busy === "reload" ? "Reloading…" : "Reload silos"}
          </Button>
        }
      >
        <div className="settings-control-group">
          {dirs.length ? (
            <div className="settings-list">
              {dirs.map((dir) => (
                <div key={dir.host} className="settings-list-row">
                  <div className="min-w-0 flex-1">
                    <strong className="font-mono text-xs break-all">{dir.host}</strong>
                    <p className="font-mono text-xs break-all">
                      → {dir.target} · {dir.mode}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={busy !== null}
                    aria-label={`Stop sharing ${dir.host}`}
                    onClick={() =>
                      void run("remove", () =>
                        invokeNative<{ dirs: FarmHostDir[]; message?: string }>(
                          "farm.hostDirs.remove",
                          { host: dir.host },
                        ),
                      )
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="settings-empty">
              No extra host folders yet. Local silos still share the standard work dir.
            </p>
          )}

          <div className="grid gap-2 border-t pt-3">
            <SettingsRow title="Host path" description="Folder on this Mac to share into every local silo.">
              <Input
                value={hostPath}
                onChange={(event) => setHostPath(event.target.value)}
                placeholder="/Volumes/Data/datasets"
                className="font-mono text-xs"
              />
            </SettingsRow>
            <SettingsRow title="Silo path" description="Where it appears inside each silo (defaults to the same absolute path).">
              <Input
                value={targetPath}
                onChange={(event) => setTargetPath(event.target.value)}
                placeholder="Same as host path"
                className="font-mono text-xs"
              />
            </SettingsRow>
            <SettingsRow title="Read-only" description="Prefer read-only unless silos must write back.">
              <SettingsSwitch
                checked={readOnly}
                label="Read-only inside silos"
                onCheckedChange={setReadOnly}
              />
            </SettingsRow>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!hostPath.trim() || busy !== null}
                onClick={() =>
                  void run("add", async () => {
                    const result = await invokeNative<{
                      dirs: FarmHostDir[];
                      message?: string;
                    }>("farm.hostDirs.add", {
                      host: hostPath.trim(),
                      ...(targetPath.trim() ? { target: targetPath.trim() } : {}),
                      mode: readOnly ? "ro" : "rw",
                    });
                    setHostPath("");
                    setTargetPath("");
                    setReadOnly(false);
                    return result;
                  })
                }
              >
                <FolderPlusIcon />
                {busy === "add" ? "Adding…" : "Share folder"}
              </Button>
            </div>
            {notice && <p className="settings-inline-status type-caption">{notice}</p>}
            {error && (
              <p className="settings-inline-status type-caption text-destructive">{error}</p>
            )}
          </div>
        </div>
      </SettingsBlock>
    </>
  );
}

function RuntimeSection({ data, refresh }: { data: BootstrapData; refresh: () => Promise<void> }) {
  return (
    <>
      <SectionIntro title="Runtime & CLI" description="The desktop shell and CLI share this local installation." />
      <SettingsBlock
        title="Installation"
        actions={
          <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
            <RefreshCwIcon /> Refresh status
          </Button>
        }
      >
        <div className="settings-control-group">
          {[
            ["Farm CLI", data.install.cli || "Not found"],
            ["Native SDK", data.install.nativeCli || "Unknown"],
            ["State directory", data.install.state],
          ].map(([title, value]) => (
            <SettingsRow key={title} title={title}><code>{value}</code></SettingsRow>
          ))}
        </div>
      </SettingsBlock>
    </>
  );
}

function ProjectSection({ data }: { data: BootstrapData }) {
  // The CURRENT workspace (what the switcher points at), not the farm repo —
  // same seam App.tsx crossed: install.repo is where the CLI lives, the
  // workspace is what you're working on.
  const [workspace, setWorkspace] = useState<{ root: string; branch: string | null } | null>(null);
  useEffect(() => {
    const fetchWorkspace = () => {
      invokeNative<{ root: string; branch: string | null }>("farm.workspace.list")
        .then((result) => setWorkspace({ root: result.root, branch: result.branch }))
        .catch(() => setWorkspace(null));
    };
    fetchWorkspace();
    window.addEventListener("agensis:workspace-root-changed", fetchWorkspace);
    return () => window.removeEventListener("agensis:workspace-root-changed", fetchWorkspace);
  }, []);
  const root = workspace?.root || data.install.repo;
  const project = root?.split(/[\\/]/).filter(Boolean).pop() || "No project selected";
  return (
    <>
      <SectionIntro title="Project" description="The folder supplying sessions, profiles, expert files, and review state." />
      <SettingsBlock title={project} description={root || "Open a project folder to configure project-scoped settings."}>
        <div className="settings-control-group">
          {workspace?.branch && (
            <SettingsRow title="Checkout" description="Current branch of the workspace.">
              <span className="settings-inline-status">{workspace.branch}</span>
            </SettingsRow>
          )}
          <SettingsRow title="Farm CLI" description="CLI and desktop resolve the same install.">
            <span className="settings-inline-status"><CheckIcon />{data.install.ready ? "Connected" : "Unavailable"}</span>
          </SettingsRow>
        </div>
      </SettingsBlock>
    </>
  );
}

function ProfilesSection({ data }: { data: BootstrapData }) {
  return (
    <>
      <SectionIntro title="Equipment" description="Reusable kits applied to silos." />
      <SettingsBlock title={`${data.profiles.length} configured`}>
        <div className="settings-list">
          {data.profiles.map((profile) => (
            <div key={profile.name} className="settings-list-row">
              <div><strong>{profile.name}</strong><p>{profile.description}</p></div>
              <span>{profile.source === "bundled" ? "Bundled" : "Custom"}</span>
            </div>
          ))}
        </div>
      </SettingsBlock>
    </>
  );
}

function EquipmentSection({ data }: { data: BootstrapData }) {
  return (
    <>
      <SectionIntro title="Skills & tools" description="Equipment discovered from the current project and host." />
      {[
        ["Skills", data.catalog.skills],
        ["Experts", data.catalog.agents],
        ["Commands", data.catalog.commands],
        ["MCP servers", data.catalog.mcp],
      ].map(([title, values]) => (
        <SettingsBlock key={title as string} title={`${title} · ${(values as string[]).length}`}>
          <div className="settings-chip-list">
            {(values as string[]).slice(0, 80).map((value) => <span key={value}>{value}</span>)}
          </div>
        </SettingsBlock>
      ))}
    </>
  );
}

function ApiSection({ data, refresh }: { data: BootstrapData; refresh: () => Promise<void> }) {
  const [changing, setChanging] = useState(false);
  const toggle = async (running: boolean) => {
    setChanging(true);
    try {
      await invokeNative(running ? "farm.gateway.start" : "farm.gateway.stop", data.settings);
      await refresh();
    } finally {
      setChanging(false);
    }
  };
  return (
    <>
      <SectionIntro title="Gateway" description="Expose configured silos through the local compatibility API." />
      <SettingsBlock title="Local server" description={`${data.settings.host}:${data.settings.port}`}>
        <div className="settings-control-group">
          <SettingsRow title="Run gateway" description="Accept requests on the configured local endpoint.">
            <SettingsSwitch checked={data.gateway.running} disabled={changing} label="Run gateway" onCheckedChange={toggle} />
          </SettingsRow>
          <SettingsRow title="Status"><span className="settings-inline-status"><ServerIcon />{data.gateway.running ? "Online" : "Offline"}</span></SettingsRow>
        </div>
      </SettingsBlock>
    </>
  );
}

function SecuritySection() {
  return (
    <>
      <SectionIntro title="Security" description="Credential and execution boundaries for this project." />
      <SettingsBlock title="Provider credentials" description="OAuth tokens and provider configuration stay within each silo’s mounted home.">
        <div className="settings-notice">
          The gateway receives prompts and invokes the selected CLI. It does not copy provider credentials into shared project configuration.
        </div>
      </SettingsBlock>
    </>
  );
}

export interface SettingsWorkspaceProps {
  data: BootstrapData;
  refresh: () => Promise<void>;
  themeMode: SettingsThemeMode;
  setThemeMode: (mode: SettingsThemeMode) => void;
  appTheme: string;
  setAppTheme: (theme: string) => void;
  uiFont: SettingsUiFont;
  setUiFont: (font: SettingsUiFont) => void;
  secondaryFont: string;
  setSecondaryFont: (font: string) => void;
  monoFont: SettingsMonoFont;
  setMonoFont: (font: SettingsMonoFont) => void;
  uiFontSize: number;
  setUiFontSize: (size: number) => void;
  codeFontSize: number;
  setCodeFontSize: (size: number) => void;
}

export function SettingsWorkspace(props: SettingsWorkspaceProps) {
  const [activeId, setActiveId] = useState<SettingsSection>("preferences");
  const activeLabel = GROUPS.flatMap((group) => group.items).find((item) => item.id === activeId)?.label || "Settings";
  return (
    <div className="ok-settings-shell">
      <nav aria-label="Settings sections" className="ok-settings-sidebar">
        {GROUPS.map((group) => (
          <section key={group.id}>
            <h2>{group.label}</h2>
            <ul>
              {group.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={activeId === item.id ? "page" : undefined}
                    onClick={() => setActiveId(item.id)}
                    className={cn(activeId === item.id && "is-active")}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <footer>
          <span>v{props.data.app.version}</span>
          <button type="button" onClick={() => void props.refresh()}>Check status</button>
        </footer>
      </nav>
      <main aria-label={`${activeLabel} settings`} className="ok-settings-content" tabIndex={0}>
        {activeId === "preferences" ? <PreferencesSection {...props} /> : null}
        {activeId === "accounts" ? (
          <AccountsSection data={props.data} refresh={props.refresh} />
        ) : null}
        {activeId === "runtime" ? <RuntimeSection data={props.data} refresh={props.refresh} /> : null}
        {activeId === "project" ? <ProjectSection data={props.data} /> : null}
        {activeId === "profiles" ? <ProfilesSection data={props.data} /> : null}
        {activeId === "equipment" ? <EquipmentSection data={props.data} /> : null}
        {activeId === "api" ? <ApiSection data={props.data} refresh={props.refresh} /> : null}
        {activeId === "security" ? <SecuritySection /> : null}
      </main>
    </div>
  );
}
