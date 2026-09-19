import { toIsoDate } from "./dates.ts";

export type DatePrecision = "day" | "month" | "year";

export type ResolvedEvidenceDate = {
  iso: string | null;
  precision: DatePrecision | null;
  raw: string | null;
  label: string;
  year: number | null;
  month: number | null;
  stated: boolean;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_NAMES = [
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

const MONTH_TOKEN = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

export const NOT_STATED_IN_SOURCE = "Not stated in source";

export type EvidenceDateInput = {
  issueDate?: string | Date | null;
  awardDate?: string | Date | null;
  issueDateRaw?: string | null;
  precision?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  createdAt?: string | Date | null;
  retrievedAt?: string | Date | null;
  discoveredAt?: string | Date | null;
};

function monthNum(token: string | null | undefined): number | null {
  if (!token) return null;
  const n = MONTHS[token.toLowerCase()];
  return n ?? null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function decodeBlob(value: string): string {
  let s = value.replace(/\+/g, " ");
  try {
    s = decodeURIComponent(s);
  } catch {
    s = s.replace(/%20/g, " ").replace(/%2F/gi, "/");
  }
  return s.replace(/[_-]+/g, " ");
}

function sameCalendarDay(a: string | Date | null | undefined, b: string | Date | null | undefined): boolean {
  const aa = toIsoDate(a);
  const bb = toIsoDate(b);
  return Boolean(aa && bb && aa === bb);
}

export function isImportTimestampDate(input: EvidenceDateInput): boolean {
  const stored = toIsoDate(input.issueDate) ?? toIsoDate(input.awardDate);
  if (!stored) return false;
  return (
    sameCalendarDay(stored, input.createdAt) ||
    sameCalendarDay(stored, input.retrievedAt) ||
    sameCalendarDay(stored, input.discoveredAt)
  );
}

export function formatEvidenceDateLabel(
  iso: string | null | undefined,
  precision: DatePrecision | string | null | undefined,
  raw?: string | null,
): string {
  if (raw?.trim() && !/^\d{4}-\d{2}-\d{2}/.test(raw.trim())) {
    const pretty = prettyMonthYear(raw.trim());
    if (pretty) return pretty;
  }
  const value = toIsoDate(iso);
  if (!value) return NOT_STATED_IN_SOURCE;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  if (!y || !m) return NOT_STATED_IN_SOURCE;
  if (precision === "year") return String(y);
  if (precision === "month") return `${MONTH_NAMES[m - 1]} ${y}`;
  if (precision === "day") return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
  if (d === 1) return `${MONTH_NAMES[m - 1]} ${y}`;
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

function prettyMonthYear(raw: string): string | null {
  const m = raw.match(new RegExp(`^(${MONTH_TOKEN})(?:\\s+(\\d{4}))?$`, "i"));
  if (!m) return null;
  const month = monthNum(m[1]);
  if (!month) return null;
  return m[2] ? `${MONTH_NAMES[month - 1]} ${m[2]}` : MONTH_NAMES[month - 1];
}

function fromParts(year: number, month?: number | null, day?: number | null): ResolvedEvidenceDate {
  if (year < 1994 || year > 2100) {
    return emptyResolved();
  }
  if (month && day) {
    const iso = `${year}-${pad(month)}-${pad(day)}`;
    return {
      iso,
      precision: "day",
      raw: `${day} ${MONTH_NAMES[month - 1]} ${year}`,
      label: `${day} ${MONTH_NAMES[month - 1]} ${year}`,
      year,
      month,
      stated: true,
    };
  }
  if (month) {
    const iso = `${year}-${pad(month)}-01`;
    return {
      iso,
      precision: "month",
      raw: `${MONTH_NAMES[month - 1]} ${year}`,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      year,
      month,
      stated: true,
    };
  }
  const iso = `${year}-01-01`;
  return {
    iso,
    precision: "year",
    raw: String(year),
    label: String(year),
    year,
    month: null,
    stated: true,
  };
}

function emptyResolved(): ResolvedEvidenceDate {
  return {
    iso: null,
    precision: null,
    raw: null,
    label: NOT_STATED_IN_SOURCE,
    year: null,
    month: null,
    stated: false,
  };
}

function parseExplicitDate(text: string): ResolvedEvidenceDate | null {
  const blob = decodeBlob(text);

  const iso = blob.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return fromParts(y, m, d);
  }

  const dmyLong = blob.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_TOKEN})\\s+(20\\d{2})\\b`, "i"));
  if (dmyLong) {
    const month = monthNum(dmyLong[2]);
    if (month) return fromParts(Number(dmyLong[3]), month, Number(dmyLong[1]));
  }

  const mdyLong = blob.match(new RegExp(`\\b(${MONTH_TOKEN})\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, "i"));
  if (mdyLong) {
    const month = monthNum(mdyLong[1]);
    if (month) return fromParts(Number(mdyLong[3]), month, Number(mdyLong[2]));
  }

  const dashed = blob.match(new RegExp(`\\b(\\d{1,2})[- ](${MONTH_TOKEN})[- ](20\\d{2})\\b`, "i"));
  if (dashed) {
    const month = monthNum(dashed[2]);
    if (month) return fromParts(Number(dashed[3]), month, Number(dashed[1]));
  }

  const monthYear = blob.match(new RegExp(`\\b(${MONTH_TOKEN})(?:\\s+|\\s*[—–-]\\s*)(20\\d{2})\\b`, "i"));
  if (monthYear) {
    const month = monthNum(monthYear[1]);
    if (month) return fromParts(Number(monthYear[2]), month);
  }

  const yearMonthName = blob.match(new RegExp(`\\b(20\\d{2})\\s+(${MONTH_TOKEN})\\b`, "i"));
  if (yearMonthName) {
    const month = monthNum(yearMonthName[2]);
    if (month) return fromParts(Number(yearMonthName[1]), month);
  }

  const compactMonthYear = blob.match(
    new RegExp(`\\b(${MONTH_TOKEN})\\s*(20\\d{2})\\b`, "i"),
  );
  if (compactMonthYear) {
    const month = monthNum(compactMonthYear[1]);
    if (month) return fromParts(Number(compactMonthYear[2]), month);
  }

  return null;
}

