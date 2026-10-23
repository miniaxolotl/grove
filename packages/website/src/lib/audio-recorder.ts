export async function beginRecording(onSeconds: (seconds: number) => void) {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext)
    throw new Error(
      "Recording is unavailable here. Upload a PCM WAV file instead.",
    );
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true },
    video: false,
  });
  const context = new AudioContext();
  const chunks: Float32Array[] = [];
  let count = 0,
    closed = false,
    displayed = -1;
  let resolve!: (file: File | null) => void;
  const finished = new Promise<File | null>((done) => {
    resolve = done;
  });
  const close = async () => {
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
  };
  const stop = async (discard = false) => {
    if (closed) return;
    closed = true;
    await close();
    if (discard || !count) {
      resolve(null);
      return;
    }
    const source = new Float32Array(count);
    let offset = 0;
    for (const chunk of chunks) {
      source.set(chunk, offset);
      offset += chunk.length;
    }
    const rate = 16000,
      frames = Math.min(
        60 * rate,
        Math.floor((count / context.sampleRate) * rate),
      );
    const buffer = new ArrayBuffer(44 + frames * 2),
      bytes = new DataView(buffer);
    const text = (at: number, value: string) => {
      for (let i = 0; i < value.length; i++)
        bytes.setUint8(at + i, value.charCodeAt(i));
    };
    text(0, "RIFF");
    bytes.setUint32(4, buffer.byteLength - 8, true);
    text(8, "WAVEfmt ");
    bytes.setUint32(16, 16, true);
    bytes.setUint16(20, 1, true);
    bytes.setUint16(22, 1, true);
    bytes.setUint32(24, rate, true);
    bytes.setUint32(28, rate * 2, true);
    bytes.setUint16(32, 2, true);
    bytes.setUint16(34, 16, true);
    text(36, "data");
    bytes.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) {
      const start = Math.floor((i * context.sampleRate) / rate),
        end = Math.min(
          count,
          Math.max(
            start + 1,
            Math.floor(((i + 1) * context.sampleRate) / rate),
          ),
        );
      let sample = 0;
      for (let n = start; n < end; n++) sample += source[n];
      sample = Math.max(-1, Math.min(1, sample / (end - start)));
      bytes.setInt16(
        44 + i * 2,
        Math.round(sample * (sample < 0 ? 32768 : 32767)),
        true,
      );
    }
    resolve(new File([buffer], "Recording.wav", { type: "audio/wav" }));
  };
  try {
    await context.audioWorklet.addModule("/media-recorder.worklet.js");
    const input = context.createMediaStreamSource(stream),
      worklet = new AudioWorkletNode(context, "grove-recorder"),
      mute = context.createGain();
    mute.gain.value = 0;
    input.connect(worklet);
    worklet.connect(mute);
    mute.connect(context.destination);
    worklet.port.onmessage = (event) => {
      if (closed) return;
      const remaining = Math.max(
          0,
          Math.floor(context.sampleRate * 60) - count,
        ),
        samples = (event.data as Float32Array).slice(0, remaining);
      chunks.push(samples);
      count += samples.length;
      const seconds = Math.floor(count / context.sampleRate);
      if (seconds !== displayed) {
        displayed = seconds;
        onSeconds(seconds);
      }
      if (count >= context.sampleRate * 60) void stop();
    };
    await context.resume();
  } catch (error) {
    await close();
    throw error;
  }
  return { finished, stop: () => stop(), cancel: () => stop(true) };
}
