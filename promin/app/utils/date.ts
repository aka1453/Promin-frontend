/**
 * Timezone-aware "today" utility.
 *
 * Returns YYYY-MM-DD for the given IANA timezone (defaults to UTC).
 * This matches the pattern used by all progress RPCs and DB CURRENT_DATE.
 *
 * For client components: prefer useUserTimezone().userToday or the
 * timezone string from that context.
 *
 * For non-React contexts (utilities, API routes): call this directly
 * with the appropriate timezone.
 */
export function todayForTimezone(timezone: string = "UTC"): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}
