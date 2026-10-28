async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

export const api = {
  bootstrap: () => request('/api/bootstrap'),
  match: (id) => request(`/api/matches/${id}`),
  refresh: () => request('/api/refresh', { method: 'POST', body: '{}' }),
  refreshOdds: () => request('/api/odds/refresh', { method: 'POST', body: '{}' }),
  seed: (mode = 'official') => request('/api/seed', { method: 'POST', body: JSON.stringify({ mode }) }),
  addReview: (payload) => request('/api/reviews', { method: 'POST', body: JSON.stringify(payload) }),
  guesses: () => request('/api/guesses'),
  addGuess: (payload) => request('/api/guesses', { method: 'POST', body: JSON.stringify(payload) }),
  deleteGuess: (id) => request(`/api/guesses/${id}`, { method: 'DELETE' }),
  recordImport: (payload) => request('/api/import', { method: 'POST', body: JSON.stringify(payload) })
};
