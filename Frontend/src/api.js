// Automatically use window.location.origin if hosted live via ngrok/Vercel, 
// otherwise fall back to localhost for local development
const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return window.location.origin;
    }
  }
  return import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
};

const BASE_URL = getBaseUrl().replace(/\/+$/, '')
const API_URL = BASE_URL.endsWith('/api') ? BASE_URL : `${BASE_URL}/api`

async function request(path, options = {}) {
  const storedEmail = localStorage.getItem('apex_user_email')
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }

  if (storedEmail) {
    headers['X-Apex-User-Email'] = storedEmail
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    // no JSON body
  }

  if (!res.ok) {
    const message = data?.detail || `Request failed (${res.status})`
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message))
  }

  return data
}

export const api = {
  // Auth Routes
  signup: (email, password) => request('/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email, password) => request('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  googleIdentityLogin: (token) => request('/auth/google', { method: 'POST', body: JSON.stringify({ token }) }),
  me: (email) => request(`/me?user_email=${encodeURIComponent(email)}`),

  // Banking Routes
  listAccounts: () => request('/accounts'),
  getAccount: (id, email) => request(`/accounts/${id}?email=${encodeURIComponent(email)}`),
  createAccount: (name, starting_balance, email) => request('/accounts', { method: 'POST', body: JSON.stringify({ name, starting_balance, email }) }),
  transactionHistory: (id, email) => request(`/accounts/${id}/transactions?email=${encodeURIComponent(email)}`),

  // Transaction Routes
  deposit: (account_id, amount, email) => request('/deposit', { method: 'POST', body: JSON.stringify({ account_id, amount, email }) }),
  withdraw: (account_id, amount, email) => request('/withdraw', { method: 'POST', body: JSON.stringify({ account_id, amount, email }) }),
  transfer: (from_account_id, to_account_id, amount, email) => request('/transfer', { method: 'POST', body: JSON.stringify({ from_account_id, to_account_id, amount, email }) }),

  // Database-backed AI chat history
  listConversations: (agentKey, userEmail, limit = 50) => request(`/conversations?agent_key=${encodeURIComponent(agentKey)}&user_email=${encodeURIComponent(userEmail)}&limit=${encodeURIComponent(limit)}`),
  createConversation: (agentKey, userEmail, title = 'New conversation') => request('/conversations', {
    method: 'POST',
    body: JSON.stringify({ agent_key: agentKey, user_email: userEmail, title }),
  }),
  getConversation: (conversationId, userEmail) => request(`/conversations/${encodeURIComponent(conversationId)}?user_email=${encodeURIComponent(userEmail)}`),
  saveConversationMessages: (conversationId, userEmail, messages = []) => request(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'PUT',
    body: JSON.stringify({ user_email: userEmail, messages }),
  }),
  updateConversation: (conversationId, userEmail, title) => request(`/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'PUT',
    body: JSON.stringify({ user_email: userEmail, title }),
  }),
  deleteConversation: (conversationId, userEmail) => request(`/conversations/${encodeURIComponent(conversationId)}?user_email=${encodeURIComponent(userEmail)}`, { method: 'DELETE' }),
  getChatHistory: (agentKey, userEmail) => request(`/chat-history/${encodeURIComponent(agentKey)}?user_email=${encodeURIComponent(userEmail)}`),
  saveChatHistory: (agentKey, userEmail, messages = []) => request(`/chat-history/${encodeURIComponent(agentKey)}`, {
    method: 'PUT',
    body: JSON.stringify({ agent_key: agentKey, user_email: userEmail, messages }),
  }),
  clearChatHistory: (agentKey, userEmail) => request(`/chat-history/${encodeURIComponent(agentKey)}?user_email=${encodeURIComponent(userEmail)}`, {
    method: 'DELETE',
  }),

  // AI Agent & RAG Routes
  askPolicy: (question, history = []) => request('/rag/ask', { method: 'POST', body: JSON.stringify({ question, history }) }),
  chatAgent: (user_text, history, email) => request('/agent/chat', { method: 'POST', body: JSON.stringify({ user_text, history, email }) }),

  // Weather Routes
  getWeatherCities: () => request('/weather/cities'),
  getWeatherCity: (city) => request(`/weather/${encodeURIComponent(city)}`),
  askWeatherAgent: (user_text, history) => request('/weather/ask', {
    method: 'POST',
    body: JSON.stringify({ user_text, history }),
  }),

  // Live Crypto Routes
  getCryptoCurrencies: () => request('/crypto/currencies'),
  getCryptoAsset: (asset) => request(`/crypto/${encodeURIComponent(asset)}`),
  askCryptoAgent: (user_text, history) => request('/crypto/ask', {
    method: 'POST',
    body: JSON.stringify({ user_text, history }),
  }),

  // New modular AI agents
  webSearch: (query, history = [], max_results = 5) => request('/agent/web-search', {
    method: 'POST',
    body: JSON.stringify({ query, max_results, history }),
  }),

  // Image Generation (Returns full JSON object so UI component can unpack data.image)
  generateImage: (prompt, aspect_ratio = '1:1', image_size = '1K') => request('/agent/image', {
    method: 'POST',
    body: JSON.stringify({ prompt, aspect_ratio, image_size }),
  }),

  readEmails: (question, user_email, history = [], limit = 10) => request('/email/read', {
    method: 'POST',
    body: JSON.stringify({ question, limit, user_email, history }),
  }),
  getCalendarEvents: (limit, user_email) => request(`/calendar/events?limit=${encodeURIComponent(limit)}&user_email=${encodeURIComponent(user_email)}`),
  createCalendarEvent: (event, user_email) => request('/calendar/events', {
    method: 'POST',
    body: JSON.stringify({ ...event, user_email }),
  }),
  askCalendarAgent: (user_text, history, user_email) => request('/calendar/ask', {
    method: 'POST',
    body: JSON.stringify({ user_text, history, user_email }),
  }),
  googleStatus: (provider, user_email) => request(`/google/status?provider=${encodeURIComponent(provider)}&user_email=${encodeURIComponent(user_email)}`),
  googleConnect: async (provider, user_email) => {
    const data = await request(`/google/connect?provider=${encodeURIComponent(provider)}&user_email=${encodeURIComponent(user_email)}`)
    window.location.href = data.authorization_url
  },
  googleDisconnect: (provider, user_email) => request(`/google/status?provider=${encodeURIComponent(provider)}&user_email=${encodeURIComponent(user_email)}`, { method: 'DELETE' }),
  
  // AI Email Agent
  createEmailDraft: (prompt, user_email, history = []) => request('/email/draft', {
    method: 'POST',
    body: JSON.stringify({ prompt, user_email, history }),
  }),
  sendEmail: (recipient, subject, body, user_email) => request('/email/send', {
    method: 'POST',
    body: JSON.stringify({ recipient, subject, body, user_email }),
  }),
}