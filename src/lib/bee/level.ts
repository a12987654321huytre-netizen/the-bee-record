const LEVEL_WORDS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  non: "non-compliant",
};

export function normalizeBeeLevel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/contributor|contributor status|b-?bbee|status/g, " ");
  const word = t.match(/\b(one|two|three|four|five|six|seven|eight)\b/);
  if (word) return LEVEL_WORDS[word[1]!] ?? null;
  const n = t.match(/\blevel\s*([1-8])\b/) || t.match(/\b([1-8])\b/);
  if (n) return n[1]!;
  if (/non[-\s]?compliant/.test(t)) return "non-compliant";
  return null;
}

export function displayBeeLevel(level: string | null | undefined): string | null {
  if (!level) return null;
  if (level === "non-compliant") return "Non-compliant";
  if (/^[1-8]$/.test(level)) return `Level ${level}`;
  return level;
}
