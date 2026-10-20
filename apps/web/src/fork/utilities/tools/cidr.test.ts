import { describe, expect, it } from "vite-plus/test";

import { error, type UtilityResult } from "../types";
import { CIDR_TOOLS } from "./cidr";
import { runInput } from "./testSupport";

const tool = CIDR_TOOLS.cidr;

function run(text: string, contains = ""): UtilityResult {
  return tool.run(runInput(tool, { text, options: { contains } }));
}

function fields(text: string, contains = ""): Record<string, string> {
  const result = run(text, contains);
  if (result.kind !== "ok") throw new Error(`Expected a result, got: ${result.message}`);
  return Object.fromEntries(result.fields.map((field) => [field.label, field.value]));
}

describe("IPv4 blocks", () => {
  it("describes 10.0.0.0/8", () => {
    expect(fields("10.0.0.0/8")).toEqual({
      Network: "10.0.0.0/8",
      Prefix: "/8",
      Netmask: "255.0.0.0",
      Wildcard: "0.255.255.255",
      Broadcast: "10.255.255.255",
      "First usable": "10.0.0.1",
      "Last usable": "10.255.255.254",
      "Total addresses": "16,777,216",
      "Usable addresses": "16,777,214",
      Range: "10.0.0.0 - 10.255.255.255",
    });
    expect(run("10.0.0.0/8")).not.toHaveProperty("warnings");
  });

  it("reports host bits and works from the network", () => {
    const result = run("192.168.1.10/24");
    expect(result).toMatchObject({
      kind: "ok",
      warnings: ["Host bits are set; the network is 192.168.1.0/24."],
    });
    expect(fields("192.168.1.10/24")).toMatchObject({
      Network: "192.168.1.0/24",
      Broadcast: "192.168.1.255",
      "First usable": "192.168.1.1",
      "Last usable": "192.168.1.254",
      "Usable addresses": "254",
    });
  });

  it("accepts a netmask after a space or a slash", () => {
    expect(fields("192.168.1.0 255.255.255.0")).toEqual(fields("192.168.1.0/24"));
    expect(fields("192.168.1.0/255.255.255.0")).toEqual(fields("192.168.1.0/24"));
    expect(fields("  172.16.0.0   255.240.0.0 \n")).toMatchObject({
      Network: "172.16.0.0/12",
      Prefix: "/12",
    });
    expect(fields("10.0.0.0 0.0.0.0")).toMatchObject({ Prefix: "/0" });
    expect(fields("10.0.0.1 255.255.255.255")).toMatchObject({ Prefix: "/32" });
  });

  it("reads a block split by a long run of whitespace", () => {
    // Long enough that whitespace handling which rescans the run from every space would
    // overrun the test timeout.
    expect(fields(`10.0.0.0${" ".repeat(200_000)}255.0.0.0`)).toMatchObject({
      Network: "10.0.0.0/8",
    });
    expect(fields(`10.0.0.0${" \t".repeat(100_000)}/\r\n 8`)).toMatchObject({
      Network: "10.0.0.0/8",
    });
  });

  it("rejects a netmask that is not contiguous", () => {
    expect(run("192.168.1.0 255.255.0.255")).toEqual(
      error("255.255.0.255 is not a valid netmask."),
    );
    expect(run("192.168.1.0/0.0.0.255")).toEqual(error("0.0.0.255 is not a valid netmask."));
    expect(run("192.168.1.0 255.255.255.256")).toEqual(
      error("255.255.255.256 is not a valid netmask."),
    );
    expect(run("192.168.1.0 24")).toEqual(error("24 is not a valid netmask."));
  });

  it("counts both addresses of a /31 as usable (RFC 3021) and has no broadcast", () => {
    expect(fields("10.0.0.0/31")).toEqual({
      Network: "10.0.0.0/31",
      Prefix: "/31",
      Netmask: "255.255.255.254",
      Wildcard: "0.0.0.1",
      "First usable": "10.0.0.0",
      "Last usable": "10.0.0.1",
      "Total addresses": "2",
      "Usable addresses": "2",
      Range: "10.0.0.0 - 10.0.0.1",
    });
  });

  it("treats a /32 and a bare address as a single host", () => {
    const single = {
      Network: "10.1.2.3/32",
      Prefix: "/32",
      Netmask: "255.255.255.255",
      Wildcard: "0.0.0.0",
      "First usable": "10.1.2.3",
      "Last usable": "10.1.2.3",
      "Total addresses": "1",
      "Usable addresses": "1",
      Range: "10.1.2.3 - 10.1.2.3",
    };
    expect(fields("10.1.2.3/32")).toEqual(single);
    expect(fields("10.1.2.3")).toEqual(single);
    expect(run("10.1.2.3")).not.toHaveProperty("warnings");
  });

  it("covers the whole space with /0", () => {
    expect(fields("0.0.0.0/0")).toEqual({
      Network: "0.0.0.0/0",
      Prefix: "/0",
      Netmask: "0.0.0.0",
      Wildcard: "255.255.255.255",
      Broadcast: "255.255.255.255",
      "First usable": "0.0.0.1",
      "Last usable": "255.255.255.254",
      "Total addresses": "4,294,967,296",
      "Usable addresses": "4,294,967,294",
      Range: "0.0.0.0 - 255.255.255.255",
    });
    expect(run("8.8.8.8/0")).toMatchObject({
      warnings: ["Host bits are set; the network is 0.0.0.0/0."],
    });
  });

  it("rejects invalid octets", () => {
    expect(run("192.168.1.256/24")).toEqual(
      error("256 is out of range; each IPv4 part is 0 to 255."),
    );
    expect(run("01.2.3.4")).toEqual(error("01 has a leading zero; write 1."));
    expect(run("10.0.00.0/8")).toEqual(error("00 has a leading zero; write 0."));
    expect(run("0256.0.0.0")).toEqual(error("0256 is out of range; each IPv4 part is 0 to 255."));
    expect(run("10.0.0/8")).toEqual(
      error("An IPv4 address has four parts separated by dots; this has 3."),
    );
    expect(run("10.0.0.0.0/8")).toEqual(
      error("An IPv4 address has four parts separated by dots; this has 5."),
    );
    expect(run("10..0.1")).toEqual(error("IPv4 part 2 is empty."));
    expect(run("10.0.0.x")).toEqual(error('"x" is not a number from 0 to 255.'));
    expect(run("10.0.0.+1")).toEqual(error('"+1" is not a number from 0 to 255.'));
  });

  it("rejects invalid prefixes", () => {
    expect(run("10.0.0.0/33")).toEqual(error("/33 is not a valid IPv4 prefix; use 0 to 32."));
    expect(run("10.0.0.0/")).toEqual(error("Add a prefix length after the slash, such as /24."));
    expect(run("10.0.0.0/-1")).toEqual(
      error('"/-1" is not a valid prefix; use a number such as /24.'),
    );
    expect(run("10.0.0.0/8/9")).toEqual(
      error('"/8/9" is not a valid prefix; use a number such as /24.'),
    );
    expect(run("/8")).toEqual(error("Enter an address before the prefix, such as 10.0.0.0/8."));
  });

  it("rejects text that is not an address or holds more than one block", () => {
    expect(run("localhost")).toEqual(error('"localhost" is not an IPv4 or IPv6 address.'));
    expect(run("10.0.0.0/8 10.1.0.0/16")).toEqual(
      error("Enter one block, such as 10.0.0.0/8 or 192.168.1.0 255.255.255.0."),
    );
    expect(run("10.0.0.0 255.0.0.0 extra")).toEqual(
      error("Enter one block, such as 10.0.0.0/8 or 192.168.1.0 255.255.255.0."),
    );
    expect(run("   ")).toEqual(error("Enter an IPv4 or IPv6 block, such as 10.0.0.0/8."));
  });

  it("shortens very long values in messages", () => {
    const message = run(`${"z".repeat(5000)}.0.0.0`);
    expect(message).toEqual(error(`"${"z".repeat(40)}..." is not a number from 0 to 255.`));
  });

  it("does not cut an emoji in half when shortening", () => {
    expect(run(`${"a".repeat(39)}😀${"b".repeat(10)}.0.0.0`)).toEqual(
      error(`"${"a".repeat(39)}..." is not a number from 0 to 255.`),
    );
  });
});

