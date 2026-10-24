/** Structurally valid MPEG Layer III frames; no copyrighted audio or provider calls. */
export function mp3Fixture(frames = 10, version: 1 | 2 | 2.5 = 1) {
  const header =
    version === 1
      ? [0xff, 0xfb, 0x90, 0]
      : version === 2
        ? [0xff, 0xf3, 0x80, 0]
        : [0xff, 0xe3, 0x80, 0];
  const frame = Buffer.alloc(version === 2 ? 208 : 417);
  Buffer.from(header).copy(frame);
  return Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]),
    ...Array.from({ length: frames }, () => frame),
  ]);
}
