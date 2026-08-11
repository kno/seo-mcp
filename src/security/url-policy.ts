const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

const BLOCKED_IPV4_CIDRS: Array<[number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc01fc400, 24],
  [0xc034c100, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc0af3000, 24],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function parseIpv4(hostname: string): number[] | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return;
  return octets;
}

function isBlockedIpv4(octets: number[]): boolean {
  const value =
    (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
  return BLOCKED_IPV4_CIDRS.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (network & mask);
  });
}

function parseIpv6(hostname: string): number[] | undefined {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!value.includes(":")) return;
  const halves = value.split("::");
  if (halves.length > 2) return;
  const parseHalf = (half: string): number[] | undefined => {
    if (!half) return [];
    const words: number[] = [];
    for (const part of half.split(":")) {
      if (part.includes(".")) {
        const ipv4 = parseIpv4(part);
        if (!ipv4) return;
        words.push(ipv4[0] * 256 + ipv4[1], ipv4[2] * 256 + ipv4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return;
        words.push(Number.parseInt(part, 16));
      }
    }
    return words;
  };
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function hasIpv6Prefix(
  words: number[],
  prefix: number[],
  bits: number,
): boolean {
  const wholeWords = Math.floor(bits / 16);
  for (let index = 0; index < wholeWords; index++) {
    if (words[index] !== prefix[index]) return false;
  }
  const remaining = bits % 16;
  if (!remaining) return true;
  const mask = (0xffff << (16 - remaining)) & 0xffff;
  return (words[wholeWords] & mask) === (prefix[wholeWords] & mask);
}

function isBlockedIpv6(hostname: string): boolean {
  const words = parseIpv6(hostname);
  if (!words) return false;
  const blocked: Array<[number[], number]> = [
    [[0, 0, 0, 0, 0, 0, 0, 0], 128],
    [[0, 0, 0, 0, 0, 0, 0, 1], 128],
    [[0, 0, 0, 0, 0, 0, 0, 0], 96],
    [[0, 0, 0, 0, 0, 0xffff, 0, 0], 96],
    [[0, 0, 0, 0, 0xffff, 0, 0, 0], 96],
    [[0x0064, 0xff9b, 0, 0, 0, 0, 0, 0], 96],
    [[0x0064, 0xff9b, 1, 0, 0, 0, 0, 0], 48],
    [[0x0100, 0, 0, 0, 0, 0, 0, 0], 64],
    [[0x2001, 0, 0, 0, 0, 0, 0, 0], 23],
    [[0x2001, 0x0db8, 0, 0, 0, 0, 0, 0], 32],
    [[0x2002, 0, 0, 0, 0, 0, 0, 0], 16],
    [[0x3fff, 0, 0, 0, 0, 0, 0, 0], 20],
    [[0x5f00, 0, 0, 0, 0, 0, 0, 0], 16],
    [[0xfc00, 0, 0, 0, 0, 0, 0, 0], 7],
    [[0xfe80, 0, 0, 0, 0, 0, 0, 0], 10],
    [[0xfec0, 0, 0, 0, 0, 0, 0, 0], 10],
    [[0xff00, 0, 0, 0, 0, 0, 0, 0], 8],
  ];
  return (
    blocked.some(([prefix, bits]) => hasIpv6Prefix(words, prefix, bits)) ||
    (words[4] === 0 && words[5] === 0x5efe)
  );
}

export function normalizePublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }
  if (url.username || url.password)
    throw new Error("URL credentials are not allowed");

  const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (
    !hostname ||
    BLOCKED_HOSTS.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Private or local hosts are not allowed");
  }

  const ipv4 = parseIpv4(hostname);
  if ((ipv4 && isBlockedIpv4(ipv4)) || isBlockedIpv6(hostname)) {
    throw new Error("Private, reserved, or local IP addresses are not allowed");
  }

  url.hostname = hostname;
  url.hash = "";
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  return url;
}

export function resolvePublicUrl(location: string, base: URL): URL {
  return normalizePublicUrl(new URL(location, base).toString());
}

export function sameOrigin(candidate: URL, origin: URL): boolean {
  return candidate.origin === origin.origin;
}
