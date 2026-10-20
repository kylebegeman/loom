import { error, ok, stringOption, type UtilityOutputField, type UtilityToolImpl } from "../types";

type IpVersion = 4 | 6;

interface Address {
  readonly version: IpVersion;
  readonly value: bigint;
}

interface Block extends Address {
  readonly prefix: number;
}

const ONE_BLOCK = "Enter one block, such as 10.0.0.0/8 or 192.168.1.0 255.255.255.0.";
const IPV4_ALL = 0xffff_ffffn;
const MAX_QUOTED = 40;

const widthOf = (version: IpVersion) => (version === 4 ? 32 : 128);

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Keeps a megabyte of pasted text out of an error message, without halving an emoji. */
function clip(value: string): string {
  if (value.length <= MAX_QUOTED) return value;
  const end = isHighSurrogate(value.charCodeAt(MAX_QUOTED - 1)) ? MAX_QUOTED - 1 : MAX_QUOTED;
  return `${value.slice(0, end)}...`;
}
const quote = (value: string) => `"${clip(value)}"`;

const withThousands = (value: bigint) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const bitLength = (value: bigint) => (value === 0n ? 0 : value.toString(2).length);

// Parsers return the parsed value or the message explaining why the text is not one.

function parseIpv4(text: string): bigint | string {
  const parts = text.split(".");
  if (parts.length !== 4)
    return `An IPv4 address has four parts separated by dots; this has ${parts.length}.`;
  let value = 0n;
  for (const [index, part] of parts.entries()) {
    if (part === "") return `IPv4 part ${index + 1} is empty.`;
    if (!/^\d+$/.test(part)) return `${quote(part)} is not a number from 0 to 255.`;
    const octet = Number(part);
    // Checked before the leading zero so 0256 is not answered with "write 256".
    if (octet > 255) return `${clip(part)} is out of range; each IPv4 part is 0 to 255.`;
    // inet_aton and friends read 010 as octal 8, so a leading zero is ambiguous, not decimal.
    if (part.length > 1 && part.startsWith("0"))
      return `${clip(part)} has a leading zero; write ${octet}.`;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

/** 16-bit words for colon-separated groups; only the address's final group may be IPv4. */
function groupWords(groups: ReadonlyArray<string>, endsAddress: boolean): number[] | string {
  const words: number[] = [];
  for (const [index, group] of groups.entries()) {
    if (group.includes(".")) {
      if (!endsAddress || index !== groups.length - 1)
        return "An embedded IPv4 address can only come at the end of an IPv6 address.";
      const ipv4 = parseIpv4(group);
      if (typeof ipv4 === "string") return ipv4;
      words.push(Number(ipv4 >> 16n), Number(ipv4 & 0xffffn));
    } else if (group === "") {
      return "An IPv6 group is empty; check for a stray colon.";
    } else if (!/^[0-9a-f]{1,4}$/i.test(group)) {
      return `${quote(group)} is not an IPv6 group; each group is 1 to 4 hex digits.`;
    } else {
      words.push(Number.parseInt(group, 16));
    }
  }
  return words;
}

function parseIpv6(text: string): bigint | string {
  // A zone names an interface on this machine, which a block calculation cannot use.
  const zone = text.indexOf("%");
  if (zone >= 0)
    return `IPv6 zone ids such as ${quote(text.slice(zone))} are not supported; remove them.`;
  const halves = text.split("::");
  if (halves.length > 2) return ":: can appear only once in an IPv6 address.";
  const [head = "", tail] = halves;
  const compressed = tail !== undefined;
  const headWords = groupWords(head === "" ? [] : head.split(":"), !compressed);
  if (typeof headWords === "string") return headWords;
  const tailWords = groupWords(tail ? tail.split(":") : [], true);
  if (typeof tailWords === "string") return tailWords;
  const count = headWords.length + tailWords.length;
  if (!compressed && count !== 8)
    return `An IPv6 address has eight groups; this has ${count}. Use :: for a run of zero groups.`;
  // :: always stands for at least one zero group.
  if (compressed && count > 7)
    return `An IPv6 address with :: has at most seven other groups; this has ${count}.`;
  const zeros = Array.from({ length: 8 - count }, () => 0);
  return [...headWords, ...zeros, ...tailWords].reduce(
    (value, word) => (value << 16n) | BigInt(word),
    0n,
  );
}

function parseAddress(text: string): Address | string {
  if (text.includes(":")) {
    const value = parseIpv6(text);
    return typeof value === "string" ? value : { version: 6, value };
  }
  if (text.includes(".") || /^\d+$/.test(text)) {
    const value = parseIpv4(text);
    return typeof value === "string" ? value : { version: 4, value };
  }
  return `${quote(text)} is not an IPv4 or IPv6 address.`;
}

/** The prefix length of a contiguous IPv4 netmask, or null. */
function netmaskPrefix(text: string): number | null {
  const mask = parseIpv4(text);
  if (typeof mask === "string") return null;
  const hostBits = ~mask & IPV4_ALL;
  // Contiguous means ones then zeros, so the host part is one less than a power of two.
  if ((hostBits & (hostBits + 1n)) !== 0n) return null;
  return 32 - bitLength(hostBits);
}

/** "a/n", "a/netmask", "a netmask" or a bare address, which is a single host. */
function parseBlock(text: string): Block | string {
  // Not replace(/\s*\/\s*/g): that retries \s* from every space of a run that does not end
  // in a slash, which is quadratic and freezes the tab on a long run of spaces.
  const tokens = text
    .trim()
    .split("/")
    .map((part) => part.trim())
    .join("/")
    .split(/\s+/);
  const [first = "", second] = tokens;
  if (first === "") return "Enter an IPv4 or IPv6 block, such as 10.0.0.0/8.";
  if (tokens.length > 2 || (second !== undefined && (first + second).includes("/")))
    return ONE_BLOCK;
  const slash = first.indexOf("/");
  const addressText = slash >= 0 ? first.slice(0, slash) : first;
  const suffix = slash >= 0 ? first.slice(slash + 1) : second;
  if (addressText === "") return "Enter an address before the prefix, such as 10.0.0.0/8.";
  const address = parseAddress(addressText);
  if (typeof address === "string") return address;
  const width = widthOf(address.version);
  if (suffix === undefined) return { ...address, prefix: width };
  if (second !== undefined || suffix.includes(".")) {
    if (address.version === 6)
      return "Netmasks only apply to IPv4; write an IPv6 prefix such as /64.";
    const prefix = netmaskPrefix(suffix);
    return prefix === null ? `${clip(suffix)} is not a valid netmask.` : { ...address, prefix };
  }
  if (suffix === "") return "Add a prefix length after the slash, such as /24.";
  if (!/^\d+$/.test(suffix))
    return `${quote(`/${suffix}`)} is not a valid prefix; use a number such as /24.`;
  const prefix = Number(suffix);
  if (prefix > width)
    return `/${clip(suffix)} is not a valid IPv${address.version} prefix; use 0 to ${width}.`;
  return { ...address, prefix };
}

function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => ((value >> shift) & 0xffn).toString()).join(".");
}

