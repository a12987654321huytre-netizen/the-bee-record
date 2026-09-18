const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_SLASH = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;
const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

export type ParsedDate = {
  iso: string | null;
  raw: string;
  ambiguous: boolean;
  warning: string | null;
};

export type ParseDateOptions = {
  /** South African certificates use DD/MM/YYYY. Only apply when the date is labeled. */
  assumeDmy?: boolean;
};

export function toIsoDate(value: string | Date | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonthsIso(iso: string, months: number): string | null {
  const m = iso.match(ISO);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1 + months, d));
  if (dt.getUTCDate() !== d) {
    dt.setUTCDate(0);
  }
  return dt.toISOString().slice(0, 10);
}

export function parseDate(raw: string | null | undefined, options: ParseDateOptions = {}): ParsedDate {
  if (!raw || !raw.trim()) {
    return { iso: null, raw: raw ?? "", ambiguous: false, warning: null };
  }
  const trimmed = raw.replace(/\s+/g, " ").trim();
  const isoMatch = trimmed.match(ISO);
  if (isoMatch) {
    return validateIso(trimmed, trimmed);
  }
  const long = trimmed.match(
    /^(\d{1,2})[/\-\s]+([A-Za-z]{3,9})[/\-\s,]+(\d{4})$|^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/,
  );
  if (long) {
    if (long[1] && long[2] && long[3]) {
      const month = MONTHS[long[2].toLowerCase()];
      if (month) return validateIso(`${long[3]}-${month}-${pad(long[1])}`, trimmed);
    }
    if (long[4] && long[5] && long[6]) {
      const month = MONTHS[long[4].toLowerCase()];
      if (month) return validateIso(`${long[6]}-${month}-${pad(long[5])}`, trimmed);
    }
  }
  const slash = trimmed.match(DMY_SLASH);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = slash[3]!;
    if (a > 12 && b <= 12) {
      return validateIso(`${y}-${pad(String(b))}-${pad(String(a))}`, trimmed);
    }
    if (b > 12 && a <= 12) {
      return validateIso(`${y}-${pad(String(a))}-${pad(String(b))}`, trimmed);
    }
    if (options.assumeDmy && a <= 12 && b <= 12) {
      const parsed = validateIso(`${y}-${pad(String(b))}-${pad(String(a))}`, trimmed);
      if (parsed.iso) {
        return {
          ...parsed,
          warning: `Interpreted "${trimmed}" as DD/MM/YYYY (South African certificate convention).`,
        };
      }
      return parsed;
    }
    return {
      iso: null,
      raw: trimmed,
      ambiguous: true,
      warning: `Ambiguous date "${trimmed}" — not guessed.`,
    };
  }
  return {
    iso: null,
    raw: trimmed,
    ambiguous: true,
    warning: `Unrecognised date "${trimmed}" — left unknown.`,
  };
}

function pad(n: string): string {
  return n.padStart(2, "0");
}

function validateIso(iso: string, raw: string): ParsedDate {
  const m = iso.match(ISO);
  if (!m) return { iso: null, raw, ambiguous: true, warning: "Invalid date." };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) {
    return { iso: null, raw, ambiguous: false, warning: `Impossible date "${iso}".` };
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { iso: null, raw, ambiguous: false, warning: `Impossible date "${iso}".` };
  }
  return { iso, raw, ambiguous: false, warning: null };
}

export function formatDisplayDate(iso: string | Date | null | undefined): string {
  const value = toIsoDate(iso);
  if (!value) return "";
  const m = value.match(ISO);
  if (!m) return value;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

export function compareIso(a: string | Date | null | undefined, b: string | Date | null | undefined): number {
  const aa = toIsoDate(a);
  const bb = toIsoDate(b);
  if (!aa && !bb) return 0;
  if (!aa) return -1;
  if (!bb) return 1;
  return aa < bb ? -1 : aa > bb ? 1 : 0;
}

export function daysBetween(a: string, b: string): number | null {
  const aa = toIsoDate(a);
  const bb = toIsoDate(b);
  if (!aa || !bb) return null;
  const ms = Date.parse(`${bb}T00:00:00Z`) - Date.parse(`${aa}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86_400_000);
}

export function expiryStatus(
  expiryDate: string | Date | null | undefined,
  lifecycle: string,
  expiringSoonDays: number,
  now = todayIso(),
): string {
  const expiry = toIsoDate(expiryDate);
  if (!expiry) {
    if (lifecycle === "current" || lifecycle === "expiring_soon") return "unknown_validity";
    return lifecycle;
  }
  if (expiry < now) return "expired";
  if (lifecycle === "current" || lifecycle === "expiring_soon") {
    const limit = addDaysIso(now, expiringSoonDays);
    if (expiry <= limit) return "expiring_soon";
    if (lifecycle === "expiring_soon") return "current";
  }
  return lifecycle;
}
