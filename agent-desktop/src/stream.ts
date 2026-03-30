/**
 * Screen streaming module — captures desktop via Electron desktopCapturer
 * and streams via WebRTC to the admin's browser.
 *
 * Flow:
 * 1. Admin clicks "Start Live Stream" → backend emits socket event to agent
 * 2. Agent receives event → starts capturing screen → creates WebRTC offer
 * 3. Offer/answer/ICE candidates exchanged via Socket.io signaling
 * 4. Admin browser receives video stream → shows in <video> element
 */

import { BrowserWindow, desktopCapturer, ipcMain } from 'electron';
import path from 'path';
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
  let ws = null;

  ipcRenderer.on('start-stream', async (_, config) => {
    try {
      // Get screen sources
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 }
      });

      if (sources.length === 0) {
        console.error('No screen sources found');
        return;
      }

      // Get screen stream using getUserMedia with chromeMediaSource
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

      // Connect to signaling server via WebSocket
      const wsUrl = config.signalingUrl.replace('http', 'ws') || 'ws://localhost:4000';

      // Use Socket.io client for signaling instead of raw WebSocket
      // Send signals via IPC to main process which uses the existing Socket.io connection

      // Create RTCPeerConnection
      peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      });

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
      console.error('[Stream] Error:', err);
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
