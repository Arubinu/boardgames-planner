// scripts/shared/api.js
// Client HTTP minimal partagé par toutes les pages.

export const API = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  },

  // Requêtes mutables / authentifiées. Le mot de passe admin est transmis
  // dans l'en-tête « x-admin-password » (jamais en clair dans l'URL).
  async send(url, method, body, password) {
    const headers = { 'Content-Type': 'application/json' };
    if (password) headers['x-admin-password'] = password;
    const r = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || r.statusText);
      err.status = r.status;
      if (data.retryAfter != null) err.retryAfter = data.retryAfter;
      throw err;
    }
    return data;
  },
};
