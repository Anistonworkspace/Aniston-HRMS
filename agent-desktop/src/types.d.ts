declare module 'screenshot-desktop' {
  interface Options {
    filename?: string;
    format?: 'png' | 'jpg';
    screen?: number;
  }
  function screenshot(options?: Options): Promise<Buffer>;
  export default screenshot;
}

declare module 'socket.io-client' {
  import { Socket } from 'socket.io-client';
  export function io(url: string, opts?: any): Socket;
  export default io;
}

declare module 'active-win' {
  interface Result {
    title: string;
    id: number;
    bounds: { x: number; y: number; width: number; height: number };
    owner: { name: string; processId: number; path: string };
    url?: string;
    memoryUsage?: number;
  }
  function activeWin(): Promise<Result | undefined>;
  export default activeWin;
}
