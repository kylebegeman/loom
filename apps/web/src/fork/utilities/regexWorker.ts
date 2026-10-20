import {
  parseRegexWorkerRequest,
  type RegexWorkerRequest,
  type RegexWorkerResponse,
} from "./regexRunner";
import { matchAll, REGEX_MAX_MATCHES, type RegexMatchResult } from "./tools/regexMatch";

// The web tsconfig has only the DOM lib, where `self` is a Window. This is the slice of the
// dedicated worker scope used here, typed so every reply has the shared envelope.
interface RegexWorkerScope {
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  postMessage(message: RegexWorkerResponse): void;
}

const scope: RegexWorkerScope = self;

scope.addEventListener("message", (event) => {
  // The runner is the only sender and always sends a whole request.
  const request = parseRegexWorkerRequest(event.data);
  if (!request) return;
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Dedicated workers do not accept a target origin.
  scope.postMessage({ requestId: request.requestId, result: match(request) });
});

function match(request: RegexWorkerRequest): RegexMatchResult {
  try {
    return matchAll(request.pattern, request.flags, request.text, {
      maxMatches: REGEX_MAX_MATCHES,
    });
  } catch (cause) {
    // matchAll reports engine failures itself; this turns anything else into a reply rather
    // than a worker error the runner can only describe as a crash.
    const reason = cause instanceof Error ? cause.message.replace(/\.$/, "") : String(cause);
    return { kind: "error", message: `Matching failed: ${reason}.` };
  }
}
