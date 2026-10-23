// Loaded only after an explicit microphone action. Samples never leave this page
// until the user stops and attaches the resulting PCM WAV file.
class GroveRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples?.length) this.port.postMessage(samples.slice());
    return true;
  }
}
registerProcessor("grove-recorder", GroveRecorder);