describe("IPv6 blocks", () => {
  it("describes 2001:db8::/32 with compressed and expanded output", () => {
    expect(fields("2001:db8::/32")).toEqual({
      Network: "2001:db8::/32",
      Expanded: "2001:0db8:0000:0000:0000:0000:0000:0000",
      Prefix: "/32",
      "First usable": "2001:db8::",
      "Last usable": "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff",
      "Total addresses": "79,228,162,514,264,337,593,543,950,336",
      "Usable addresses": "79,228,162,514,264,337,593,543,950,336",
      Range: "2001:db8:: - 2001:db8:ffff:ffff:ffff:ffff:ffff:ffff",
    });
  });

  it("reports host bits on IPv6 too", () => {
    expect(run("2001:DB8:0:0:8:800:200C:417A/64")).toMatchObject({
      kind: "ok",
      warnings: ["Host bits are set; the network is 2001:db8::/64."],
    });
  });

  it("treats ::1/128 and a bare address as a single host", () => {
    const loopback = {
      Network: "::1/128",
      Expanded: "0000:0000:0000:0000:0000:0000:0000:0001",
      Prefix: "/128",
      "First usable": "::1",
      "Last usable": "::1",
      "Total addresses": "1",
      "Usable addresses": "1",
      Range: "::1 - ::1",
    };
    expect(fields("::1/128")).toEqual(loopback);
    expect(fields("::1")).toEqual(loopback);
    expect(fields("0:0:0:0:0:0:0:1")).toEqual(loopback);
  });

  it("covers the whole space with ::/0", () => {
    expect(fields("::/0")).toMatchObject({
      Network: "::/0",
      "Last usable": "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "Total addresses": "340,282,366,920,938,463,463,374,607,431,768,211,456",
    });
  });

  it("reads an embedded IPv4 tail and prints IPv4-mapped addresses in mixed notation", () => {
    expect(fields("::ffff:192.0.2.1")).toMatchObject({
      Network: "::ffff:192.0.2.1/128",
      Expanded: "0000:0000:0000:0000:0000:ffff:c000:0201",
    });
    expect(fields("0:0:0:0:0:ffff:c000:201")).toMatchObject({ Network: "::ffff:192.0.2.1/128" });
    expect(fields("::ffff:0:0/96")).toMatchObject({
      Range: "::ffff:0.0.0.0 - ::ffff:255.255.255.255",
    });
    expect(fields("64:ff9b::192.0.2.33")).toMatchObject({ Network: "64:ff9b::c000:221/128" });
  });

  it("compresses per RFC 5952", () => {
    const network = (text: string) => fields(text).Network;
    expect(network("2001:0db8:0000:0000:0001:0000:0000:0001")).toBe("2001:db8::1:0:0:1/128");
    expect(network("2001:db8:0:0:1:0:0:0")).toBe("2001:db8:0:0:1::/128");
    expect(network("2001:db8:0:1:1:1:1:1")).toBe("2001:db8:0:1:1:1:1:1/128");
    expect(network("1:2:3:4:5:6:7::")).toBe("1:2:3:4:5:6:7:0/128");
    expect(network("FE80::ABCD")).toBe("fe80::abcd/128");
    expect(network("::")).toBe("::/128");
  });

  it("rejects malformed IPv6", () => {
    expect(run("1::2::3")).toEqual(error(":: can appear only once in an IPv6 address."));
    expect(run(":::")).toEqual(error("An IPv6 group is empty; check for a stray colon."));
    expect(run(":1:2:3:4:5:6:7")).toEqual(
      error("An IPv6 group is empty; check for a stray colon."),
    );
    expect(run("12345::")).toEqual(
      error('"12345" is not an IPv6 group; each group is 1 to 4 hex digits.'),
    );
    expect(run("2001:db8::g")).toEqual(
      error('"g" is not an IPv6 group; each group is 1 to 4 hex digits.'),
    );
    expect(run("1:2:3:4:5:6:7")).toEqual(
      error("An IPv6 address has eight groups; this has 7. Use :: for a run of zero groups."),
    );
    expect(run("1:2:3:4:5:6:7:8:9")).toEqual(
      error("An IPv6 address has eight groups; this has 9. Use :: for a run of zero groups."),
    );
    expect(run("1:2:3:4::5:6:7:8")).toEqual(
      error("An IPv6 address with :: has at most seven other groups; this has 8."),
    );
    expect(run("1.2.3.4::")).toEqual(
      error("An embedded IPv4 address can only come at the end of an IPv6 address."),
    );
    expect(run("::1.2.3.4:5")).toEqual(
      error("An embedded IPv4 address can only come at the end of an IPv6 address."),
    );
    expect(run("::ffff:192.0.2.256")).toEqual(
      error("256 is out of range; each IPv4 part is 0 to 255."),
    );
  });

  it("rejects zone ids and invalid prefixes", () => {
    expect(run("fe80::1%en0/64")).toEqual(
      error('IPv6 zone ids such as "%en0" are not supported; remove them.'),
    );
    expect(run("2001:db8::/129")).toEqual(error("/129 is not a valid IPv6 prefix; use 0 to 128."));
    expect(run("2001:db8:: ffff:ffff::")).toEqual(
      error("Netmasks only apply to IPv4; write an IPv6 prefix such as /64."),
    );
  });
});

