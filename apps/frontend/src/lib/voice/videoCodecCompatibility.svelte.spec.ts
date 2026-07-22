import { afterEach, describe, expect, it, vi } from 'vitest';

const peerConnections: RTCPeerConnection[] = [];
const mediaTracks: MediaStreamTrack[] = [];
const animationTimers: number[] = [];

afterEach(() => {
  for (const timer of animationTimers.splice(0)) window.clearInterval(timer);
  for (const track of mediaTracks.splice(0)) track.stop();
  for (const peerConnection of peerConnections.splice(0)) peerConnection.close();
});

describe('call video codec compatibility', () => {
  it('sends and decodes the VP8 common baseline', async () => {
    const capabilities = RTCRtpSender.getCapabilities('video');
    const vp8Codecs = capabilities?.codecs.filter(
      (codec) => codec.mimeType.toLowerCase() === 'video/vp8'
    );
    expect(vp8Codecs?.length).toBeGreaterThan(0);

    const sender = new RTCPeerConnection();
    const receiver = new RTCPeerConnection();
    peerConnections.push(sender, receiver);
    sender.onicecandidate = ({ candidate }) => {
      if (candidate) void receiver.addIceCandidate(candidate);
    };
    receiver.onicecandidate = ({ candidate }) => {
      if (candidate) void sender.addIceCandidate(candidate);
    };

    const track = createAnimatedCanvasTrack();
    mediaTracks.push(track);
    const transceiver = sender.addTransceiver(track, { direction: 'sendonly' });
    transceiver.setCodecPreferences(vp8Codecs!);

    const remoteTrack = new Promise<MediaStreamTrack>((resolve) => {
      receiver.ontrack = (event) => resolve(event.track);
    });
    const offer = await sender.createOffer();
    await sender.setLocalDescription(offer);
    await receiver.setRemoteDescription(offer);
    const answer = await receiver.createAnswer();
    await receiver.setLocalDescription(answer);
    await sender.setRemoteDescription(answer);

    const receivedTrack = await remoteTrack;
    mediaTracks.push(receivedTrack);
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([receivedTrack]);
    document.body.append(video);

    try {
      await vi.waitFor(
        async () => {
          const outbound = await primaryVideoRtpStats(sender, 'outbound-rtp');
          const inbound = await primaryVideoRtpStats(receiver, 'inbound-rtp');
          expect(outbound.codecMimeType).toBe('video/VP8');
          expect(outbound.bytes).toBeGreaterThan(0);
          expect(inbound.codecMimeType).toBe('video/VP8');
          expect(inbound.bytes).toBeGreaterThan(0);
          expect(inbound.frames).toBeGreaterThan(0);
        },
        { timeout: 10_000, interval: 100 }
      );
    } finally {
      video.remove();
    }
  });
});

function createAnimatedCanvasTrack(): MediaStreamTrack {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is unavailable');

  let frame = 0;
  const paint = () => {
    context.fillStyle = frame % 2 === 0 ? '#0066ff' : '#ff8a00';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.font = '48px sans-serif';
    context.fillText(`Towk ${frame}`, 32, 96);
    frame += 1;
  };
  paint();
  animationTimers.push(window.setInterval(paint, 50));

  const track = canvas.captureStream(20).getVideoTracks()[0];
  if (!track) throw new Error('Canvas capture did not produce a video track');
  return track;
}

async function primaryVideoRtpStats(
  peerConnection: RTCPeerConnection,
  type: 'inbound-rtp' | 'outbound-rtp'
): Promise<{
  bytes: number;
  codecMimeType: string | null;
  frames: number;
}> {
  const report = await peerConnection.getStats();
  for (const stat of report.values()) {
    if (stat.type !== type || stat.kind !== 'video' || stat.isRemote) continue;
    const codec = stat.codecId ? report.get(stat.codecId) : undefined;
    return {
      bytes: type === 'inbound-rtp' ? (stat.bytesReceived ?? 0) : (stat.bytesSent ?? 0),
      codecMimeType: codec?.mimeType ?? null,
      frames: type === 'inbound-rtp' ? (stat.framesDecoded ?? 0) : (stat.framesEncoded ?? 0)
    };
  }
  return { bytes: 0, codecMimeType: null, frames: 0 };
}