function parseYearOnly(text: string): number | null {
  const bulletin = text.match(/\/bulletins\/(20\d{2})\//i) || text.match(/Government Tender Bulletin (20\d{2})/i);
  if (bulletin) {
    const y = Number(bulletin[1]);
    if (y >= 1994 && y <= 2100) return y;
  }
  const fy = text.match(/\b(20\d{2})[-/](\d{2})\b/);
  if (fy && Number(fy[1]) >= 2024) return Number(fy[1]);
  return null;
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const file = u.searchParams.get("file") || u.pathname;
    return decodeBlob(file);
  } catch {
    return decodeBlob(url);
  }
}

/**
 * Infer the source/evidence date. Never uses created_at / retrieved_at / discovered_at.
 * Prefers filename and title over CMS folder paths such as `file=2024-01/`.
 */
export function inferEvidenceDateFromSource(input: EvidenceDateInput): ResolvedEvidenceDate {
  const title = input.title ?? "";
  const url = input.sourceUrl ?? "";
  const filename = url ? filenameFromUrl(url) : "";
  const raw = input.issueDateRaw ?? "";
  const blobs = [raw, title, filename];

  for (const blob of blobs) {
    if (!blob) continue;
    const parsed = parseExplicitDate(blob);
    if (parsed?.stated) return parsed;
  }

  const titleMonth = title.match(new RegExp(`(?:—|-|–)\\s*(${MONTH_TOKEN})\\s*$`, "i"));
  const fileDate = parseExplicitDate(filename);
  if (titleMonth && fileDate?.year) {
    const month = monthNum(titleMonth[1]) ?? fileDate.month;
    if (month) return fromParts(fileDate.year, month, fileDate.precision === "day" ? Number(fileDate.iso?.slice(8, 10)) : null);
  }

  for (const blob of [title, filename, url]) {
    const y = parseYearOnly(blob);
    if (y) return fromParts(y);
  }

  return emptyResolved();
}

function storedDate(input: EvidenceDateInput): ResolvedEvidenceDate | null {
  if (isImportTimestampDate(input)) return null;
  const iso = toIsoDate(input.issueDate) ?? toIsoDate(input.awardDate);
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const precision = (input.precision as DatePrecision | null) ?? null;
  if (precision === "year") return fromParts(y);
  if (precision === "month") return fromParts(y, m);
  if (precision === "day") return fromParts(y, m, d);
  return fromParts(y, m, d);
}

function looksInventedDay(stored: ResolvedEvidenceDate, inferred: ResolvedEvidenceDate, input: EvidenceDateInput): boolean {
  if (!stored.iso || stored.precision === "year" || stored.precision === "month") return false;
  const day = Number(stored.iso.slice(8, 10));
  const url = `${input.sourceUrl ?? ""} ${input.title ?? ""}`.toLowerCase();
  if (inferred.precision === "month" && (day === 1 || day === 15) && inferred.iso?.slice(0, 7) === stored.iso.slice(0, 7)) {
    return true;
  }
  if (inferred.precision === "year" && (day === 1 || day === 15 || day === 30) && inferred.year === stored.year) {
    return true;
  }
  if (/overstrand\.gov\.za/.test(url) && day === 15) return true;
  if (/twk\.gov\.za/.test(url) && day === 30 && stored.iso.slice(5, 7) === "06") return true;
  if (/stellenbosch\.gov\.za/.test(url) && day === 15 && stored.iso.slice(5, 7) === "06") return true;
  return false;
}

