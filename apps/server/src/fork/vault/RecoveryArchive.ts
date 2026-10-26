// @effect-diagnostics nodeBuiltinImport:off -- Operator-only streaming archive and key-file adapter, independent of live Vault authority.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeStream from "node:stream";
import * as NodeStreamPromises from "node:stream/promises";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class RecoveryArchiveError extends Schema.TaggedError<RecoveryArchiveError>()(
  "RecoveryArchiveError",
  { outputFilesystem: Schema.optional(Schema.Literal(true)) },
) {
  override get message() {
    if (this.outputFilesystem)
      return "Vault archive operation refused. Output requires a local filesystem with hard-link support and directory fsync. Create the output on supported local storage, then copy the encrypted archive to offline media. No fallback publication was attempted.";
    return "Vault archive operation refused. Check the private key, archive integrity, environment and unused destination path. No existing file was overwritten. Inspect the destination before retrying a failed write.";
  }
}
const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  environmentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  createdAt: Schema.String,
  snapshotBytes: Schema.Number.check(
    Schema.isInt(),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
    Schema.isGreaterThan(0),
  ),
  snapshotSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});
type Manifest = typeof Manifest.Type;
export type ArchiveReceipt = Manifest & {
  readonly authenticated: true;
  readonly backendRestoreVerified: false;
  readonly canPromote: false;
};
type ArchiveInput = {
  readonly keyFile: string;
  readonly archiveFile: string;
  readonly environmentId: string;
};
export class RecoveryArchive extends Context.Service<
  RecoveryArchive,
  {
    readonly createKey: (keyFile: string) => Effect.Effect<void, RecoveryArchiveError>;
    readonly seal: (
      input: ArchiveInput & { readonly snapshotFile: string },
    ) => Effect.Effect<ArchiveReceipt, RecoveryArchiveError>;
    readonly verify: (input: ArchiveInput) => Effect.Effect<ArchiveReceipt, RecoveryArchiveError>;
    readonly unseal: (
      input: ArchiveInput & { readonly snapshotFile: string },
    ) => Effect.Effect<ArchiveReceipt, RecoveryArchiveError>;
  }
>()("t3/fork/vault/RecoveryArchive") {}

const MAGIC = Buffer.from("LOOMVAULT1\n");
const HEADER_BYTES = MAGIC.length + 32 + 12;
const TAG_BYTES = 16;
const MAX_MANIFEST_BYTES = 4096;
const decodeManifest = Schema.decodeUnknownSync(Manifest);
const failure = () => new RecoveryArchiveError({});
const isRecoveryArchiveError = Schema.is(RecoveryArchiveError);
const requireEnvironment = (id: string) => {
  if (
    !id.trim() ||
    id.length > 512 ||
    [...id].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw failure();
};
const openInput = async (path: string, privateFile: boolean) => {
  // Opening a FIFO must not wait for a writer before the regular-file check can reject it.
  const handle = await NodeFSP.open(
    path,
    NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      (privateFile && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
    )
      throw failure();
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
};
const readKey = async (path: string) => {
  const handle = await openInput(path, true);
  const bytes = Buffer.alloc(33);
  try {
    if ((await handle.stat()).size !== 32) throw failure();
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== 32) throw failure();
    return Buffer.from(bytes.subarray(0, 32));
  } finally {
    bytes.fill(0);
    await handle.close();
  }
};
const deriveKey = (key: Buffer, salt: Buffer) =>
  Buffer.from(
    NodeCrypto.hkdfSync("sha256", key, salt, Buffer.from("Loom Vault recovery archive v1"), 32),
  );
const receipt = (manifest: Manifest): ArchiveReceipt => ({
  ...manifest,
  authenticated: true,
  backendRestoreVerified: false,
  canPromote: false,
});
const digestFile = async (handle: NodeFSP.FileHandle, signal: AbortSignal) => {
  const hash = NodeCrypto.createHash("sha256");
  let size = 0;
  for await (const chunk of NodeFS.createReadStream("", {
    fd: handle.fd,
    start: 0,
    autoClose: false,
    signal,
  })) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
};
const writeAll = async (handle: NodeFSP.FileHandle, bytes: Buffer, position: number) => {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
      position + offset,
    );
    if (bytesWritten === 0) throw failure();
    offset += bytesWritten;
  }
};
// Publish with an exclusive hard link only after authentication, then remove the staging name.
// A rename could overwrite a destination created concurrently after the initial check.
const withOutput = async <A>(
  path: string,
  signal: AbortSignal,
  work: (handle: NodeFSP.FileHandle) => Promise<A>,
): Promise<A> => {
  const directory = await NodeFSP.realpath(NodePath.dirname(NodePath.resolve(path)));
  const destination = NodePath.join(directory, NodePath.basename(path));
  const temporary = NodePath.join(
    directory,
    `.loom-vault-${NodeCrypto.randomBytes(16).toString("hex")}.tmp`,
  );
  const handle = await NodeFSP.open(temporary, "wx", 0o600);
  try {
    const result = await work(handle);
    await handle.sync();
    await handle.close();
    signal.throwIfAborted();
    try {
      await NodeFSP.link(temporary, destination);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EOPNOTSUPP", "ENOTSUP", "ENOSYS", "EXDEV", "EPERM"].includes(String(error.code))
      )
        throw new RecoveryArchiveError({ outputFilesystem: true });
      throw error;
    }
    const parent = await NodeFSP.open(
      directory,
      NodeFS.constants.O_RDONLY | NodeFS.constants.O_DIRECTORY,
    );
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    return result;
  } finally {
    await handle.close().catch(() => {});
    await NodeFSP.unlink(temporary).catch(() => {});
  }
};
// Each caller already supplies the operation span.
const run = Effect.fnUntraced(function* <A>(work: (signal: AbortSignal) => Promise<A>) {
  if ((yield* HostProcess.Platform) === "win32") return yield* failure();
  return yield* Effect.callback<A, RecoveryArchiveError>((resume, signal) => {
    const settled = Promise.resolve()
      .then(() => work(signal))
      .then(
        (value) => resume(Effect.succeed(value)),
        (error: unknown) => resume(Effect.fail(isRecoveryArchiveError(error) ? error : failure())),
      );
    // Abort alone returns before async finally blocks. Runtime shutdown must await their cleanup.
    return Effect.promise(() => settled);
  });
});

