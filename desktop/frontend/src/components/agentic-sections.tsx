import { useEffect, useState } from "react";
import {
  BotIcon,
  BrainIcon,
  ChevronRightIcon,
  CopyIcon,
  FileTextIcon,
  FolderGit2Icon,
  GitBranchIcon,
  HexagonIcon,
  MoreHorizontalIcon,
  PlusIcon,
  ServerIcon,
  SquareTerminalIcon,
  WorkflowIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { requestWiki } from "@/components/wiki-bus";
import {
  SidebarLeafRow,
  SidebarSection,
} from "@/components/workspace-sidebar";
import { cn } from "@/lib/utils";
import { vocab } from "@/lib/vocabulary";
import { invokeNative } from "@/lib/native";
import type { Worktree } from "@/components/worktrees-panel";

/** Wire shape of farm.agentic.list (public/backend/controller.mjs). Item
 *  paths are ABSOLUTE; project items resolve to workspace-relative paths
 *  for the wiki editor, global (~/.claude) and memory items live outside
 *  the workspace and stay read-only pointers. */
interface AgenticItem {
  name: string;
  path: string;
  fileCount: number;
  /** Directory items only: contained md/mdx/mjs/js/json/yaml/sh files
   *  (workspace-relative name within the item, absolute path, <=50). */
  files?: { name: string; path: string }[];
}
interface AgenticGroups {
  skills: AgenticItem[];
  commands: AgenticItem[];
  agents: AgenticItem[];
  workflows: AgenticItem[];
}
interface AgenticInventory {
  root: string;
  project: AgenticGroups;
  global: AgenticGroups;
  memory: AgenticItem[];
}

type Kind = keyof AgenticGroups;
type SectionKey = Kind | "memory";

const sections: { key: SectionKey; label: string; icon: typeof HexagonIcon }[] = [
  { key: "skills", label: "Skills", icon: HexagonIcon },
  { key: "commands", label: "Commands", icon: SquareTerminalIcon },
  // "Experts" = classic agent-definition files/templates (CLI/IDE persona
  // packs under .claude/agents). Key stays "agents" to match the on-disk
  // folder and inventory API.
  { key: "agents", label: vocab.experts, icon: BotIcon },
  { key: "workflows", label: "Workflows", icon: WorkflowIcon },
  { key: "memory", label: "Memory", icon: BrainIcon },
];

const isFileItem = (item: AgenticItem) => /\.[a-z0-9]+$/i.test(item.path);

const fileCountMeta = (count: number) =>
  count === 1 ? "1 file" : `${count} files`;

export interface AgenticOpenTarget {
  path: string;
  readOnly: boolean;
}

/** How a specific file/document should open: project markdown goes through
 *  the editable wiki (workspace-relative path); everything else — global
 *  scope, memory, or non-document extensions — opens read-only through
 *  farm.agentic.read (absolute path). */
function targetForPath(absolute: string, root: string): AgenticOpenTarget {
  if (absolute.startsWith(`${root}/`) && /\.mdx?$/i.test(absolute)) {
    return { path: absolute.slice(root.length + 1), readOnly: false };
  }
  return { path: absolute, readOnly: true };
}

/** The document an item's row click should open: the file itself, or the
 *  conventional entry file for a skill directory. Other directories toggle
 *  their nested file list instead. */
function openTarget(
  kind: SectionKey,
  item: AgenticItem,
  root: string,
): AgenticOpenTarget | null {
  if (isFileItem(item)) return targetForPath(item.path, root);
  if (kind === "skills") return targetForPath(`${item.path}/SKILL.md`, root);
  return null;
}

function ItemRow({
  item,
  target,
  root,
  active,
  onOpen,
}: {
  item: AgenticItem;
  target: AgenticOpenTarget | null;
  root: string;
  active: boolean;
  onOpen: (target: AgenticOpenTarget) => void;
}) {
  // Directory items expand to their contained files (nested under a left
  // rail, per the OK sidebar-tree template).
  const files = item.files || [];
  const [showFiles, setShowFiles] = useState(false);
  return (
    <>
      <SidebarLeafRow
        label={item.name}
        leading={<HexagonIcon />}
        active={active}
        muted={!target && !files.length}
        meta={fileCountMeta(item.fileCount)}
        title={item.path}
        onClick={
          target
            ? () => onOpen(target)
            : files.length
              ? () => setShowFiles((value) => !value)
              : undefined
        }
        trailing={
          <>
            {files.length > 0 && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${showFiles ? "Hide" : "Show"} files in ${item.name}`}
                aria-expanded={showFiles}
                onClick={() => setShowFiles((value) => !value)}
              >
                <ChevronRightIcon
                  className={cn("transition-transform", showFiles && "rotate-90")}
                />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Actions for ${item.name}`}
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {target && (
                  <DropdownMenuItem onSelect={() => onOpen(target)}>
                    <FileTextIcon />
                    Open in Wiki
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => void navigator.clipboard?.writeText(item.path)}
                >
                  <CopyIcon />
                  Copy path
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      {showFiles && files.length > 0 && (
        <div className="mb-1 ml-5 border-l pl-1">
          {files.map((file) => (
            <SidebarLeafRow
              key={file.path}
              label={file.name}
              leading={<FileTextIcon />}
              muted
              title={file.path}
              onClick={() => onOpen(targetForPath(file.path, root))}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ScopeGroup({
  label,
  kind,
  items,
  root,
  activeTarget,
  onOpen,
}: {
  label?: string;
  kind: SectionKey;
  items: AgenticItem[];
  root: string;
  activeTarget: string | null;
  onOpen: (target: AgenticOpenTarget) => void;
}) {
  if (!items.length) return null;
  return (
    <div className={label ? "pl-2" : undefined}>
      {label && <p className="px-2 pt-1 pb-0.5 type-caption">{label}</p>}
      {items.map((item) => {
        const target = openTarget(kind, item, root);
        return (
          <ItemRow
            key={item.path}
            item={item}
            target={target}
            root={root}
            active={Boolean(target && target.path === activeTarget)}
            onOpen={onOpen}
          />
        );
      })}
    </div>
  );
}

/**
 * Skills / Commands / Experts / Workflows / Memory sections for the main
 * sidebar — the OK sidebar-tree template (design-language
 * references/ok-patterns.md): SidebarSection header with glyph + chevron +
 * quiet "+", muted scope groups (Global above Project; Memory is
 * single-scope), hexagon item rows with "N files" mono meta and a hover
 * ellipsis menu.
 */
export function AgenticSections({
  onActivateWiki,
  onManageWorktrees,
}: {
  onActivateWiki?: () => void;
  /** Jump to the Crew page where worktrees are created/managed. */
  onManageWorktrees?: () => void;
}) {
  const [inventory, setInventory] = useState<AgenticInventory | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [worktreesExpanded, setWorktreesExpanded] = useState(false);
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    skills: false,
    commands: false,
    agents: false,
    workflows: false,
    memory: false,
  });
  const [activeTarget, setActiveTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchInventory = () => {
      invokeNative<AgenticInventory>("farm.agentic.list")
        .then((next) => {
          // A malformed reply must not take the whole app down (this sits in
          // the main sidebar) — only accept the full groups shape.
          if (!cancelled && next?.project?.skills && next?.global?.skills) setInventory(next);
        })
        .catch(() => {
          /* no bridge (plain browser) — sections render empty */
        });
      invokeNative<{ worktrees: Worktree[] }>("farm.worktree.list")
        .then((next) => {
          if (!cancelled && Array.isArray(next?.worktrees)) setWorktrees(next.worktrees);
        })
        .catch(() => {
          /* no bridge — worktree section stays empty */
        });
    };
    fetchInventory();
    window.addEventListener("agensis:workspace-root-changed", fetchInventory);
    window.addEventListener("agensis:worktrees-changed", fetchInventory);
    return () => {
      cancelled = true;
      window.removeEventListener(
        "agensis:workspace-root-changed",
        fetchInventory,
      );
      window.removeEventListener("agensis:worktrees-changed", fetchInventory);
    };
  }, []);

  const openDoc = (target: AgenticOpenTarget) => {
    setActiveTarget(target.path);
    onActivateWiki?.();
    if (target.readOnly) {
      requestWiki({ kind: "open-readonly", path: target.path });
    } else {
      // The bus's window listener buffers this until the wiki view mounts.
      window.dispatchEvent(
        new CustomEvent("agensis:open-wiki-doc", {
          detail: { path: target.path },
        }),
      );
    }
  };
  const createIn = (kind: Kind) => {
    onActivateWiki?.();
    requestWiki({ kind: "create", prefix: `.claude/${kind}/` });
  };

  return (
    <>
      {sections.map(({ key, label, icon: Icon }) => {
        const project =
          key === "memory" ? [] : inventory?.project[key] || [];
        const global = key === "memory" ? [] : inventory?.global[key] || [];
        const memory = key === "memory" ? inventory?.memory || [] : [];
        const empty = !project.length && !global.length && !memory.length;
        return (
          <SidebarSection
            key={key}
            id={`agentic-${key}`}
            label={label}
            icon={<Icon />}
            expanded={expanded[key]}
            onToggle={() =>
              setExpanded((value) => ({ ...value, [key]: !value[key] }))
            }
            actions={
              key !== "memory" ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`New ${label.toLowerCase().replace(/s$/, "")}`}
                  onClick={() => createIn(key)}
                >
                  <PlusIcon />
                </Button>
              ) : undefined
            }
          >
            {inventory && (
              <>
                {key === "memory" ? (
                  <ScopeGroup
                    kind={key}
                    items={memory}
                    root={inventory.root}
                    activeTarget={activeTarget}
                    onOpen={openDoc}
                  />
                ) : (
                  <>
                    <ScopeGroup
                      label="Global"
                      kind={key}
                      items={global}
                      root={inventory.root}
                      activeTarget={activeTarget}
                      onOpen={openDoc}
                    />
                    <ScopeGroup
                      label="Project"
                      kind={key}
                      items={project}
                      root={inventory.root}
                      activeTarget={activeTarget}
                      onOpen={openDoc}
                    />
                  </>
                )}
                {empty && (
                  <p className="px-4 py-1.5 type-caption">
                    No {label.toLowerCase()} yet.
                  </p>
                )}
              </>
            )}
          </SidebarSection>
        );
      })}
      <SidebarSection
        id="agentic-worktrees"
        label="Worktrees"
        icon={<FolderGit2Icon />}
        expanded={worktreesExpanded}
        onToggle={() => {
          setWorktreesExpanded((value) => !value);
          onManageWorktrees?.();
        }}
        actions={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="New worktree"
            onClick={(event) => {
              event.stopPropagation();
              onManageWorktrees?.();
            }}
          >
            <PlusIcon />
          </Button>
        }
      >
        {worktrees.length ? (
          worktrees.map((worktree) => (
            <SidebarLeafRow
              key={worktree.dir}
              label={worktree.name}
              leading={<GitBranchIcon />}
              meta={
                <span className="inline-flex items-center gap-1 type-caption">
                  {worktree.silo && (
                    <>
                      <ServerIcon className="size-3" />
                      {worktree.silo}
                    </>
                  )}
                  {worktree.dirty ? " ·" : ""}
                  {worktree.dirty ? (
                    <span className="text-(--signal)">
                      {worktree.changedFiles ?? 0}
                    </span>
                  ) : null}
                </span>
              }
              onClick={() => onManageWorktrees?.()}
            />
          ))
        ) : (
          <button
            type="button"
            className="w-full px-4 py-1.5 text-left type-caption text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => onManageWorktrees?.()}
          >
            No worktrees yet — create one on the Crew page.
          </button>
        )}
      </SidebarSection>
    </>
  );
}

export type { AgenticInventory, AgenticItem };
