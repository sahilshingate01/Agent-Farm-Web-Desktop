import { CheckIcon, ChevronRightIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface ComposerSelectOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
}

export function ComposerSelect({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: ComposerSelectOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const selected = options.find((option) => option.value === value);
  const groups = Array.from(new Set(options.map((option) => option.group).filter(Boolean))) as string[];
  const ungrouped = options.filter((option) => !option.group);
  const item = (option: ComposerSelectOption) => (
    <DropdownMenuItem key={option.value} onClick={() => onChange(option.value)} className="gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{option.label}</span>
        {option.description ? <span className="block truncate text-xs text-muted-foreground">{option.description}</span> : null}
      </span>
      {option.value === value ? <CheckIcon className="size-4" /> : null}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("inline-flex h-8 max-w-44 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted", className)}
          aria-label={label}
        >
          <span className="truncate">{selected?.label || value || label}</span>
          <ChevronRightIcon className="size-3.5 rotate-90" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ungrouped.map(item)}
        {groups.map((group) => (
          <DropdownMenuSub key={group}>
            <DropdownMenuSubTrigger>{group}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72">
              {options.filter((option) => option.group === group).map(item)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
