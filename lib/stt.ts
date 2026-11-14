// Speech-to-text behind one small interface. ElevenLabs realtime when /api/stt-token is
// configured; otherwise the browser's Web Speech API (Chrome).

export type SttHandlers = {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
};

export type SttSession = { stop(): void };

export type SttProvider = {
  name: "web-speech" | "elevenlabs";
  supported(): boolean;
  start(handlers: SttHandlers, lang?: string): SttSession;
};

type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechRecognitionEventLike = { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const webSpeechProvider: SttProvider = {
  name: "web-speech",
  supported: () => Boolean(getCtor()),
  start(handlers, lang = "en-GB") {
    const Ctor = getCtor();
    if (!Ctor) {
      handlers.onError?.("Web Speech API not available in this browser");
      return { stop() {} };
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    let stopped = false;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (r.isFinal) handlers.onFinal(text);
        else interim += (interim ? " " : "") + text;
      }
      if (interim) handlers.onInterim?.(interim);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      handlers.onError?.(e.error);
    };
    // Chrome ends continuous sessions after ~60 s of audio; restart until stop() is called.
    rec.onend = () => {
      if (stopped) return handlers.onEnd?.();
      try {
        rec.start();
      } catch {
        handlers.onEnd?.();
      }
    };
    rec.start();
    return {
      stop() {
        stopped = true;
        rec.stop();
      },
    };
  },
};

// ElevenLabs realtime speech-to-text (Scribe). /api/stt-token mints a single-use token
// server-side; the browser opens the socket with it and streams 16 kHz PCM16 as base64 chunks.
// Commits use server-side voice activity detection, so each committed transcript is a final.
const ELEVEN_WS = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const TARGET_RATE = 16_000;
const SEND_EVERY_SAMPLES = TARGET_RATE / 10;

type ElevenMessage = { message_type: string; text?: string; error?: string };

// configured is false only when the route says no key is set; a failed request leaves it unknown
// so the next session tries again.
async function fetchSttToken(): Promise<{ configured?: boolean; token?: string }> {
  try {
    const res = await fetch("/api/stt-token", { cache: "no-store" });
    if (!res.ok) return {};
    const body = (await res.json()) as { configured?: unknown; token?: unknown };
    const token = typeof body.token === "string" && body.token ? body.token : undefined;
    return { configured: body.configured === false ? false : token ? true : undefined, token };
  } catch {
    return {};
  }
}

// Averages input samples into 16 kHz buckets; good enough for speech.
function downsample(input: Float32Array, inRate: number): Float32Array {
  if (inRate === TARGET_RATE) return input;
  const ratio = inRate / TARGET_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j];
    out[i] = to > from ? sum / (to - from) : 0;
  }
  return out;
}

function pcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

type MicTap = { stop(): void };

async function tapMic(stream: MediaStream, onSamples: (s: Float32Array, rate: number) => void): Promise<MicTap> {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  let node: AudioNode;
  try {
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
    const worklet = new AudioWorkletNode(ctx, "pcm-forwarder");
    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => onSamples(e.data, ctx.sampleRate);
    node = worklet;
  } catch {
    // Older browsers without AudioWorklet: the deprecated ScriptProcessor still works.
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate);
    node = proc;
  }
  source.connect(node);
  // A muted sink keeps the graph pulling audio without playing the mic back.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink);
  sink.connect(ctx.destination);
  return {
    stop() {
      source.disconnect();
      node.disconnect();
      void ctx.close();
    },
  };
}