/**
 * Public evidence/source date. Import/index timestamps are never returned.
 */
export function resolveEvidenceDate(input: EvidenceDateInput): ResolvedEvidenceDate {
  const inferred = inferEvidenceDateFromSource(input);
  const stored = storedDate(input);

  if (stored && looksInventedDay(stored, inferred, input)) {
    if (inferred.stated) return inferred;
    const y = Number(stored.iso!.slice(0, 4));
    const m = Number(stored.iso!.slice(5, 7));
    const url = `${input.sourceUrl ?? ""} ${input.title ?? ""}`.toLowerCase();
    if (/twk\.gov\.za/.test(url) || /stellenbosch\.gov\.za/.test(url)) return fromParts(y);
    return fromParts(y, m);
  }
  if (stored && stored.precision === "day") return stored;
  if (inferred.stated && stored && stored.precision && rankPrecision(inferred.precision) < rankPrecision(stored.precision)) {
    return stored;
  }
  if (inferred.stated) return inferred;
  if (stored) return stored;
  return emptyResolved();
}

function rankPrecision(p: DatePrecision | null): number {
  if (p === "day") return 3;
  if (p === "month") return 2;
  if (p === "year") return 1;
  return 0;
}

export function evidenceDateSortKey(input: EvidenceDateInput): string | null {
  return resolveEvidenceDate(input).iso;
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "for", "in", "of", "on", "the", "to", "vs"]);

function titleCaseWord(word: string, index: number): string {
  if (word.includes("/") || /^\d/.test(word)) return word;
  const lower = word.toLowerCase();
  if (MONTHS[lower]) {
    const n = MONTHS[lower]!;
    const full = Object.keys(MONTHS).find((k) => MONTHS[k] === n && k.length > 3) ?? lower;
    return full.charAt(0).toUpperCase() + full.slice(1);
  }
  if (index > 0 && SMALL_WORDS.has(lower)) return lower;
  if (word === word.toUpperCase() && word.length <= 5) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function polishEvidenceTitle(title: string | null | undefined, date?: ResolvedEvidenceDate | null): string | null {
  if (!title?.trim()) return title ?? null;
  let t = title.replace(/\s+/g, " ").trim();
  t = t.replace(/\s+[—–-]\s+/g, " — ");

  const wc = t.match(/^western cape infrastructure awards\s*—\s*([A-Za-z]+)(?:\s+(\d{4}))?$/i);
  if (wc) {
    const month = monthNum(wc[1]);
    const year = wc[2] || (date?.year ? String(date.year) : "");
    const monthLabel = month ? MONTH_NAMES[month - 1] : wc[1].charAt(0).toUpperCase() + wc[1].slice(1).toLowerCase();
    return year
      ? `Western Cape Infrastructure Awards — ${monthLabel} ${year}`
      : `Western Cape Infrastructure Awards — ${monthLabel}`;
  }

  const awards = t.match(/^(.*? awards)\s*—\s*([A-Za-z]+)(?:\s+(\d{4}))?$/i);
  if (awards) {
    const head = awards[1]
      .split(/\s+/)
      .map((w, i) => titleCaseWord(w, i))
      .join(" ");
    const month = monthNum(awards[2]);
    const year = awards[3] || (date?.year ? String(date.year) : "");
    const monthLabel = month ? MONTH_NAMES[month - 1] : titleCaseWord(awards[2], 0);
    return year ? `${head} — ${monthLabel} ${year}` : `${head} — ${monthLabel}`;
  }

  t = t.replace(new RegExp(`\\b(${MONTH_TOKEN})\\b`, "gi"), (token) => {
    const n = monthNum(token);
    return n ? MONTH_NAMES[n - 1] : token;
  });
  return t;
}

export function parseAwardDateInput(value: string | null | undefined): ResolvedEvidenceDate {
  if (!value?.trim()) return emptyResolved();
  const v = value.trim();
  if (/^\d{4}$/.test(v)) return fromParts(Number(v));
  if (/^\d{4}-\d{2}$/.test(v)) return fromParts(Number(v.slice(0, 4)), Number(v.slice(5, 7)));
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return fromParts(Number(v.slice(0, 4)), Number(v.slice(5, 7)), Number(v.slice(8, 10)));
  }
  return parseExplicitDate(v) ?? emptyResolved();
}
