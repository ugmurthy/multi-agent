const CRON_NICKNAMES: Record<string, string> = {
  '@annually': '0 0 1 1 *',
  '@daily': '0 0 * * *',
  '@hourly': '0 * * * *',
  '@midnight': '0 0 * * *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@yearly': '0 0 1 1 *',
};

const MONTH_NAMES: Record<string, number> = {
  JAN: 1,
  JANUARY: 1,
  FEB: 2,
  FEBRUARY: 2,
  MAR: 3,
  MARCH: 3,
  APR: 4,
  APRIL: 4,
  MAY: 5,
  JUN: 6,
  JUNE: 6,
  JUL: 7,
  JULY: 7,
  AUG: 8,
  AUGUST: 8,
  SEP: 9,
  SEPTEMBER: 9,
  OCT: 10,
  OCTOBER: 10,
  NOV: 11,
  NOVEMBER: 11,
  DEC: 12,
  DECEMBER: 12,
};

const DAY_NAMES: Record<string, number> = {
  SUN: 0,
  SUNDAY: 0,
  MON: 1,
  MONDAY: 1,
  TUE: 2,
  TUESDAY: 2,
  WED: 3,
  WEDNESDAY: 3,
  THU: 4,
  THURSDAY: 4,
  FRI: 5,
  FRIDAY: 5,
  SAT: 6,
  SATURDAY: 6,
};

const SEARCH_LIMIT_MINUTES = 60 * 24 * 366 * 4;

interface CronField {
  wildcard: boolean;
  values: Set<number>;
}

