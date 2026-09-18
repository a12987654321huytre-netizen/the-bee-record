const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.",
  "metadata.google.internal",
  "metadata.google.internal.",
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  const inRange = (start: string, end: string) => {
    const a = ipv4ToInt(start)!;
    const b = ipv4ToInt(end)!;
    return n >= a && n <= b;
  };
  return (
    inRange("0.0.0.0", "0.255.255.255") ||
    inRange("10.0.0.0", "10.255.255.255") ||
    inRange("127.0.0.0", "127.255.255.255") ||
    inRange("169.254.0.0", "169.254.255.255") ||
    inRange("172.16.0.0", "172.31.255.255") ||
    inRange("192.168.0.0", "192.168.255.255") ||
    inRange("224.0.0.0", "239.255.255.255") ||
    inRange("255.255.255.255", "255.255.255.255")
  );
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("::ffff:")) {
    const mapped = h.slice("::ffff:".length);
    if (isPrivateIpv4(mapped)) return true;
  }
  return false;
}

export type UrlCheckResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

export function checkFetchUrl(raw: string): UrlCheckResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only HTTP and HTTPS URLs are allowed." };
  }
  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, reason: "URL is missing a hostname." };
  if (BLOCKED_HOSTS.has(host)) {
    return { ok: false, reason: "That host is not allowed." };
  }
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "That host is not allowed." };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isPrivateIpv4(host)) {
    return { ok: false, reason: "Private network addresses are not allowed." };
  }
  if (host.includes(":") && isBlockedIpv6(host)) {
    return { ok: false, reason: "Private network addresses are not allowed." };
  }
  return { ok: true, url };
}

export function isBlockedResolvedAddress(address: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return isPrivateIpv4(address);
  return isBlockedIpv6(address);
}
