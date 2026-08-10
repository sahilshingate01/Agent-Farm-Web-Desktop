/** One place for wall-clock rendering. Provider reset stamps arrive as UTC
 *  instants (the controller normalizes naive strings); everything the user
 *  sees goes through here so the app renders in THEIR timezone — the system
 *  zone by default, or an explicit override from Preferences. */

const STORAGE_KEY = "usage-farm-timezone";

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** undefined = follow the system (Intl default). */
export function appTimeZone(): string | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return !stored || stored === "auto" ? undefined : stored;
  } catch {
    return undefined;
  }
}

export function setAppTimeZone(zone: string) {
  localStorage.setItem(STORAGE_KEY, zone);
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: appTimeZone(),
  });
}
