const BASE = '/api';

function headers() {
  const userId = localStorage.getItem('pm_user_id');
  return {
    'Content-Type': 'application/json',
    ...(userId ? { 'x-user-id': userId } : {}),
  };
}

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  // Users
  login: (name, email) => request('POST', '/users', { name, email }),

  // Journeys
  createJourney: () => request('POST', '/journeys'),
  getJourneys: () => request('GET', '/journeys'),
  getJourney: (id) => request('GET', `/journeys/${id}`),
  getJourneyFull: (id) => request('GET', `/journeys/${id}/full`),
  updateStage: (id, stage) => request('PATCH', `/journeys/${id}/stage`, { stage }),

  // Moments
  saveMoment: (journeyId, slot, data) => request('PUT', `/journeys/${journeyId}/moments/${slot}`, data),
  getMoments: (journeyId) => request('GET', `/journeys/${journeyId}/moments`),

  // Realizations
  addRealization: (journeyId, data) => request('POST', `/journeys/${journeyId}/realizations`, data),
  getRealizations: (journeyId) => request('GET', `/journeys/${journeyId}/realizations`),
  deleteRealization: (journeyId, id) => request('DELETE', `/journeys/${journeyId}/realizations/${id}`),

  // Principles
  addPrinciple: (journeyId, data) => request('POST', `/journeys/${journeyId}/principles`, data),
  getPrinciples: (journeyId) => request('GET', `/journeys/${journeyId}/principles`),
  deletePrinciple: (journeyId, id) => request('DELETE', `/journeys/${journeyId}/principles/${id}`),

  // Habits
  addHabit: (journeyId, data) => request('POST', `/journeys/${journeyId}/habits`, data),
  getHabits: (journeyId) => request('GET', `/journeys/${journeyId}/habits`),
  updateHabit: (journeyId, id, data) => request('PATCH', `/journeys/${journeyId}/habits/${id}`, data),
  deleteHabit: (journeyId, id) => request('DELETE', `/journeys/${journeyId}/habits/${id}`),
};
