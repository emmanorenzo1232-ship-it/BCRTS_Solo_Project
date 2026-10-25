export function todayInBarangay() {
  // Philippine time is UTC+8, regardless of the browser's time zone.
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function formatAppointmentDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
  })
}

export function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function formatAppointmentTime(value: string) {
  return new Date(`2000-01-01T${value}Z`).toLocaleTimeString(undefined, {
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit',
  })
}
