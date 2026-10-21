// @effect-diagnostics nodeBuiltinImport:off - shape keys are hashed synchronously by a pure helper.
import * as NodeCrypto from "node:crypto";
import { BOTS_SUGGESTION_SHAPE_MAX } from "@t3tools/contracts/fork";
import { replaceInputs } from "./draft.ts";

const PLACEHOLDER = /^\{\{[a-z]+\d*\}\}$/;

/**
 * What a brief asks with its inputs taken out. Two briefs with the same shape ask for the same
 * job on different files, pull requests, numbers or quoted values.
 */
export const briefShape = (brief: string) =>
  replaceInputs(brief, Number.POSITIVE_INFINITY)
    // A quoted placeholder and a bare one are the same input.
    .text.replace(/\{\{[a-z]+\d*\}\}|"[^"\n]*"|`[^`\n]*`/g, (match) => {
      if (match.startsWith("{{")) return match;
      const inner = match.slice(1, -1);
      return PLACEHOLDER.test(inner) ? inner : "{{text}}";
    })
    .replace(/\{\{[a-z]+\d*\}\}|\d+(?:[.,]\d+)*/g, (match) =>
      match.startsWith("{{") ? match : "{{n}}",
    )
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BOTS_SUGGESTION_SHAPE_MAX);

export const shapeKey = (shape: string) =>
  NodeCrypto.createHash("sha256").update(shape).digest("hex");
