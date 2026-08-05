import * as React from "react"
import {
  BirdIcon,
  BugIcon,
  CatIcon,
  DogIcon,
  EggIcon,
  FishIcon,
  PawPrintIcon,
  PiggyBankIcon,
  RabbitIcon,
  RatIcon,
  SnailIcon,
  SquirrelIcon,
  TractorIcon,
  TurtleIcon,
  WheatIcon,
  WormIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export type SiloPet = {
  id: string
  label: string
  icon: LucideIcon
}

export const SILO_PETS: SiloPet[] = [
  { id: "cat", label: "Cat", icon: CatIcon },
  { id: "dog", label: "Dog", icon: DogIcon },
  { id: "bird", label: "Bird", icon: BirdIcon },
  { id: "rabbit", label: "Rabbit", icon: RabbitIcon },
  { id: "squirrel", label: "Squirrel", icon: SquirrelIcon },
  { id: "turtle", label: "Turtle", icon: TurtleIcon },
  { id: "fish", label: "Fish", icon: FishIcon },
  { id: "bug", label: "Bug", icon: BugIcon },
  { id: "rat", label: "Rat", icon: RatIcon },
  { id: "snail", label: "Snail", icon: SnailIcon },
  { id: "worm", label: "Worm", icon: WormIcon },
  { id: "piggy", label: "Piggy", icon: PiggyBankIcon },
  { id: "paw", label: "Paw", icon: PawPrintIcon },
  { id: "egg", label: "Egg", icon: EggIcon },
  { id: "wheat", label: "Wheat", icon: WheatIcon },
  { id: "tractor", label: "Tractor", icon: TractorIcon },
]

export const SILO_COLORS: string[] = [
  "bg-primary/15 text-primary",
  "bg-success/15 text-success",
  "bg-signal/15 text-signal",
  "bg-destructive/15 text-destructive",
  "bg-secondary text-secondary-foreground",
  "bg-accent text-accent-foreground",
  "bg-muted text-foreground",
  "bg-muted-foreground/15 text-muted-foreground",
]

type SiloAvatarEntry = { pet: string; color: number }
type SiloAvatarMap = Record<string, SiloAvatarEntry>

const STORAGE_KEY = "usage-farm-silo-avatars"
const CHANGE_EVENT = "agensis:silo-avatar-changed"

function readSiloAvatars(): SiloAvatarMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SiloAvatarMap) : {}
  } catch {
    return {}
  }
}

function writeSiloAvatar(name: string, entry: SiloAvatarEntry | null) {
  const map = readSiloAvatars()
  if (entry) {
    map[name] = entry
  } else {
    delete map[name]
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { name } }))
}

const SIZES = {
  sm: { tile: "size-6", icon: "size-3.5" },
  md: { tile: "size-10", icon: "size-5" },
  lg: { tile: "size-12", icon: "size-6" },
} as const

export function SiloAvatar({
  name,
  size = "md",
  className,
}: {
  name: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const [entry, setEntry] = React.useState<SiloAvatarEntry | undefined>(
    () => readSiloAvatars()[name],
  )

  React.useEffect(() => {
    const sync = () => setEntry(readSiloAvatars()[name])
    sync()
    window.addEventListener(CHANGE_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [name])

  const { tile, icon } = SIZES[size]
  const pet = entry && SILO_PETS.find((item) => item.id === entry.pet)

  if (!entry || !pet) {
    return (
      <span
        className={cn(
          "grid place-items-center rounded-lg bg-muted font-semibold uppercase",
          tile,
          className,
        )}
      >
        {name.slice(0, 1)}
      </span>
    )
  }

  const Icon = pet.icon
  const colorClass = SILO_COLORS[entry.color % SILO_COLORS.length]

  return (
    <span
      className={cn(
        "grid place-items-center rounded-lg",
        tile,
        colorClass,
        className,
      )}
    >
      <Icon className={icon} />
    </span>
  )
}

export function SiloAvatarPicker({
  name,
  onSaved,
}: {
  name: string
  onSaved?: () => void
}) {
  const [open, setOpen] = React.useState(false)

  const save = (petId: string, color: number) => {
    writeSiloAvatar(name, { pet: petId, color })
    onSaved?.()
    setOpen(false)
  }

  const reset = () => {
    writeSiloAvatar(name, null)
    onSaved?.()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <SiloAvatar name={name} size="md" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid grid-cols-4 gap-1.5">
          {SILO_PETS.map((pet) => {
            const Icon = pet.icon
            return (
              <button
                key={pet.id}
                type="button"
                title={pet.label}
                onClick={() => save(pet.id, readSiloAvatars()[name]?.color ?? 0)}
                className="grid size-10 place-items-center rounded-lg bg-muted text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Icon className="size-5" />
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          {SILO_COLORS.map((colorClass, index) => (
            <button
              key={colorClass}
              type="button"
              onClick={() =>
                save(readSiloAvatars()[name]?.pet ?? SILO_PETS[0].id, index)
              }
              className={cn(
                "size-6 rounded-full ring-1 ring-border transition-transform hover:scale-110",
                colorClass,
              )}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={reset}
          className="mt-3 w-full rounded-md py-1 text-center type-label hover:bg-accent hover:text-accent-foreground"
        >
          Use initial
        </button>
      </PopoverContent>
    </Popover>
  )
}
