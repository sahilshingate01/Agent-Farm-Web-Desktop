import {
  ActivityIcon,
  CpuIcon,
  FileTextIcon,
  FolderIcon,
  Layers3Icon,
  ListTodoIcon,
  MessageSquareIcon,
  RouteIcon,
  Settings2Icon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { vocab } from "@/lib/vocabulary";
import type { WorkspaceSidebarView } from "@/components/workspace-sidebar";
import type { ChatSession, FarmAccount, FarmProfile } from "@/types/farm";

interface GlobalCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  sessions: ChatSession[];
  accounts: FarmAccount[];
  profiles: FarmProfile[];
  onNavigate: (view: WorkspaceSidebarView) => void;
  onSelectSession: (id: string) => void;
  onSelectProfile: (name: string) => void;
}

const destinations: Array<{
  view: WorkspaceSidebarView;
  label: string;
  icon: typeof ActivityIcon;
  shortcut?: string;
}> = [
  { view: "overview", label: vocab.crew, icon: ActivityIcon },
  { view: "projects", label: "Projects", icon: FolderIcon },
  { view: "silos", label: vocab.silos, icon: CpuIcon },
  { view: "profiles", label: vocab.equipment, icon: Layers3Icon },
  { view: "chores", label: vocab.chores, icon: ListTodoIcon },
  { view: "chat", label: vocab.jobs, icon: MessageSquareIcon },
  { view: "documents", label: "Wiki", icon: FileTextIcon },
  { view: "settings", label: "Settings", icon: Settings2Icon, shortcut: "⌘," },
  { view: "gateway", label: "Gateway", icon: RouteIcon },
];

export function GlobalCommandPalette({
  open,
  onOpenChange,
  projectName,
  sessions,
  accounts,
  profiles,
  onNavigate,
  onSelectSession,
  onSelectProfile,
}: GlobalCommandPaletteProps) {
  const run = (action: () => void) => {
    action();
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search Agent Farm"
      description="Search views, projects, sessions, agent silos, and profiles."
      className="global-command-palette sm:max-w-2xl"
      showCloseButton={false}
    >
      <CommandInput autoFocus placeholder="Search Agent Farm or run a command" />
      <CommandList className="max-h-[min(62vh,34rem)]">
        <CommandEmpty>No matching view, session, silo, or profile.</CommandEmpty>
        <CommandGroup heading="Go to">
          {destinations.map(({ view, label, icon: Icon, shortcut }) => (
            <CommandItem key={view} value={`${label} ${view}`} onSelect={() => run(() => onNavigate(view))}>
              <Icon />
              <span>{label}</span>
              {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Current project">
          <CommandItem value={`project ${projectName}`} onSelect={() => run(() => onNavigate("projects"))}>
            <FolderIcon />
            <span>{projectName}</span>
          </CommandItem>
        </CommandGroup>
        {sessions.length > 0 && (
          <CommandGroup heading="Sessions">
            {sessions.map((session) => (
              <CommandItem
                key={session.id}
                value={`session task ${session.title} ${session.model} ${session.project || ""}`}
                onSelect={() => run(() => onSelectSession(session.id))}
              >
                <MessageSquareIcon />
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                <CommandShortcut>{session.project || session.model}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {accounts.length > 0 && (
          <CommandGroup heading="Agent Silos">
            {accounts.map((account) => (
              <CommandItem
                key={account.name}
                value={`agent silo container ${account.name}`}
                onSelect={() => run(() => onNavigate("silos"))}
              >
                <CpuIcon />
                <span>{account.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {profiles.length > 0 && (
          <CommandGroup heading="Profiles">
            {profiles.map((profile) => (
              <CommandItem
                key={profile.name}
                value={`profile ${profile.name} ${profile.description || ""}`}
                onSelect={() => run(() => onSelectProfile(profile.name))}
              >
                <Layers3Icon />
                <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                {profile.readOnly && <CommandShortcut>Bundled</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
