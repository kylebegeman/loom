import { sha256 } from "@noble/hashes/sha2";

/** Incremental hashing keeps large downloads out of a single in-memory buffer. */
export const createSha256 = () => sha256.create();
