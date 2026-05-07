import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AuthUser } from '@aniston/shared';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  /** True while the app silently attempts to restore session via refresh token cookie on startup */
  hydrating: boolean;
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  isAuthenticated: false,
  hydrating: true,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials(state, action: PayloadAction<{ user: AuthUser; accessToken: string }>) {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.isAuthenticated = true;
      state.hydrating = false;
    },
    setAccessToken(state, action: PayloadAction<string>) {
      state.accessToken = action.payload;
      state.isAuthenticated = true;
    },
    setUser(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload;
    },
    setHydrated(state) {
      state.hydrating = false;
    },
    logout(state) {
      state.user = null;
      state.accessToken = null;
      state.isAuthenticated = false;
      state.hydrating = false;
      try {
        // Tag with this tab's ID so other tabs can ignore their own broadcasts
        let tabId = sessionStorage.getItem('aniston_tab_id');
        if (!tabId) {
          tabId = Math.random().toString(36).slice(2);
          sessionStorage.setItem('aniston_tab_id', tabId);
        }
        new BroadcastChannel('auth').postMessage({ type: 'logout', from: tabId });
      } catch {}
    },
  },
});

export const { setCredentials, setAccessToken, setUser, setHydrated, logout } = authSlice.actions;
export default authSlice.reducer;
