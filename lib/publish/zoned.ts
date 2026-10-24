import { addDays, dateKeyIn, timeZoneOffsetMinutes, zonedDayStartUtc } from "../dates"

/*
 * Wall-clock times in the user's timezone (settings.timeZone), for the
 * schedule picker and labels. No Node or DB imports: the browser uses these.
 * "Local" values are `YYYY-MM-DDTHH:mm`, the format of <input type="datetime-local">.
 */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** UTC ISO instant for a wall-clock time in `timeZone`; null when malformed. */
export function zonedLocalToUtc(local: string, timeZone: string): string | null {
  const m = local.match(LOCAL_RE)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  const naive = Date.UTC(y, mo - 1, d, h, mi)
  // Re-check the offset at the computed instant so DST edges land right.
  let instant = naive - timeZoneOffsetMinutes(new Date(naive), timeZone) * 60_000
  instant = naive - timeZoneOffsetMinutes(new Date(instant), timeZone) * 60_000
  return new Date(instant).toISOString()
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), weekday: get("weekday") }
}

/** `YYYY-MM-DDTHH:mm` in `timeZone` for a UTC instant. */
export function utcToZonedLocal(iso: string | Date, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
export const weekdayName = (weekday: number) => WEEKDAYS[weekday]

/** Weekday (0 = Sunday) and hour (0–23) of an instant in `timeZone`. */
export function zonedWeekdayHour(date: Date, timeZone: string): { weekday: number; hour: number } {
  const p = zonedParts(date, timeZone)
  return { weekday: WEEKDAYS.indexOf(p.weekday), hour: Number(p.hour) }
}

/** "Sat 25 Oct, 18:00" in `timeZone`. */
export function formatInZone(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(iso))
    .replace("Sept", "Sep")
}

/** UTC instant of the first moment of the current month in `timeZone`. */
export function monthStartUtc(now: Date, timeZone: string): string {
  return zonedDayStartUtc(`${dateKeyIn(now, timeZone).slice(0, 7)}-01`, timeZone)
}

/** Next wall-clock `weekday` at `hour`:00 in `timeZone` that is at least `leadMinutes` away. */
export function nextZonedSlot(
  now: Date,
  timeZone: string,
  weekday: number,
  hour: number,
  leadMinutes = 5
): { local: string; utc: string } {
  const today = dateKeyIn(now, timeZone)
  for (let i = 0; i <= 7; i++) {
    const key = addDays(today, i)
    if (new Date(`${key}T00:00:00Z`).getUTCDay() !== weekday) continue
    const local = `${key}T${String(hour).padStart(2, "0")}:00`
    const utc = zonedLocalToUtc(local, timeZone)!
    if (Date.parse(utc) >= now.getTime() + leadMinutes * 60_000) return { local, utc }
  }
  // Same weekday next week.
  const local = `${addDays(today, 7)}T${String(hour).padStart(2, "0")}:00`
  return { local, utc: zonedLocalToUtc(local, timeZone)! }
}
