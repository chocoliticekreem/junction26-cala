// Forwards raw mic samples (mono, context sample rate) to the main thread, which downsamples
// to 16 kHz PCM for ElevenLabs realtime STT (lib/stt.ts).
class PcmForwarder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-forwarder", PcmForwarder);
