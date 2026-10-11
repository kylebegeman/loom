/** Reads exact binary STL records, using vertex winding rather than the stored normals. */
export function parseBinaryStl(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength < 84) throw new RangeError("Binary STL header is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (bytes.byteLength !== 84 + count * 50)
    throw new RangeError("Binary STL triangle count does not match its byte length.");
  const positions = new Float32Array(count * 9);
  for (let triangle = 0; triangle < count; triangle++)
    for (let coordinate = 0; coordinate < 9; coordinate++) {
      const value = view.getFloat32(84 + triangle * 50 + 12 + coordinate * 4, true);
      if (!Number.isFinite(value)) throw new RangeError("Binary STL vertices must be finite.");
      positions[triangle * 9 + coordinate] = value;
    }
  return positions;
}
