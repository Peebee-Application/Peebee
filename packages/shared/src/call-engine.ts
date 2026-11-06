import type { ApiClient } from "./api-client.js";
import type { Call } from "./domain.js";

/** Local state machine for one active call — thin enough to drive from any
 * app's own React (or other) UI layer without pulling React into this
 * package. Handles both the signaling polling (ring/accept/decline/end,
 * same shape regardless of provider) and, when the call's provider is
 * "cloudflare", the actual WebRTC negotiation against Realtime SFU via the
 * server-side proxy in apps/api/src/calls/routes.ts. For "mock" (or any
 * other unimplemented provider) it just runs the signaling with no real
 * audio — useful for testing the ring/accept/decline flow with zero setup. */
export type CallEnginePhase =
  | "idle"
  | "ringing_outbound"
  | "ringing_inbound"
  | "connecting"
  | "connected"
  | "ended"
  | "failed";

export type CallEngineState = {
  phase: CallEnginePhase;
  call: Call | null;
  error: string | null;
};

export type CallEngineOptions = {
  api: ApiClient;
  onStateChange: (state: CallEngineState) => void;
  /** Needed only for the "cloudflare" provider — omit and the engine still
   * runs the full signaling flow, it just never carries real audio. */
  getUserMedia?: () => Promise<MediaStream>;
  onRemoteStream?: (stream: MediaStream) => void;
  /** How often to poll for status changes while ringing/connecting (ms). */
  pollMs?: number;
};

const DEFAULT_POLL_MS = 2000;

/** Non-trickle ICE needs the full candidate set gathered before the SDP is
 * useful to the other side — resolves once gathering finishes, or after
 * `timeoutMs` regardless (a slow network shouldn't hang the call forever;
 * whatever candidates gathered by then are still usable). */
