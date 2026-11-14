// Speech-to-text behind one small interface. Default provider: the browser's Web Speech
// API (Chrome). An ElevenLabs realtime provider can plug in behind the same interface
// once /api/stt-token exists.

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

// Placeholder for the ElevenLabs realtime path: mint a token at /api/stt-token, open the
// realtime socket, emit the same interim/final events. Reports unsupported until built.
export const elevenLabsProvider: SttProvider = {
  name: "elevenlabs",
  supported: () => false,
  start(handlers) {
    handlers.onError?.("ElevenLabs STT not configured");
    return { stop() {} };
  },
};

export function pickProvider(): SttProvider {
  if (elevenLabsProvider.supported()) return elevenLabsProvider;
  return webSpeechProvider;
}

export function isSttSupported(): boolean {
  return pickProvider().supported();
}
