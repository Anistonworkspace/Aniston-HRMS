// Main preload — reserved for future agentAPI surface extensions.
// Pair and stream windows use their own dedicated preloads (pair-preload.ts / stream-preload.ts).
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('agentAPI', {});
