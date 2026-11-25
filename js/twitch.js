(function () {
  'use strict';
  const ID = 'https://id.twitch.tv/oauth2';
  const API = 'https://api.twitch.tv/helix';
  const WS = 'wss://eventsub.wss.twitch.tv/ws';
  // Only what the chat and the Moderator page use. A sign-in from before 0.4.0
  // has fewer, so those actions stay greyed out until the next sign-in.
  const SCOPES = 'user:read:chat moderator:manage:banned_users moderator:manage:chat_messages moderator:manage:chat_settings moderator:manage:shield_mode moderator:manage:announcements moderator:manage:shoutouts channel:manage:broadcast channel:manage:raids channel:edit:commercial channel:manage:ads channel:manage:polls channel:manage:predictions channel:read:goals clips:edit moderator:manage:automod_settings moderator:manage:blocked_terms moderator:manage:unban_requests moderator:manage:warnings moderator:manage:suspicious_users channel:manage:moderators channel:manage:vips';

  class AuthError extends Error {}
  class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  async function form(path, fields) {
    const r = await fetch(ID + '/' + path, { method: 'POST', body: new URLSearchParams(fields) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  }

  // Device sign-in. onCode gets { user_code, verification_uri }; signal.cancelled stops it.
  async function deviceLogin(clientId, onCode, signal, secret = 'twitch') {
    const start = await form('device', { client_id: clientId, scopes: SCOPES });
    if (!start.ok) throw new Error(start.j.message === 'invalid client' ? 'Twitch does not recognise that Client ID.' : (start.j.message || 'Twitch refused to start sign-in.'));
    if (signal.cancelled) return null;
    onCode(start.j);
    const until = Date.now() + start.j.expires_in * 1000;
    let wait = (start.j.interval || 5) * 1000;
    while (Date.now() < until) {
      await MCH.sleep(wait);
      if (signal.cancelled) return null;
      let r;
      try {
        r = await form('token', { client_id: clientId, scopes: SCOPES, device_code: start.j.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      } catch { continue; } // brief network loss
      if (signal.cancelled) return null;
      if (r.ok) {
        const t = { clientId, access: r.j.access_token, refresh: r.j.refresh_token };
        await MCH.secrets.set(secret, t);
        return t;
      }
      const m = r.j.message || '';
      if (m === 'slow_down') wait += 5000;
      else if (m !== 'authorization_pending' && r.status < 500) throw new Error(m || 'Sign-in failed.');
    }
    throw new Error('The sign-in code expired. Try again.');
  }

  class TwitchAccount {
    constructor(token, emit, secret = 'twitch') { // secret: where this sign-in is kept
      this.secret = secret;
      this.platform = 'twitch';
      this.token = token;
      this.emit = emit;
      this.status = 'reconnecting';
      this.note = 'Connecting';
      this.name = 'Twitch';
      this.viewers = null; // null means offline or unknown
      this.backoff = 1000;
      this.seen = new Set();
      this.scopes = null; // null means not known yet
      this.stopped = false;
    }

    setStatus(status, note) { this.status = status; this.note = note || ''; this.emit('status', this); }

    async start() {
      try {
        const me = await this.api('GET', '/users');
        this.user = me.data[0];
        this.name = this.user.display_name;
      } catch (e) {
        if (this.stopped) return;
        if (e instanceof AuthError) { this.authLost(); return; }
        this.setStatus('reconnecting', 'Cannot reach Twitch, retrying');
        this.startTimer = setTimeout(() => this.start(), this.nextDelay());
        return;
      }
      if (this.stopped) return;
      await this.validate(); // learns which actions this sign-in allows
      if (this.stopped) return;
      this.backoff = 1000;
      this.emit('status', this);
      this.open(WS);
      this.pollViewers();
      this.viewTimer = setInterval(() => this.pollViewers(), 30000);
      this.validTimer = setInterval(() => this.validate(), 3600000); // Twitch asks for hourly checks
    }

    stop() {
      this.stopped = true;
      for (const t of ['startTimer', 'retryTimer', 'aliveTimer']) clearTimeout(this[t]);
      clearInterval(this.viewTimer);
      clearInterval(this.validTimer);
      this.closeSockets();
    }

    closeSockets() {
      for (const w of [this.ws, this.pending]) if (w) { w.onclose = w.onmessage = null; w.close(); }
      this.ws = this.pending = null;
    }

    authLost() {
      if (this.stopped) return;
      this.stop();
      MCH.secrets.del(this.secret);
      this.setStatus('error', 'Signed out, sign in again');
      this.emit('authLost', this);
    }

    nextDelay() {
      const d = this.backoff + Math.random() * 500;
      this.backoff = Math.min(this.backoff * 2, 60000);
      return d;
    }

    // Twitch refresh tokens work once, so only one dock may refresh at a time.
    refresh(usedAccess) {
      return MCH.withLock('mch.refresh.' + this.secret, async () => {
        const saved = await MCH.secrets.get(this.secret);
        if (!saved) throw new AuthError('Signed out');
        if (saved.access !== usedAccess) { this.token = saved; return; }
        const r = await form('token', { client_id: saved.clientId, grant_type: 'refresh_token', refresh_token: saved.refresh });
        if (!r.ok) {
          if (r.status === 400 || r.status === 401) throw new AuthError('Sign-in expired');
          throw new ApiError(r.status, 'Twitch sign-in is unavailable');
        }
        this.token = { clientId: saved.clientId, access: r.j.access_token, refresh: r.j.refresh_token };
        await MCH.secrets.set(this.secret, this.token);
      });
    }

    async api(method, path, query, body, retried) {
      const used = this.token.access;
      const qs = query ? '?' + new URLSearchParams(query) : '';
      const headers = { Authorization: 'Bearer ' + used, 'Client-Id': this.token.clientId };
      if (body) headers['Content-Type'] = 'application/json';
      const r = await fetch(API + path + qs, { method, headers, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 401 && !retried) {
        await this.refresh(used);
        return this.api(method, path, query, body, true);
      }
      if (r.status === 204) return null;
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new ApiError(r.status, j.message || 'Twitch error ' + r.status);
      return j;
    }

    async validate() {
      try {
        const used = this.token.access;
        const r = await fetch(ID + '/validate', { headers: { Authorization: 'OAuth ' + used } });
        if (r.status === 401) await this.refresh(used);
        else if (r.ok) { const j = await r.json(); if (Array.isArray(j.scopes)) this.scopes = j.scopes; }
      } catch (e) { if (e instanceof AuthError) this.authLost(); }
    }

    async pollViewers() {
      try {
        const s = await this.api('GET', '/streams', { user_id: this.user.id });
        this.viewers = s.data.length ? s.data[0].viewer_count : null;
        if (!this.stopped) this.emit('status', this);
      } catch (e) { if (e instanceof AuthError) this.authLost(); } // otherwise keep the last count
    }

    open(url, isMove) {
      if (this.stopped) return;
      const ws = new WebSocket(url);
      if (isMove) this.pending = ws; else this.ws = ws;
      let alive = 20000;
      const touch = () => {
        clearTimeout(this.aliveTimer);
        this.aliveTimer = setTimeout(() => this.lost(), alive);
      };
      touch();
      ws.onmessage = (ev) => {
        if (this.stopped || (ws !== this.ws && ws !== this.pending)) return;
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        touch();
        const type = m.metadata && m.metadata.message_type;
        if (type === 'session_welcome') {
          alive = ((m.payload.session.keepalive_timeout_seconds || 10) + 10) * 1000;
          touch();
          if (ws === this.pending) { // Twitch moved us: subscriptions carry over
            const old = this.ws;
            this.ws = ws;
            this.pending = null;
            if (old) { old.onclose = old.onmessage = null; old.close(); }
            this.setStatus('ok', 'Connected');
          } else {
            this.subscribe(ws, m.payload.session.id);
          }
        } else if (type === 'session_reconnect') {
          this.open(m.payload.session.reconnect_url, true);
        } else if (type === 'notification') {
          this.notify(m.metadata, m.payload);
        } else if (type === 'revocation') {
          if (m.payload.subscription.status === 'authorization_revoked') this.authLost();
          else this.setStatus('error', 'Twitch stopped sending chat');
        }
      };
      ws.onclose = () => { if (ws === this.ws || ws === this.pending) this.lost(); };
    }

    lost() {
      if (this.stopped) return;
      clearTimeout(this.aliveTimer);
      clearTimeout(this.retryTimer);
      this.closeSockets();
      this.setStatus('reconnecting', 'Reconnecting');
      this.retryTimer = setTimeout(() => this.open(WS), this.nextDelay());
    }

    async subscribe(ws, session) {
      const sub = (type) => this.api('POST', '/eventsub/subscriptions', null, {
        type,
        version: '1',
        condition: { broadcaster_user_id: this.user.id, user_id: this.user.id },
        transport: { method: 'websocket', session_id: session },
      });
      try {
        await sub('channel.chat.message');
      } catch (e) {
        if (this.stopped || ws !== this.ws) return;
        if (e instanceof AuthError) { this.authLost(); return; }
        if (e.status === 401 || e.status === 403) {
          clearTimeout(this.aliveTimer);
          this.closeSockets();
          this.setStatus('error', 'Twitch refused chat access: ' + e.message);
          return;
        }
        this.lost();
        return;
      }
      if (this.stopped || ws !== this.ws) return;
      this.backoff = 1000;
      this.setStatus('ok', 'Connected');
      const extra = await Promise.allSettled(['channel.chat.message_delete', 'channel.chat.clear_user_messages', 'channel.chat.clear'].map(sub));
      if (!this.stopped && ws === this.ws && extra.some((x) => x.status === 'rejected')) {
        this.setStatus('ok', 'Connected, but deleted messages may not update');
      }
    }

    notify(meta, payload) {
      if (this.seen.has(meta.message_id)) return; // Twitch can deliver twice
      this.seen.add(meta.message_id);
      if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
      const e = payload.event;
      switch (meta.subscription_type) {
        case 'channel.chat.message':
          this.emit('message', {
            account: this,
            id: e.message_id,
            at: meta.message_timestamp,
            userId: e.chatter_user_id,
            login: e.chatter_user_login,
            name: e.chatter_user_name,
            color: e.color,
            roles: (e.badges || []).map((b) => b.set_id),
            parts: e.message.fragments.map((f) => f.type === 'emote'
              ? { emote: f.emote.id, text: f.text }
              : { text: f.text, mention: f.type === 'mention' }),
            replyTo: e.reply ? { name: e.reply.parent_user_name, text: e.reply.parent_message_body } : null,
          });
          break;
        case 'channel.chat.message_delete': this.emit('remove', { account: this, id: e.message_id }); break;
        case 'channel.chat.clear_user_messages': this.emit('remove', { account: this, userId: e.target_user_id }); break;
        case 'channel.chat.clear': this.emit('remove', { account: this, all: true }); break;
      }
    }

    profileUrl(login) { return 'https://www.twitch.tv/' + encodeURIComponent(login); }
    modQuery(extra) { return Object.assign({ broadcaster_id: this.user.id, moderator_id: this.user.id }, extra); }
    ban(userId, seconds) {
      const data = { user_id: userId };
      if (seconds) data.duration = seconds;
      return this.api('POST', '/moderation/bans', this.modQuery(), { data });
    }
    unban(userId) { return this.api('DELETE', '/moderation/bans', this.modQuery({ user_id: userId })); }
    can(scope) { return !this.scopes || this.scopes.includes(scope); }
    own(extra) { return Object.assign({ broadcaster_id: this.user.id }, extra); }
    async chatSettings() { return (await this.api('GET', '/chat/settings', this.modQuery())).data[0]; }
    setChatSettings(patch) { return this.api('PATCH', '/chat/settings', this.modQuery(), patch); }
    clearChat() { return this.api('DELETE', '/moderation/chat', this.modQuery()); }
    async shield() { return (await this.api('GET', '/moderation/shield_mode', this.modQuery())).data[0].is_active; }
    setShield(on) { return this.api('PUT', '/moderation/shield_mode', this.modQuery(), { is_active: on }); }
    async channelInfo() { return (await this.api('GET', '/channels', this.own())).data[0]; }
    setChannelInfo(body) { return this.api('PATCH', '/channels', this.own(), body); }
    async findCategory(name) {
      const r = await this.api('GET', '/search/categories', { query: name, first: 100 });
      return r.data.find((g) => g.name.toLowerCase() === name.toLowerCase()) || null;
    }
    async findUser(login) { return /^\w{1,25}$/.test(login) ? (await this.api('GET', '/users', { login })).data[0] || null : null; }
    raid(to) { return this.api('POST', '/raids', { from_broadcaster_id: this.user.id, to_broadcaster_id: to }); }
    cancelRaid() { return this.api('DELETE', '/raids', this.own()); }
    async clip() { return (await this.api('POST', '/clips', this.own())).data[0]; }
    marker(description) { return this.api('POST', '/streams/markers', null, Object.assign({ user_id: this.user.id }, description ? { description } : {})); }
    announce(message, color) { return this.api('POST', '/chat/announcements', this.modQuery(), { message, color }); }
    shoutout(to) { return this.api('POST', '/chat/shoutouts', { from_broadcaster_id: this.user.id, to_broadcaster_id: to, moderator_id: this.user.id }); }
    commercial(length) { return this.api('POST', '/channels/commercial', null, { broadcaster_id: this.user.id, length }); }
    snoozeAd() { return this.api('POST', '/channels/ads/schedule/snooze', this.own()); }
    async polls() { return (await this.api('GET', '/polls', this.own({ first: 5 }))).data; }
    startPoll(title, choices, duration) { return this.api('POST', '/polls', null, { broadcaster_id: this.user.id, title, choices: choices.map((t) => ({ title: t })), duration }); }
    endPoll(id) { return this.api('PATCH', '/polls', null, { broadcaster_id: this.user.id, id, status: 'TERMINATED' }); }
    async predictions() { return (await this.api('GET', '/predictions', this.own({ first: 5 }))).data; }
    startPrediction(title, outcomes, seconds) { return this.api('POST', '/predictions', null, { broadcaster_id: this.user.id, title, outcomes: outcomes.map((t) => ({ title: t })), prediction_window: seconds }); }
    endPrediction(id, status, winner) { return this.api('PATCH', '/predictions', null, Object.assign({ broadcaster_id: this.user.id, id, status }, winner ? { winning_outcome_id: winner } : {})); }
    async automod() { return (await this.api('GET', '/moderation/automod/settings', this.modQuery())).data[0]; }
    setAutomod(level) { return this.api('PUT', '/moderation/automod/settings', this.modQuery(), { overall_level: level }); }
    async blockedTerms() { return (await this.api('GET', '/moderation/blocked_terms', this.modQuery({ first: 100 }))).data; }
    blockTerm(text) { return this.api('POST', '/moderation/blocked_terms', this.modQuery(), { text }); }
    unblockTerm(id) { return this.api('DELETE', '/moderation/blocked_terms', this.modQuery({ id })); }
    async unbanRequests() { return (await this.api('GET', '/moderation/unban_requests', this.modQuery({ status: 'pending', first: 50 }))).data; }
    resolveUnban(id, status, text) { return this.api('PATCH', '/moderation/unban_requests', this.modQuery(Object.assign({ unban_request_id: id, status }, text ? { resolution_text: text } : {}))); }
    warn(userId, reason) { return this.api('POST', '/moderation/warnings', this.modQuery(), { data: { user_id: userId, reason } }); }
    suspicious(userId, status) {
      return status ? this.api('POST', '/moderation/suspicious_users', this.modQuery(), { user_id: userId, status })
        : this.api('DELETE', '/moderation/suspicious_users', this.modQuery({ user_id: userId }));
    }
    addMod(userId) { return this.api('POST', '/moderation/moderators', this.own({ user_id: userId })); }
    removeMod(userId) { return this.api('DELETE', '/moderation/moderators', this.own({ user_id: userId })); }
    addVip(userId) { return this.api('POST', '/channels/vips', this.own({ user_id: userId })); }
    removeVip(userId) { return this.api('DELETE', '/channels/vips', this.own({ user_id: userId })); }
    async goals() { return (await this.api('GET', '/goals', this.own())).data; }
    deleteMessage(id) { return this.api('DELETE', '/moderation/chat', this.modQuery({ message_id: id })); }
  }

  MCH.twitch = { SCOPES, deviceLogin, TwitchAccount, AuthError };
})();
