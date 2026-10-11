/** Names are hints, not proof of intent. Ratings below come only from manufacturer datasheets. */
export const I2C = /(^|[_/.-])(I2C\d*_|TWI_)?S(DA|CL)\d*($|[_/.-])/i;
export const RESET = /^(?:~\{)?(?:RESET_?N?|RSTN?|NRST|MCLR)(?:\})?$/i;
export const GPIO = /^(?:P[A-K]\d+|GPIO\d+|IO\d+|R[A-E]\d+)$/i;
export const USB_SIGNAL = /^(?:D[+-]|DP|DN|CC[12]|SBU[12])$/i;
export const UART_TX = /^(?:UART_)?TXD?\d*$/i;
export const UART_RX = /^(?:UART_)?RXD?\d*$/i;
export type RegulatorEntry = {
  id: string;
  match: RegExp;
  vinMaxV: number;
  dropoutV: number;
  minOutputCapUf?: number;
  sourceUrl: string;
  checkedOn: string | null;
};
// Unverified entries recognize parts only. Never use their numerical limits in a finding.
export const REGULATORS: readonly RegulatorEntry[] = [
  {
    id: "ams1117",
    match: /AMS1117/i,
    vinMaxV: 15,
    dropoutV: 1.3,
    minOutputCapUf: 22,
    sourceUrl: "https://www.advanced-monolithic.com/pdf/ds1117.pdf",
    checkedOn: null,
  },
  {
    id: "lm1117",
    match: /LM1117/i,
    vinMaxV: 15,
    dropoutV: 1.3,
    minOutputCapUf: 10,
    sourceUrl: "https://www.ti.com/lit/ds/symlink/lm1117.pdf",
    checkedOn: "2026-10-11",
  },
  {
    id: "ap2112",
    match: /AP2112K?-(?:1\.8|2\.5|2\.6|3\.0|3\.3)/i,
    vinMaxV: 6,
    dropoutV: 0.4,
    minOutputCapUf: 1,
    sourceUrl: "https://www.diodes.com/assets/Datasheets/AP2112.pdf",
    checkedOn: "2026-10-11",
  },
  {
    id: "mcp1700",
    match: /MCP1700/i,
    vinMaxV: 6,
    dropoutV: 0.35,
    minOutputCapUf: 1,
    sourceUrl: "https://ww1.microchip.com/downloads/en/DeviceDoc/20001826F.pdf",
    checkedOn: null,
  },
  {
    id: "xc6206",
    match: /XC6206/i,
    vinMaxV: 6,
    dropoutV: 0.25,
    minOutputCapUf: 1,
    sourceUrl: "https://www.torexsemi.com/file/xc6206/XC6206.pdf",
    checkedOn: null,
  },
  {
    id: "780x",
    match: /(?:L|LM|MC|UA)78(?:05|09|12|15)/i,
    vinMaxV: 35,
    dropoutV: 2,
    sourceUrl: "https://www.ti.com/lit/ds/symlink/lm340.pdf",
    checkedOn: null,
  },
];