const seal = Effect.fn("RecoveryArchive.seal")(function* (
  input: ArchiveInput & { readonly snapshotFile: string },
) {
  const createdAt = DateTime.formatIso(yield* DateTime.now);
  return yield* run(async (signal) => {
    requireEnvironment(input.environmentId);
    const key = await readKey(input.keyFile);
    let derived: Buffer | undefined;
    let source: NodeFSP.FileHandle | undefined;
    try {
      source = await openInput(input.snapshotFile, true);
      const snapshot = source;
      const observed = await digestFile(source, signal);
      if (!Number.isSafeInteger(observed.size) || observed.size <= 0) throw failure();
      const manifest: Manifest = {
        version: 1,
        environmentId: input.environmentId,
        createdAt,
        snapshotBytes: observed.size,
        snapshotSha256: observed.sha256,
      };
      const metadata = Buffer.from(JSON.stringify(manifest));
      if (metadata.length > MAX_MANIFEST_BYTES) throw failure();
      const length = Buffer.alloc(4);
      length.writeUInt32BE(metadata.length);
      const salt = NodeCrypto.randomBytes(32),
        nonce = NodeCrypto.randomBytes(12);
      const header = Buffer.concat([MAGIC, salt, nonce]);
      derived = deriveKey(key, salt);
      const cipher = NodeCrypto.createCipheriv("aes-256-gcm", derived, nonce);
      cipher.setAAD(header);
      return await withOutput(input.archiveFile, signal, async (destination) => {
        await writeAll(destination, header, 0);
        const hash = NodeCrypto.createHash("sha256");
        let size = 0;
        const contents = async function* () {
          yield length;
          yield metadata;
          for await (const chunk of NodeFS.createReadStream("", {
            fd: snapshot.fd,
            start: 0,
            autoClose: false,
            signal,
          })) {
            hash.update(chunk);
            size += chunk.length;
            yield chunk;
          }
          if (size !== manifest.snapshotBytes || hash.digest("hex") !== manifest.snapshotSha256)
            throw failure();
        };
        await NodeStreamPromises.pipeline(
          NodeStream.Readable.from(contents()),
          cipher,
          NodeFS.createWriteStream("", {
            fd: destination.fd,
            start: header.length,
            autoClose: false,
          }),
          { signal },
        );
        signal.throwIfAborted();
        await writeAll(destination, cipher.getAuthTag(), HEADER_BYTES + 4 + metadata.length + size);
        return receipt(manifest);
      });
    } finally {
      key.fill(0);
      derived?.fill(0);
      await source?.close();
    }
  });
});