const ipv6Words = (value: bigint) =>
  Array.from({ length: 8 }, (_, index) => Number((value >> BigInt(112 - index * 16)) & 0xffffn));

/** RFC 5952: :: replaces the longest run of two or more zero groups, the first on a tie. */
function compressWords(words: ReadonlyArray<number>): string {
  let bestStart = -1;
  let bestLength = 1;
  let runStart = -1;
  for (let index = 0; index <= words.length; index++) {
    if (index < words.length && words[index] === 0) {
      if (runStart < 0) runStart = index;
      continue;
    }
    if (runStart >= 0 && index - runStart > bestLength) {
      bestStart = runStart;
      bestLength = index - runStart;
    }
    runStart = -1;
  }
  const hex = words.map((word) => word.toString(16));
  if (bestStart < 0) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}

function formatIpv6(value: bigint): string {
  // RFC 5952 section 5 recommends dotted notation for well-known IPv4 embeddings. Only the
  // IPv4-mapped prefix ::ffff:0:0/96 gets it: the deprecated ::/96 one would turn ::1 into
  // ::0.0.0.1.
  if (value >> 32n === 0xffffn)
    return `${compressWords(ipv6Words(value).slice(0, 6))}:${formatIpv4(value & IPV4_ALL)}`;
  return compressWords(ipv6Words(value));
}

