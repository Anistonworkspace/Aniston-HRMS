import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AuthUser } from '@aniston/shared';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
}

// Restore token from localStorage so session survives page refresh
const persistedToken = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

const initialState: AuthState = {
  user: null,
  accessToken: persistedToken,
  isAuthenticated: !!persistedToken,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials(state, action: PayloadAction<{ user: AuthUser; accessToken: string }>) {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.isAuthenticated = true;
      // Persist to localStorage
      try { localStorage.setItem('accessToken', action.payload.accessToken); } catch {}
    },
    setAccessToken(state, action: PayloadAction<string>) {
      state.accessToken = action.payload;
      try { localStorage.setItem('accessToken', action.payload); } catch {}
    },
    setUser(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload;
    },
    logout(state) {
      state.user = null;
      state.accessToken = null;
      state.isAuthenticated = false;
      try {
        localStorage.removeItem('accessToken');
        new BroadcastChannel('auth').postMessage('logout');
      } catch {}
    },
  },
});

export const { setCredentials, setAccessToken, setUser, logout } = authSlice.actions;
export default authSlice.reducer;