function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }, timeoutMs);
    function check() {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

export class CallEngine {
  private api: ApiClient;
  private onStateChange: (state: CallEngineState) => void;
  private getUserMedia?: () => Promise<MediaStream>;
  private onRemoteStream?: (stream: MediaStream) => void;
  private pollMs: number;

  private state: CallEngineState = { phase: "idle", call: null, error: null };
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;

  constructor(opts: CallEngineOptions) {
    this.api = opts.api;
    this.onStateChange = opts.onStateChange;
    this.getUserMedia = opts.getUserMedia;
    this.onRemoteStream = opts.onRemoteStream;
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  }

  private setState(patch: Partial<CallEngineState>) {
    this.state = { ...this.state, ...patch };
    this.onStateChange(this.state);
  }

  private stopPolling() {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  /** Starts an outbound call and begins polling for the callee's response. */
  async startCall(input: { calleeId: string; orderId?: string; restaurantId?: string; schoolId?: string }) {
    this.setState({ phase: "ringing_outbound", call: null, error: null });
    try {
      const { call } = await this.api.startCall(input);
      this.setState({ call });
      this.pollUntilResolved(call.id);
    } catch (err) {
      this.setState({ phase: "failed", error: err instanceof Error ? err.message : "Couldn't start the call" });
    }
  }

  /** Adopts a call that's already ringing for me (from GET /calls/incoming) — call this once the UI shows the incoming-call screen. */
  presentIncoming(call: Call) {
    this.setState({ phase: "ringing_inbound", call, error: null });
  }

  async accept() {
    const call = this.state.call;
    if (!call) return;
    try {
      const { call: updated } = await this.api.acceptCall(call.id);
      this.setState({ call: updated, phase: "connecting" });
      await this.connectMedia(updated, "callee");
      this.pollUntilResolved(call.id);
    } catch (err) {
      this.setState({ phase: "failed", error: err instanceof Error ? err.message : "Couldn't join the call" });
    }
  }

  async decline() {
    const call = this.state.call;
    if (!call) return;
    await this.api.endCall(call.id, "declined").catch(() => {});
    this.teardown("ended");
  }

  async hangUp() {
    const call = this.state.call;
    this.stopPolling();
    this.closeMedia();
    if (call && call.status !== "ended" && call.status !== "declined" && call.status !== "missed") {
      const reason = call.status === "ringing" ? "missed" : "ended";
      await this.api.endCall(call.id, reason).catch(() => {});
    }
    this.setState({ phase: "ended" });
  }

  private teardown(phase: CallEnginePhase) {
    this.stopPolling();
    this.closeMedia();
    this.setState({ phase });
  }

  private closeMedia() {
    this.pc?.close();
    this.pc = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }

  /** Polls the call until it leaves a state either side can still act on —
   * picks up the callee accepting an outbound call, or either side ending
   * it. Cheap and simple over a WebSocket for a low-frequency event like
   * "did they pick up yet", matching every other polling loop in this app. */
  private pollUntilResolved(callId: string) {
    this.stopPolling();
    this.pollHandle = setInterval(async () => {
      try {
        const { call } = await this.api.getCall(callId);
        this.setState({ call });
        if (call.status === "accepted" && this.state.phase === "ringing_outbound") {
          this.setState({ phase: "connecting" });
          await this.connectMedia(call, "caller");
        } else if (call.status === "declined" || call.status === "missed" || call.status === "failed") {
          this.teardown("ended");
        } else if (call.status === "ended") {
          this.teardown("ended");
        }
      } catch {
        // transient error — keep polling, same tolerance as chat/order polling elsewhere
      }
    }, this.pollMs);
  }

  /** Real WebRTC for "cloudflare" (relayed through Realtime SFU) and
   * "webrtc_p2p" (direct browser-to-browser, free STUN/TURN); every other
   * provider (including "mock") just marks the call connected with no
   * audio path — signaling still works end-to-end for testing. */
  private async connectMedia(call: Call, role: "caller" | "callee") {
    if (call.provider === "cloudflare") {
      await this.connectCloudflare(call);
      return;
    }
    if (call.provider === "webrtc_p2p") {
      await this.connectP2P(call, role);
      return;
    }
    this.setState({ phase: "connected" });
  }

  private async connectCloudflare(call: Call) {
    if (!this.getUserMedia) {
      this.setState({ phase: "connected" });
      return;
    }
    try {
      const stream = await this.getUserMedia();
      this.localStream = stream;
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
      this.pc = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.ontrack = (e) => {
        if (e.streams[0]) this.onRemoteStream?.(e.streams[0]);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const { answer } = await this.api.publishCallSession(call.id, { type: "offer", sdp: offer.sdp ?? "" });
      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      // The other side may not have published yet — retry pulling their
      // track for a few seconds rather than failing the whole call.
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const pull = await this.api.pullRemoteCallTrack(call.id);
          if (pull.requiresRenegotiation && pull.offer) {
            await pc.setRemoteDescription(new RTCSessionDescription(pull.offer));
            const pullAnswer = await pc.createAnswer();
            await pc.setLocalDescription(pullAnswer);
            await this.api.renegotiateCall(call.id, { type: "answer", sdp: pullAnswer.sdp ?? "" });
          }
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      this.setState({ phase: "connected" });
    } catch (err) {
      this.setState({ phase: "failed", error: err instanceof Error ? err.message : "Couldn't connect audio" });
    }
  }

  /** Direct peer-to-peer — non-trickle ICE, so each side waits for its own
   * candidate gathering to finish before posting its (full) SDP, keeping
   * the exchange to just two text blobs on the call row rather than a
   * stream of individual ICE candidates. A few hundred ms to a couple of
   * seconds slower to connect than trickle ICE, but far simpler over a
   * polled HTTP signaling channel — nothing to lose ordering or dedupe. */
  private async connectP2P(call: Call, role: "caller" | "callee") {
    if (!this.getUserMedia) {
      this.setState({ phase: "connected" });
      return;
    }
    try {
      const { iceServers } = await this.api.getCallIceServers();
      const stream = await this.getUserMedia();
      this.localStream = stream;
      const pc = new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] });
      this.pc = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.ontrack = (e) => {
        if (e.streams[0]) this.onRemoteStream?.(e.streams[0]);
      };

      if (role === "caller") {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGatheringComplete(pc);
        await this.api.postCallOffer(call.id, { type: "offer", sdp: pc.localDescription?.sdp ?? "" });

        const answerSdp = await this.pollForSdpField(call.id, "answer_sdp");
        if (!answerSdp) throw new Error("The other side never answered");
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answerSdp }));
      } else {
        const offerSdp = await this.pollForSdpField(call.id, "offer_sdp");
        if (!offerSdp) throw new Error("Couldn't reach the other side");
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: offerSdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGatheringComplete(pc);
        await this.api.postCallAnswer(call.id, { type: "answer", sdp: pc.localDescription?.sdp ?? "" });
      }

      this.setState({ phase: "connected" });
    } catch (err) {
      this.setState({ phase: "failed", error: err instanceof Error ? err.message : "Couldn't connect audio" });
    }
  }

  /** Short-interval poll (separate from the main ring/status poll) for the
   * other side's offer/answer SDP to show up — typically resolves within a
   * second or two of the other side accepting. */
  private async pollForSdpField(
    callId: string,
    field: "offer_sdp" | "answer_sdp",
    timeoutMs = 20000,
  ): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { call } = await this.api.getCall(callId);
      if (call[field]) return call[field];
      await new Promise((r) => setTimeout(r, 800));
    }
    return null;
  }

  destroy() {
    this.stopPolling();
    this.closeMedia();
  }
}
