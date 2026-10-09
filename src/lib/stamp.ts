// Dates in meta.json are plain ISO days, so every part is read in UTC.
const month = (day: Date): string => day.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })

export function eventStamp(eventStart: string, eventEnd: string): string {
  const start = new Date(eventStart)
  const end = new Date(eventEnd)
  const tail =
    month(start) === month(end)
      ? `${end.getUTCDate()}`
      : `${month(end)} ${end.getUTCDate()}`
  return `${month(start)} ${start.getUTCDate()} to ${tail}`
}
