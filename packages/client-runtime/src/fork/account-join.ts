export function accountJoinCode(input: string) {
  const code = input.trim().toUpperCase().replace(/[\s-]/gu, "");
  return /^[A-F0-9]{10}$/u.test(code) ? `${code.slice(0, 5)}-${code.slice(5)}` : null;
}