function startElevenLabs(token: string, handlers: SttHandlers, lang: string): SttSession {
  let stopped = false;
  let ended = false;
  let tap: MicTap | undefined;
  let stream: MediaStream | undefined;
  let buffer: Float32Array[] = [];
  let buffered = 0;

  const params = new URLSearchParams({
    model_id: "scribe_v2_realtime",
    token,
    audio_format: "pcm_16000",
    commit_strategy: "vad",
    language_code: lang.split("-")[0],
  });
  const ws = new WebSocket(`${ELEVEN_WS}?${params}`);

  const cleanup = () => {
    tap?.stop();
    tap = undefined;
    stream?.getTracks().forEach((t) => t.stop());
    stream = undefined;
  };
  const finish = () => {
    cleanup();
    if (ended) return;
    ended = true;
    handlers.onEnd?.();
  };

  const flush = () => {
    if (!buffered || ws.readyState !== WebSocket.OPEN) return;
    const joined = new Float32Array(buffered);
    let o = 0;
    for (const b of buffer) {
      joined.set(b, o);
      o += b.length;
    }
    buffer = [];
    buffered = 0;
    ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: pcm16Base64(joined),
        commit: false,
        sample_rate: TARGET_RATE,
      }),
    );
  };

  ws.onopen = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (stopped) return cleanup();
      tap = await tapMic(stream, (samples, rate) => {
        const s = downsample(samples, rate);
        buffer.push(s);
        buffered += s.length;
        if (buffered >= SEND_EVERY_SAMPLES) flush();
      });
      if (stopped) cleanup();
    } catch (e) {
      handlers.onError?.(e instanceof Error ? e.message : "Microphone unavailable");
      ws.close();
    }
  };
  ws.onmessage = (e) => {
    let msg: ElevenMessage;
    try {
      msg = JSON.parse(String(e.data)) as ElevenMessage;
    } catch {
      return;
    }
    const text = msg.text?.trim();
    if (msg.message_type === "partial_transcript") {
      if (text) handlers.onInterim?.(text);
    } else if (msg.message_type === "committed_transcript") {
      if (text) handlers.onFinal(text);
    } else if (msg.error) {
      handlers.onError?.(`${msg.message_type}: ${msg.error}`);
    }
  };
  ws.onerror = () => {
    if (!stopped) handlers.onError?.("ElevenLabs connection error");
  };
  ws.onclose = finish;

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (ws.readyState === WebSocket.OPEN) {
        flush();
        ws.send(
          JSON.stringify({
            message_type: "input_audio_chunk",
            audio_base_64: "",
            commit: true,
            sample_rate: TARGET_RATE,
          }),
        );
      }
      cleanup();
      ws.close();
    },
  };
}

// undefined until the first session asks /api/stt-token; false once it answers configured:false,
// so later sessions go straight to Web Speech without a round trip.
let elevenLabsConfigured: boolean | undefined;

const canCaptureAudio = () =>
  typeof window !== "undefined" &&
  typeof WebSocket !== "undefined" &&
  typeof AudioContext !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

// Starts with a fresh token per session (tokens are single-use). If the token route reports no key
// (configured:false) or fails, the session falls back to Web Speech without the caller noticing.
export const elevenLabsProvider: SttProvider = {
  name: "elevenlabs",
  supported: canCaptureAudio,
  start(handlers, lang = "en-GB") {
    let inner: SttSession | undefined;
    let stopped = false;
    void fetchSttToken().then(({ configured, token }) => {
      if (stopped) return;
      if (configured !== undefined) elevenLabsConfigured = configured;
      if (token && canCaptureAudio()) inner = startElevenLabs(token, handlers, lang);
      else if (webSpeechProvider.supported()) inner = webSpeechProvider.start(handlers, lang);
      else handlers.onError?.("No speech-to-text available in this browser");
    });
    return {
      stop() {
        stopped = true;
        if (inner) inner.stop();
        else handlers.onEnd?.();
      },
    };
  },
};

export function pickProvider(): SttProvider {
  if (elevenLabsConfigured !== false && elevenLabsProvider.supported()) return elevenLabsProvider;
  return webSpeechProvider;
}

export function isSttSupported(): boolean {
  return webSpeechProvider.supported() || (elevenLabsConfigured === true && canCaptureAudio());
}