describe("address to check", () => {
  it.each([
    ["192.168.1.0/24", "192.168.1.0", "Yes"],
    ["192.168.1.0/24", "192.168.1.255", "Yes"],
    ["192.168.1.0/24", "192.168.0.255", "No"],
    ["192.168.1.0/24", "192.168.2.0", "No"],
    ["192.168.1.10/24", "192.168.2.1", "No"],
    ["0.0.0.0/0", "255.255.255.255", "Yes"],
    ["10.0.0.5", "10.0.0.5", "Yes"],
    ["2001:db8::/32", "2001:db8::", "Yes"],
    ["2001:db8::/32", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", "Yes"],
    ["2001:db8::/32", "2001:db7:ffff:ffff:ffff:ffff:ffff:ffff", "No"],
    ["2001:db8::/32", "2001:db9::", "No"],
  ])("%s contains %s: %s", (block, address, answer) => {
    expect(fields(block, address)["Address in block"]).toBe(answer);
  });

  it("puts the answer first", () => {
    const result = run("192.168.1.0/24", "192.168.1.7");
    expect(result.kind === "ok" && result.fields[0]).toEqual({
      label: "Address in block",
      value: "Yes",
    });
  });

  it("leaves the field out when no address is given", () => {
    expect(fields("192.168.1.0/24", "  ")).not.toHaveProperty("Address in block");
  });

  it("explains an invalid address or a version mismatch", () => {
    expect(run("192.168.1.0/24", "192.168.1.300")).toEqual(
      error("The address to check is not valid. 300 is out of range; each IPv4 part is 0 to 255."),
    );
    expect(run("192.168.1.0/24", "192.168.1.0/24")).toEqual(
      error("The address to check must be a single address, without a prefix or netmask."),
    );
    expect(run("192.168.1.0/24", "::ffff:192.168.1.1")).toEqual(
      error("The address to check is IPv6, but the block is IPv4."),
    );
    expect(run("2001:db8::/32", "10.0.0.1")).toEqual(
      error("The address to check is IPv4, but the block is IPv6."),
    );
  });
});

describe("tool contract", () => {
  it("runs its example to a result", () => {
    const { text, options } = tool.example;
    const result = tool.run(runInput(tool, { text, options }));
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.fields[0]?.value).toBe("Yes");
  });

  it("never throws on odd input", () => {
    const inputs = [
      "",
      "/",
      "::/",
      ":",
      ".",
      "...",
      "1:",
      "1:2:3:4:5:6:7:8/",
      "::ffff:1.2.3",
      "[::1]",
      "1.2.3.4 / 255.255.255.0",
      "999999999999999999999.0.0.0",
      "10.0.0.0/99999999999999999999",
      "::".repeat(10),
      "1:".repeat(10_000),
      "١.2.3.4",
    ];
    for (const text of inputs) {
      expect(() => run(text, text)).not.toThrow();
    }
  });
});
