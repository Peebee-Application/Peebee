// Same as apps/customer/components/live/whip.ts (the creator live pipeline). Keep the two in step.
/**
 * Sends a phone's camera to the video provider over WebRTC (the WHIP standard): one POST of an offer to the
 * private address the API handed out, and the answer comes back in the reply. No app or encoder is needed.
 */
export async function publishWhip(url: string, stream: MediaStream): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], bundlePolicy: "max-bundle" });
  try {
    for (const track of stream.getTracks()) pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc, 2500);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: pc.localDescription!.sdp });
    if (!res.ok) throw new Error(`The stream address answered ${res.status}`);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    return pc;
  } catch (err) {
    pc.close();
    throw err;
  }
}

function iceGathered(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener("icegatheringstatechange", check); clearTimeout(timer); resolve(); };
    const check = () => { if (pc.iceGatheringState === "complete") done(); };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/** Resolves when the connection is actually carrying media, or rejects after a while. */
export function whenConnected(pc: RTCPeerConnection, timeoutMs = 12000): Promise<void> {
  if (pc.connectionState === "connected") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pc.removeEventListener("connectionstatechange", check); reject(new Error("timeout")); }, timeoutMs);
    const check = () => {
      if (pc.connectionState === "connected") { clearTimeout(timer); pc.removeEventListener("connectionstatechange", check); resolve(); }
      else if (pc.connectionState === "failed") { clearTimeout(timer); pc.removeEventListener("connectionstatechange", check); reject(new Error("failed")); }
    };
    pc.addEventListener("connectionstatechange", check);
  });
}
