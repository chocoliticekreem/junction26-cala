// Mints an ElevenLabs single-use realtime Scribe token (15 min, consumed on use) so the
// browser can open the realtime STT socket without ever seeing ELEVENLABS_API_KEY.
export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY;
  // 200, not 404: an unconfigured key is a normal state, and a 404 logs a console error in the
  // browser on every mic start.
  if (!key || process.env.E2E_MOCK === "1") return Response.json({ configured: false });
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
      method: "POST",
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn("stt-token: ElevenLabs", res.status);
      return Response.json({ error: "upstream_error" }, { status: 502 });
    }
    const { token } = (await res.json()) as { token?: string };
    if (!token) return Response.json({ error: "upstream_error" }, { status: 502 });
    return Response.json({ configured: true, token }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.warn("stt-token:", e instanceof Error ? e.message : e);
    return Response.json({ error: "upstream_error" }, { status: 502 });
  }
}
