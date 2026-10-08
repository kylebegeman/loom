import type { ProcessRunOutput } from "../../processRunner.ts";

export const parseKicadVersion = (text: string) => {
  const match = /\b(\d+)\.(\d+)(?:\.(\d+))?(?:[-+][\w.-]+)?/.exec(text);
  return match ? { major: Number(match[1]), version: match[0] } : null;
};
export const parseTsciVersion = (text: string) => /\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?/.exec(text)?.[0];
/** ProcessRunner must receive extendEnv:false, otherwise removed variables are inherited. */
export const circuitEnvironment = (env: Readonly<NodeJS.ProcessEnv>) =>
  Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) =>
        value !== undefined &&
        !/(TOKEN|SECRET|KEY|PASSWORD|T3CODE_|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|BUN_OPTIONS)/i.test(
          name,
        ),
    ),
  );
export const processLog = (result: ProcessRunOutput) => {
  const text = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .split(/\r?\n/)
    .slice(-40)
    .join("\n");
  return text.slice(-8192);
};