const expandIpv6 = (value: bigint) =>
  ipv6Words(value)
    .map((word) => word.toString(16).padStart(4, "0"))
    .join(":");

const formatAddress = (version: IpVersion, value: bigint) =>
  version === 4 ? formatIpv4(value) : formatIpv6(value);

/** Whether the address is in the block, or the message explaining why it cannot be checked. */
function containsAddress(
  block: Block,
  network: bigint,
  mask: bigint,
  text: string,
): boolean | string {
  if (/[\s/]/.test(text))
    return "The address to check must be a single address, without a prefix or netmask.";
  const address = parseAddress(text);
  if (typeof address === "string") return `The address to check is not valid. ${address}`;
  if (address.version !== block.version)
    return `The address to check is IPv${address.version}, but the block is IPv${block.version}.`;
  return (address.value & mask) === network;
}

export const CIDR_TOOLS = {
  cidr: {
    input: "text",
    inputLabel: "Address or block",
    placeholder: "10.0.0.0/8, 192.168.1.0 255.255.255.0 or 2001:db8::/32",
    options: [
      {
        kind: "text",
        id: "contains",
        label: "Address to check",
        defaultValue: "",
        placeholder: "Optional",
      },
    ],
    example: { text: "192.168.1.10/24", options: { contains: "192.168.1.20" } },
    run: ({ text, options }) => {
      const block = parseBlock(text);
      if (typeof block === "string") return error(block);
      const { version, prefix } = block;
      const width = widthOf(version);
      const hostMask = (1n << BigInt(width - prefix)) - 1n;
      const mask = ((1n << BigInt(width)) - 1n) ^ hostMask;
      const network = block.value & mask;
      const last = network | hostMask;
      // IPv4 reserves the network and broadcast addresses, except on /31 point-to-point links
      // (RFC 3021) and /32 host routes. IPv6 has no broadcast, so every address counts.
      const reserved = version === 4 && prefix <= 30;
      const total = hostMask + 1n;
      const format = (value: bigint) => formatAddress(version, value);
      const networkText = `${format(network)}/${prefix}`;

      const fields: UtilityOutputField[] = [];
      const checkText = stringOption(options, "contains", "").trim();
      if (checkText !== "") {
        const inBlock = containsAddress(block, network, mask, checkText);
        if (typeof inBlock === "string") return error(inBlock);
        fields.push({ label: "Address in block", value: inBlock ? "Yes" : "No" });
      }
      fields.push({ label: "Network", value: networkText, monospace: true });
      if (version === 6)
        fields.push({ label: "Expanded", value: expandIpv6(network), monospace: true });
      fields.push({ label: "Prefix", value: `/${prefix}`, monospace: true });
      if (version === 4) {
        fields.push(
          { label: "Netmask", value: formatIpv4(mask), monospace: true },
          { label: "Wildcard", value: formatIpv4(hostMask), monospace: true },
        );
        if (reserved) fields.push({ label: "Broadcast", value: formatIpv4(last), monospace: true });
      }
      fields.push(
        {
          label: "First usable",
          value: format(reserved ? network + 1n : network),
          monospace: true,
        },
        { label: "Last usable", value: format(reserved ? last - 1n : last), monospace: true },
        { label: "Total addresses", value: withThousands(total), monospace: true },
        {
          label: "Usable addresses",
          value: withThousands(reserved ? total - 2n : total),
          monospace: true,
        },
        { label: "Range", value: `${format(network)} - ${format(last)}`, monospace: true },
      );
      const warnings =
        network === block.value ? [] : [`Host bits are set; the network is ${networkText}.`];
      return ok(fields, warnings);
    },
  },
} satisfies Record<string, UtilityToolImpl>;
