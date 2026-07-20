export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_LIFECYCLE_WEEKS = {
  FIRST_REMINDER: 52,
  SECOND_REMINDER: 54,
  FINAL_REMINDER: 56,
  DEACTIVATE: 58,
  PURGE: 62,
} as const;

export type LifecycleAction =
  | "FIRST_REMINDER"
  | "SECOND_REMINDER"
  | "FINAL_REMINDER"
  | "DEACTIVATE"
  | "PURGE";

export interface LifecycleDates {
  firstReminderAt: Date;
  secondReminderAt: Date;
  finalReminderAt: Date;
  deactivateAt: Date;
  purgeAt: Date;
}

function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * WEEK_MS);
}

export function lifecycleDates(
  lastVerifiedAt: Date,
  weeks: typeof DEFAULT_LIFECYCLE_WEEKS = DEFAULT_LIFECYCLE_WEEKS,
): LifecycleDates {
  return {
    firstReminderAt: addWeeks(lastVerifiedAt, weeks.FIRST_REMINDER),
    secondReminderAt: addWeeks(lastVerifiedAt, weeks.SECOND_REMINDER),
    finalReminderAt: addWeeks(lastVerifiedAt, weeks.FINAL_REMINDER),
    deactivateAt: addWeeks(lastVerifiedAt, weeks.DEACTIVATE),
    purgeAt: addWeeks(lastVerifiedAt, weeks.PURGE),
  };
}

export function lifecycleActionsDue(
  lastVerifiedAt: Date,
  now: Date,
): LifecycleAction[] {
  const dates = lifecycleDates(lastVerifiedAt);
  const actions: LifecycleAction[] = [];
  if (now >= dates.firstReminderAt) actions.push("FIRST_REMINDER");
  if (now >= dates.secondReminderAt) actions.push("SECOND_REMINDER");
  if (now >= dates.finalReminderAt) actions.push("FINAL_REMINDER");
  if (now >= dates.deactivateAt) actions.push("DEACTIVATE");
  if (now >= dates.purgeAt) actions.push("PURGE");
  return actions;
}

const chicagoFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  dateStyle: "long",
});

export function formatChurchDate(date: Date): string {
  return chicagoFormatter.format(date);
}
