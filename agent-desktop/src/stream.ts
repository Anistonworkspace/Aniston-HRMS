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

import { BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getAccessToken } from './api';
import { CONFIG } from './config';

let streamWindow: BrowserWindow | null = null;
let isStreaming = false;
let streamHtmlPath: string | null = null;

// Serve desktopCapturer from main process — guard prevents duplicate handler on hot reload
ipcMain.removeHandler('get-screen-sources');
ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
  });
  return sources.map(s => ({ id: s.id, name: s.name, thumbnailDataUrl: s.thumbnail.toDataURL() }));
});

function writeStreamHtml(): string {
  const tmpDir = path.join(os.tmpdir(), 'aniston-agent');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const htmlPath = path.join(tmpDir, 'stream.html');
  fs.writeFileSync(htmlPath, getStreamHTML(), 'utf-8');
  return htmlPath;
}

/**
 * Create a hidden renderer window that handles WebRTC.
 * contextIsolation: true + preload exposes only the streamAPI surface.
 */
export function initStreamWindow() {
  if (streamWindow) return;

  streamHtmlPath = writeStreamHtml();

  streamWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'stream-preload.js'),
    },
  });

  streamWindow.loadFile(streamHtmlPath);

  streamWindow.on('closed', () => {
    streamWindow = null;
    isStreaming = false;
    if (streamHtmlPath) {
      try { fs.unlinkSync(streamHtmlPath); } catch {}
      streamHtmlPath = null;
    }
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

export function handleSignalingMessage(data: unknown) {
  if (streamWindow) {
    streamWindow.webContents.send('signaling-message', data);
  }
}

export function getIsStreaming() { return isStreaming; }

function getStreamHTML(): string {
  return `<!DOCTYPE html>
<html><head><title>Stream</title></head><body>
<script>
  let peerConnection = null;
  let mediaStream = null;

  window.streamAPI.onStartStream(async (config) => {
    try {
      const sources = await window.streamAPI.getSources();
      if (sources.length === 0) {
        throw new Error('No screen sources found');
      }

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

      peerConnection = new RTCPeerConnection({ iceServers });

      mediaStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, mediaStream);
      });

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          window.streamAPI.sendSignal({
            type: 'ice-candidate',
            candidate: event.candidate,
            targetSocketId: config.adminSocketId,
          });
        }
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      window.streamAPI.sendSignal({
        type: 'offer',
        sdp: peerConnection.localDescription,
        targetSocketId: config.adminSocketId,
      });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      window.streamAPI.sendError({
        message: 'Screen capture failed on agent: ' + message,
        adminSocketId: config.adminSocketId,
      });
    }
  });

  window.streamAPI.onSignalingMessage(async (data) => {
    if (!peerConnection) return;
    try {
      if (data.type === 'answer') {
        await peerConnection.setRemoteDescription(data.sdp);
      } else if (data.type === 'ice-candidate' && data.candidate) {
        await peerConnection.addIceCandidate(data.candidate);
      }
    } catch (err) {
      console.error('[Stream] Signaling error:', err);
    }
  });

  window.streamAPI.onStopStream(() => {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
  });
</script>
</body></html>`;
}