interface ParsedCronSchedule {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

export function computeNextCronFireAt(schedule: string, relativeDate: Date | string | number): Date | null {
  const parsed = parseCronSchedule(schedule);
  const start = normalizeDate(relativeDate);

  const cursor = new Date(start.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  for (let offset = 0; offset <= SEARCH_LIMIT_MINUTES; offset += 1) {
    if (matchesCronSchedule(parsed, cursor)) {
      return new Date(cursor.getTime());
    }

    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  return null;
}

function parseCronSchedule(schedule: string): ParsedCronSchedule {
  const normalizedSchedule = normalizeSchedule(schedule);
  const fields = normalizedSchedule.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron schedule must have 5 fields, received ${fields.length}.`);
  }

  return {
    minute: parseCronField(fields[0]!, { min: 0, max: 59, label: 'minute' }),
    hour: parseCronField(fields[1]!, { min: 0, max: 23, label: 'hour' }),
    dayOfMonth: parseCronField(fields[2]!, { min: 1, max: 31, label: 'day-of-month' }),
    month: parseCronField(fields[3]!, { min: 1, max: 12, label: 'month', aliases: MONTH_NAMES }),
    dayOfWeek: parseCronField(fields[4]!, {
      min: 0,
      max: 7,
      label: 'day-of-week',
      aliases: DAY_NAMES,
      normalizeValue: (value) => (value === 7 ? 0 : value),
    }),
  };
}

function normalizeSchedule(schedule: string): string {
  const normalized = schedule.trim();
  if (!normalized) {
    throw new Error('Cron schedule must be a non-empty string.');
  }

  return CRON_NICKNAMES[normalized.toLowerCase()] ?? normalized;
}

function parseCronField(
  expression: string,
  options: {
    min: number;
    max: number;
    label: string;
    aliases?: Record<string, number>;
    normalizeValue?: (value: number) => number;
  },
): CronField {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error(`Cron ${options.label} field must not be empty.`);
  }

  if (trimmed === '*') {
    return {
      wildcard: true,
      values: buildFullRange(options.min, options.max, options.normalizeValue),
    };
  }

  const values = new Set<number>();

  for (const part of trimmed.split(',')) {
    parseCronPart(part.trim(), values, options);
  }

  if (values.size === 0) {
    throw new Error(`Cron ${options.label} field must resolve to at least one value.`);
  }

  return {
    wildcard: false,
    values,
  };
}

function parseCronPart(
  part: string,
  values: Set<number>,
  options: {
    min: number;
    max: number;
    label: string;
    aliases?: Record<string, number>;
    normalizeValue?: (value: number) => number;
  },
): void {
  if (!part) {
    throw new Error(`Cron ${options.label} field contains an empty list item.`);
  }

  const [base, stepExpression] = part.split('/');
  if (stepExpression !== undefined && stepExpression.length === 0) {
    throw new Error(`Cron ${options.label} field has an empty step value.`);
  }

  const step = stepExpression === undefined ? 1 : parsePositiveInteger(stepExpression, options.label);

  if (base === '*') {
    for (let value = options.min; value <= options.max; value += step) {
      values.add(normalizeCronValue(value, options.normalizeValue));
    }
    return;
  }

  const [rangeStart, rangeEnd] = splitRange(base, options.label);
  const start = parseCronValue(rangeStart, options);
  const end = rangeEnd === undefined ? start : parseCronValue(rangeEnd, options);

  if (start > end) {
    throw new Error(`Cron ${options.label} field range "${base}" must be ascending.`);
  }

  for (let value = start; value <= end; value += step) {
    values.add(normalizeCronValue(value, options.normalizeValue));
  }
}

function splitRange(expression: string, label: string): [string, string | undefined] {
  const separatorIndex = expression.indexOf('-');
  if (separatorIndex === -1) {
    return [expression, undefined];
  }

  const start = expression.slice(0, separatorIndex).trim();
  const end = expression.slice(separatorIndex + 1).trim();
  if (!start || !end) {
    throw new Error(`Cron ${label} field range "${expression}" is invalid.`);
  }

  return [start, end];
}

function parseCronValue(
  expression: string,
  options: {
    min: number;
    max: number;
    label: string;
    aliases?: Record<string, number>;
  },
): number {
  const aliasValue = options.aliases?.[expression.toUpperCase()];
  const numericValue = aliasValue ?? Number.parseInt(expression, 10);

  if (!Number.isInteger(numericValue)) {
    throw new Error(`Cron ${options.label} field value "${expression}" is invalid.`);
  }

  if (numericValue < options.min || numericValue > options.max) {
    throw new Error(
      `Cron ${options.label} field value "${expression}" must be between ${options.min} and ${options.max}.`,
    );
  }

  return numericValue;
}

function parsePositiveInteger(expression: string, label: string): number {
  const value = Number.parseInt(expression, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Cron ${label} field step "${expression}" must be a positive integer.`);
  }
  return value;
}

function normalizeCronValue(value: number, normalizeValue?: (value: number) => number): number {
  return normalizeValue ? normalizeValue(value) : value;
}

function buildFullRange(min: number, max: number, normalizeValue?: (value: number) => number): Set<number> {
  const values = new Set<number>();
  for (let value = min; value <= max; value += 1) {
    values.add(normalizeCronValue(value, normalizeValue));
  }
  return values;
}

function matchesCronSchedule(schedule: ParsedCronSchedule, date: Date): boolean {
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dayOfWeek = date.getUTCDay();

  if (!schedule.minute.values.has(minute) || !schedule.hour.values.has(hour) || !schedule.month.values.has(month)) {
    return false;
  }

  const matchesDayOfMonth = schedule.dayOfMonth.values.has(dayOfMonth);
  const matchesDayOfWeek = schedule.dayOfWeek.values.has(dayOfWeek);

  if (!schedule.dayOfMonth.wildcard && !schedule.dayOfWeek.wildcard) {
    return matchesDayOfMonth || matchesDayOfWeek;
  }

  if (!schedule.dayOfMonth.wildcard) {
    return matchesDayOfMonth;
  }

  if (!schedule.dayOfWeek.wildcard) {
    return matchesDayOfWeek;
  }

  return true;
}

function normalizeDate(value: Date | string | number): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Cron relative date must be a valid date.');
  }
  return date;
}