const readArchive = async (
  input: ArchiveInput,
  destination: NodeFSP.FileHandle | null,
  signal: AbortSignal,
): Promise<ArchiveReceipt> => {
  requireEnvironment(input.environmentId);
  const key = await readKey(input.keyFile);
  let derived: Buffer | undefined;
  let source: NodeFSP.FileHandle | undefined;
  try {
    source = await openInput(input.archiveFile, false);
    const size = (await source.stat()).size;
    if (!Number.isSafeInteger(size) || size <= HEADER_BYTES + TAG_BYTES + 4) throw failure();
    const header = Buffer.alloc(HEADER_BYTES),
      tag = Buffer.alloc(TAG_BYTES);
    if (
      (await source.read(header, 0, header.length, 0)).bytesRead !== header.length ||
      !header.subarray(0, MAGIC.length).equals(MAGIC)
    )
      throw failure();
    if ((await source.read(tag, 0, tag.length, size - tag.length)).bytesRead !== tag.length)
      throw failure();
    derived = deriveKey(key, header.subarray(MAGIC.length, MAGIC.length + 32));
    const decipher = NodeCrypto.createDecipheriv(
      "aes-256-gcm",
      derived,
      header.subarray(MAGIC.length + 32),
    );
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    let prefix = Buffer.alloc(0),
      manifest: Manifest | null = null,
      received = 0;
    const hash = NodeCrypto.createHash("sha256");
    const sink = new NodeStream.Writable({
      write(chunk: Buffer, _encoding, callback) {
        const consume = async () => {
          let bytes = chunk;
          if (!manifest) {
            // Buffer only the bounded encrypted manifest prefix, never the whole snapshot.
            let offset = 0;
            while (!manifest && offset < bytes.length) {
              const wanted = prefix.length < 4 ? 4 : 4 + prefix.readUInt32BE(0);
              if (wanted > 4 + MAX_MANIFEST_BYTES || wanted < 5) {
                if (prefix.length >= 4) throw failure();
              }
              const take = Math.min(wanted - prefix.length, bytes.length - offset);
              prefix = Buffer.concat([prefix, bytes.subarray(offset, offset + take)]);
              offset += take;
              if (
                prefix.length >= 4 &&
                (prefix.readUInt32BE(0) < 1 || prefix.readUInt32BE(0) > MAX_MANIFEST_BYTES)
              )
                throw failure();
              if (prefix.length >= 5 && prefix.length === 4 + prefix.readUInt32BE(0)) {
                manifest = decodeManifest(JSON.parse(prefix.subarray(4).toString("utf8")));
                if (
                  manifest.environmentId !== input.environmentId ||
                  !Number.isFinite(Date.parse(manifest.createdAt))
                )
                  throw failure();
              }
            }
            bytes = bytes.subarray(offset);
          }
          if (bytes.length) {
            if (!manifest || received + bytes.length > manifest.snapshotBytes) throw failure();
            hash.update(bytes);
            received += bytes.length;
            if (destination) {
              let offset = 0;
              while (offset < bytes.length) {
                const written = await destination.write(bytes, offset, bytes.length - offset);
                if (written.bytesWritten === 0) throw failure();
                offset += written.bytesWritten;
              }
            }
          }
        };
        consume().then(
          () => callback(),
          () => callback(failure()),
        );
      },
    });
    await NodeStreamPromises.pipeline(
      NodeFS.createReadStream("", {
        fd: source.fd,
        start: HEADER_BYTES,
        end: size - TAG_BYTES - 1,
        autoClose: false,
      }),
      decipher,
      sink,
      { signal },
    );
    signal.throwIfAborted();
    const verified = manifest as Manifest | null;
    if (
      !verified ||
      received !== verified.snapshotBytes ||
      hash.digest("hex") !== verified.snapshotSha256
    )
      throw failure();
    return receipt(verified);
  } finally {
    key.fill(0);
    derived?.fill(0);
    await source?.close();
  }
};
export const layer = Layer.succeed(
  RecoveryArchive,
  RecoveryArchive.of({
    createKey: Effect.fn("RecoveryArchive.createKey")((path) =>
      run(async (signal) => {
        const key = NodeCrypto.randomBytes(32);
        try {
          await withOutput(path, signal, async (handle) => {
            signal.throwIfAborted();
            await handle.writeFile(key);
            signal.throwIfAborted();
          });
        } finally {
          key.fill(0);
        }
      }),
    ),
    seal,
    verify: Effect.fn("RecoveryArchive.verify")((input) =>
      run((signal) => readArchive(input, null, signal)),
    ),
    unseal: Effect.fn("RecoveryArchive.unseal")((input) =>
      run((signal) =>
        withOutput(input.snapshotFile, signal, (destination) =>
          readArchive(input, destination, signal),
        ),
      ),
    ),
  }),
);
