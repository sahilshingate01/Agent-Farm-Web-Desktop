import { Fragment } from "react";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, RotateCcwIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface AdvancedOption {
  value: string;
  label: string;
  description?: string;
  /** Eyebrow header: consecutive options sharing a group render under one
   *  type-label heading (elevators-first silo menu, spec D). */
  group?: string;
  /** The advisor's happy-path row — marked with a --success dot in every
   *  mode so manual users still see the recommended pick. */
  recommended?: boolean;
}

interface AdvancedRow {
  key: string;
  label: string;
  icon?: React.ReactNode;
  value: string;
  valueLabel: string;
  options: AdvancedOption[];
  onChange: (value: string) => void;
}

/** Codex-style consolidated composer selector: one quiet chip ("claude ·
 *  Medium") opening Silo / Provider / Model / Effort rows — label left,
 *  current value right-muted, chevron; each row a submenu of captioned,
 *  check-marked options. */
export function ComposerAdvanced({
  triggerLabel,
  rows,
  onReset,
  leading,
  className,
}: {
  triggerLabel: string;
  rows: AdvancedRow[];
  onReset?: () => void;
  /** e.g. the stacked silo avatars for the current selection */
  leading?: React.ReactNode;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 max-w-64 items-center gap-1.5 rounded-full bg-muted/60 px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted",
            className,
          )}
          aria-label="Session settings"
        >
          {leading}
          <span className="truncate">{triggerLabel}</span>
          <ChevronDownIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-64">
        {rows.map((row) => (
          <DropdownMenuSub key={row.key}>
            <DropdownMenuSubTrigger className="gap-3 py-2 [&>svg:last-child]:hidden">
              {row.icon && <span className="[&_svg]:size-4 text-muted-foreground">{row.icon}</span>}
              <span className="flex-1">{row.label}</span>
              <span className="max-w-28 truncate text-muted-foreground">{row.valueLabel}</span>
              <ChevronRightIcon className="size-3.5 text-muted-foreground" />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <DropdownMenuLabel className="type-caption font-normal">{row.label}</DropdownMenuLabel>
              {row.options.map((option, index) => (
                <Fragment key={option.value}>
                  {option.group && option.group !== row.options[index - 1]?.group && (
                    <p className="px-2 pb-1 pt-2 type-label">{option.group}</p>
                  )}
                  <button
                    type="button"
                    className="flex w-full cursor-default items-center gap-3 rounded-md px-2 py-1.5 text-left type-list hover:bg-accent"
                    onClick={() => row.onChange(option.value)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.description && (
                        <span className="block truncate type-caption">{option.description}</span>
                      )}
                    </span>
                    {option.recommended && (
                      <span
                        aria-label="Recommended"
                        title="Recommended"
                        className="size-1.5 shrink-0 rounded-full bg-(--success)"
                      />
                    )}
                    {option.value === row.value && <CheckIcon className="size-4 shrink-0" />}
                  </button>
                </Fragment>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        {onReset && (
          <>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              className="flex w-full cursor-default items-center gap-3 rounded-md px-2 py-2 text-left type-list text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onReset}
            >
              <span className="flex-1">Reset to default</span>
              <RotateCcwIcon className="size-3.5" />
            </button>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
