import { create } from 'zustand';

interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  accessToken: string | null;
  serverUrl: string | null;
  offlineMode: boolean;
  setAuth: (user: AuthUser, accessToken: string, serverUrl: string) => void;
  clearAuth: () => void;
  goOffline: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  accessToken: null,
  serverUrl: null,
  offlineMode: false,

  setAuth: (user: AuthUser, accessToken: string, serverUrl: string) => {
    set({
      isAuthenticated: true,
      user,
      accessToken,
      serverUrl,
      offlineMode: false,
    });
  },

  clearAuth: () => {
    set({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      serverUrl: null,
    });
  },

  goOffline: () => {
    set({ offlineMode: true });
  },
}));
