import { API_BASE_URL, socket } from './api';

export const AUTH_REQUIRED_EVENT = 'forex-operator-auth-required';

async function authRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}/api/auth/${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok && !(path === 'status' && response.status === 503)) {
    throw new Error(data.error || 'Unable to verify operator access');
  }
  return data;
}

export const operatorAuth = {
  status: () => authRequest('status'),
  login: (token) => authRequest('login', { method: 'POST', body: JSON.stringify({ token }) }),
  logout: async () => {
    await authRequest('logout', { method: 'POST' });
    socket.disconnect();
  },
};
