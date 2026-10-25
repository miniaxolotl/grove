import { test } from "node:test";
import assert from "node:assert/strict";
import * as ai from "@lib/ai";
import { mp3Fixture } from "./fixtures/speech-audio.ts";

test("duration counts MPEG frames, not characters, bytes or a claimed VBR duration", () => {
  assert.equal(
    typeof ai.mp3DurationMs,
    "function",
    "metering requires measured MPEG duration",
  );
  assert.equal(
    ai.mp3DurationMs(mp3Fixture(10)),
    Math.ceil(((10 * 1152) / 44100) * 1000),
  );
  assert.equal(
    ai.mp3DurationMs(mp3Fixture(10, 2)),
    Math.ceil(((10 * 576) / 22050) * 1000),
  );
  assert.equal(
    ai.mp3DurationMs(mp3Fixture(10, 2.5)),
    Math.ceil(((10 * 576) / 11025) * 1000),
  );
  const fakeTag = mp3Fixture(10);
  fakeTag.write("Xing", 46);
  fakeTag.writeUInt32BE(0xffffffff, 54);
  assert.equal(ai.mp3DurationMs(fakeTag), ai.mp3DurationMs(mp3Fixture(10)));
  const tag = Buffer.alloc(128);
  tag.write("TAG");
  assert.equal(
    ai.mp3DurationMs(Buffer.concat([mp3Fixture(), tag])),
    ai.mp3DurationMs(mp3Fixture()),
  );
});

test("duration rejects missing/truncated frames and unsupported/free bitrate headers rather than granting unmetered speech", () => {
  for (const bytes of [
    Buffer.from("ID3"),
    mp3Fixture().subarray(0, -1),
    Buffer.concat([mp3Fixture(), Buffer.from("junk")]),
  ]) {
    assert.throws(() => ai.mp3DurationMs(bytes), /audio/i);
  }
  for (const header of [0, 0xf0, 0x9c]) {
    const bytes = mp3Fixture();
    bytes[12] = header;
    assert.throws(() => ai.mp3DurationMs(bytes), /audio/i);
  }
});
