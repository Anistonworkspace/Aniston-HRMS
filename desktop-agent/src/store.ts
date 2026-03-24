import Store from 'electron-store';

interface StoreSchema {
  accessToken: string | null;
  refreshToken: string | null;
  email: string | null;
  employeeId: string | null;
  employeeName: string | null;
  apiUrl: string;
  offlineQueue: any[];
  offlineScreenshots: string[];
}

const store = new Store<StoreSchema>({
  defaults: {
    accessToken: null,
    refreshToken: null,
    email: null,
    employeeId: null,
    employeeName: null,
    apiUrl: 'http://localhost:4000/api',
    offlineQueue: [],
    offlineScreenshots: [],
  },
  encryptionKey: 'aniston-agent-v1', // Encrypt tokens at rest
});

export default store;
