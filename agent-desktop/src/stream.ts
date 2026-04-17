/**
 * Screen streaming module — captures desktop via Electron desktopCapturer
 * and streams via WebRTC to the admin's browser.
 *
 * Flow:
 * 1. Admin clicks "Start Live Stream" → backend emits socket event to agent
 * 2. Agent receives event → starts capturing screen → creates WebRTC offer
 * 3. Offer/answer/ICE candidates exchanged via Socket.io signaling
 * 4. Admin browser receives video stream → shows in <video> element
 *
 * Bug #2 fix: renderer reports getUserMedia/WebRTC errors back via IPC so admin
 * sees a clear error message instead of a silent 15-second timeout.
 *
 * Bug #3 fix: TURN server credentials passed from config → renderer so the agent
 * works behind enterprise NAT where STUN-only fails.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { getAccessToken } from './api';
import { CONFIG } from './config';

let streamWindow: BrowserWindow | null = null;
let isStreaming = false;

/**
 * Create a hidden renderer window that handles WebRTC.
 * WebRTC requires a renderer process (browser context).
 */
export function initStreamWindow() {
  if (streamWindow) return;

  streamWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load the WebRTC streaming page
  const html = getStreamHTML();
  streamWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  streamWindow.on('closed', () => {
    streamWindow = null;
    isStreaming = false;
  });
}

export function startStream(adminSocketId: string, signalingUrl: string) {
  if (!streamWindow) initStreamWindow();
  if (!streamWindow) return;

  isStreaming = true;
  streamWindow.webContents.send('start-stream', {
    adminSocketId,
    signalingUrl,
    token: getAccessToken(),
    // Bug #3: pass TURN credentials so the renderer can build a full ICE config
    turnUrl: CONFIG.TURN_URL,
    turnUsername: CONFIG.TURN_USERNAME,
    turnCredential: CONFIG.TURN_CREDENTIAL,
  });
}

export function stopStream() {
  if (streamWindow) {
    streamWindow.webContents.send('stop-stream');
  }
  isStreaming = false;
}

export function handleSignalingMessage(data: any) {
  if (streamWindow) {
    streamWindow.webContents.send('signaling-message', data);
  }
}

export function getIsStreaming() { return isStreaming; }

function getStreamHTML(): string {
  return `<!DOCTYPE html>
<html><head><title>Stream</title></head><body>
<script>
  const { ipcRenderer } = require('electron');
  const { desktopCapturer } = require('electron');

  let peerConnection = null;
  let mediaStream = null;

  ipcRenderer.on('start-stream', async (_, config) => {
    try {
      // Get screen sources
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 }
      });

      if (sources.length === 0) {
        throw new Error('No screen sources found — desktopCapturer returned empty list');
      }

      // Get screen stream using getUserMedia with chromeMediaSource.
      // Note: Electron 28+ removed the legacy chromeMediaSource constraint in some builds.
      // If getUserMedia fails here, the error is caught and reported to the admin.
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sources[0].id,
            maxWidth: 1280,
            maxHeight: 720,
            maxFrameRate: 15,
          }
        }
      });

      // Build ICE server list — STUN always included; TURN added if configured (Bug #3)
      const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ];
      if (config.turnUrl) {
        iceServers.push({
          urls: config.turnUrl,
          username: config.turnUsername || '',
          credential: config.turnCredential || '',
        });
      }

      // Create RTCPeerConnection
      peerConnection = new RTCPeerConnection({ iceServers });

      // Add screen tracks to peer connection
      mediaStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, mediaStream);
      });

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          ipcRenderer.send('webrtc-signal', {
            type: 'ice-candidate',
            candidate: event.candidate,
            targetSocketId: config.adminSocketId,
          });
        }
      };

      // Create and send offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      ipcRenderer.send('webrtc-signal', {
        type: 'offer',
        sdp: offer,
        targetSocketId: config.adminSocketId,
      });

      console.log('[Stream] Offer sent, waiting for answer...');
    } catch (err) {
      // Bug #2: Report error to main process so it can relay to the admin socket
      const message = err && err.message ? err.message : String(err);
      console.error('[Stream] Error:', message);
      ipcRenderer.send('webrtc-error', {
        message: 'Screen capture failed on agent: ' + message,
        adminSocketId: config.adminSocketId,
      });
    }
  });

  ipcRenderer.on('signaling-message', async (_, data) => {
    if (!peerConnection) return;

    try {
      if (data.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        console.log('[Stream] Answer received, connection establishing...');
      } else if (data.type === 'ice-candidate' && data.candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } catch (err) {
      console.error('[Stream] Signaling error:', err);
    }
  });

  ipcRenderer.on('stop-stream', () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    console.log('[Stream] Stopped');
  });
</script>
</body></html>`;
}
