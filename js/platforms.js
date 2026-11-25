(function () {
  'use strict';
  // Read-only chat from Kick, YouTube and TikTok, plus plain links for platforms
  // whose chat cannot be read from inside OBS. Each class looks the same to the
  // dock as TwitchAccount: start, stop, status, note, name, viewers.

  // "https://kick.com/Name", "@Name" or "Name" -> "Name"
  function handle(text) {
    let t = String(text || '').trim();
    const m = /^(?:https?:\/\/)?(?:www\.|m\.)?[a-z0-9-]+\.[a-z.]+\/(.+)$/i.exec(t);
    if (m) t = m[1].split(/[?#]/)[0].replace(/^(?:s|c|user)\//i, '').split('/')[0];
    return t.replace(/^@/, '');
  }
  // What a YouTube box holds: a video, a channel ID or a handle.
  function youtubeTarget(text) {
    const t = String(text || '').trim();
    const v = /(?:[?&]v=|youtu\.be\/|\/live\/|\/video\/|\/shorts\/)([\w-]{11})/.exec(t);
    if (v) return { video: v[1] };
    const c = /(?:^|\/channel\/)(UC[\w-]{22})(?:$|[/?#])/.exec(t);
    if (c) return { channel: c[1] };
    const h = handle(t);
    return /^[^\s/]{2,60}$/.test(h) ? { handle: '@' + h } : null;
  }

  class Base {
    constructor(cfg, emit) {
      Object.assign(this, { id: cfg.id, platform: cfg.platform, name: cfg.channel, cfg, emit, status: 'reconnecting', note: 'Connecting', viewers: null, backoff: 2000, stopped: false, seen: new Set(), timers: new Map() });
    }
    setStatus(status, note) { if (this.stopped) return; this.status = status; this.note = note || ''; this.emit('status', this); }
    setViewers(n) { const v = Number.isFinite(n) ? n : null; if (v !== this.viewers && !this.stopped) { this.viewers = v; this.emit('status', this); } }
    later(name, ms, fn) { clearTimeout(this.timers.get(name)); if (!this.stopped) this.timers.set(name, setTimeout(fn, ms)); }
    nextDelay() { const d = this.backoff + Math.random() * 500; this.backoff = Math.min(this.backoff * 2, 120000); return d; }
    once(id) {
      if (this.seen.has(id)) return false;
      this.seen.add(id);
      if (this.seen.size > 3000) this.seen.delete(this.seen.values().next().value);
      return true;
    }
    closeSocket() { for (const t of ['alive', 'ping']) { clearTimeout(this.timers.get(t)); this.timers.delete(t); } const w = this.ws; this.ws = null; if (w) { w.onclose = w.onmessage = w.onerror = null; w.close(); } }
    stop() { this.stopped = true; for (const t of this.timers.values()) clearTimeout(t); this.closeSocket(); }
    message(m) { if (!this.stopped) this.emit('message', Object.assign({ account: this, roles: [], color: '', replyTo: null }, m)); }
  }

  /* ---------- Kick: the chat kick.com itself shows, no sign-in. Unofficial. ---------- */

  function kickParts(text) {
    const out = [];
    let at = 0;
    for (const m of text.matchAll(/\[emote:(\d+):([^\]]*)\]/g)) {
      if (m.index > at) out.push({ text: text.slice(at, m.index) });
      out.push({ img: 'https://files.kick.com/emotes/' + m[1] + '/fullsize', text: m[2] || 'emote' });
      at = m.index + m[0].length;
    }
    if (at < text.length) out.push({ text: text.slice(at) });
    return out;
  }
  function kickMessage(d) {
    const s = d.sender || {}, id = s.identity || {}, meta = d.metadata || {};
    const plain = (t) => kickParts(String(t || '')).map((p) => p.text).join('');
    return {
      id: d.id, at: d.created_at, userId: String(s.id), login: String(s.username || '').toLowerCase(), name: String(s.username || '?'), color: id.color || '',
      roles: (Array.isArray(id.badges) ? id.badges : []).map((b) => b.type), parts: kickParts(String(d.content || '')),
      replyTo: d.type === 'reply' && meta.original_sender ? { name: meta.original_sender.username, text: plain(meta.original_message && meta.original_message.content) } : null,
    };
  }
  class KickAccount extends Base {
    constructor(cfg, emit) { super(cfg, emit); this.readOnly = 'Kick is read-only in this dock'; }
    start() { this.emit('status', this); this.find(); }
    async find() {
      let j;
      try {
        const slug = this.cfg.channel.toLowerCase().replace(/_/g, '-');
        const r = await fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(slug), { credentials: 'omit' });
        if (r.status === 404) { this.setStatus('error', 'Kick has no channel with this name'); return; }
        if (!r.ok) throw new Error();
        j = await r.json();
        if (!j.chatroom || !j.chatroom.id) throw new Error();
      } catch {
        if (this.stopped) return;
        this.setStatus('reconnecting', 'Cannot reach Kick, retrying');
        this.later('find', this.nextDelay(), () => this.find());
        return;
      }
      if (this.stopped) return;
      if (j.user && j.user.username) this.name = j.user.username;
      this.room = j.chatroom.id;
      this.live(j);
      this.later('views', 45000, () => this.poll());
      this.open();
    }
    live(j) { this.setViewers(j.livestream && j.livestream.is_live ? j.livestream.viewer_count : null); }
    async poll() {
      try {
        const r = await fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(this.cfg.channel.toLowerCase().replace(/_/g, '-')), { credentials: 'omit' });
        if (r.ok) this.live(await r.json());
      } catch { /* keep the last count */ }
      this.later('views', 45000, () => this.poll());
    }
    open() {
      if (this.stopped) return;
      this.closeSocket();
      const ws = this.ws = new WebSocket('wss://ws-us2.pusher.com/app/' + MCH.kickChatKey + '?protocol=7&client=js&version=8.4.0&flash=false');
      let quiet = 150000;
      const touch = () => this.later('alive', quiet, () => this.lost());
      touch();
      ws.onmessage = (e) => {
        if (ws !== this.ws) return;
        let m, d;
        try { m = JSON.parse(e.data); d = typeof m.data === 'string' && m.data ? JSON.parse(m.data) : m.data || {}; } catch { return; }
        touch();
        switch (m.event) {
          case 'pusher:connection_established':
            ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: 'chatrooms.' + this.room + '.v2' } }));
            this.later('ping', 60000, () => this.ping(ws));
            break;
          case 'pusher:ping': ws.send(JSON.stringify({ event: 'pusher:pong', data: {} })); break;
          case 'pusher_internal:subscription_succeeded': this.backoff = 2000; this.setStatus('ok', 'Connected, read-only'); break;
          case 'pusher:error':
            if (d.code === 4001) { // Kick replaces this key now and then
              this.closeSocket();
              this.setStatus('error', 'Kick changed how its chat connects. Update Multi Chat Hub');
              this.later('retry', 900000, () => this.open());
            }
            break;
          case 'App\\Events\\ChatMessageEvent': if (d.id && this.once(d.id)) this.message(kickMessage(d)); break;
          case 'App\\Events\\MessageDeletedEvent': if (d.message) this.emit('remove', { account: this, id: d.message.id }); break;
          case 'App\\Events\\UserBannedEvent': if (d.user) this.emit('remove', { account: this, userId: String(d.user.id) }); break;
          case 'App\\Events\\ChatroomClearEvent': this.emit('remove', { account: this, all: true }); break;
        }
      };
      ws.onclose = () => { if (ws === this.ws) this.lost(); };
    }
    ping(ws) {
      if (ws !== this.ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
      this.later('ping', 60000, () => this.ping(ws));
    }
    lost() {
      if (this.stopped) return;
      this.closeSocket();
      this.setStatus('reconnecting', 'Reconnecting');
      this.later('retry', this.nextDelay(), () => this.open());
    }
    profileUrl(login) { return 'https://kick.com/' + encodeURIComponent(login.replace(/_/g, '-')); }
  }

  /* ---------- YouTube: the official Data API with the streamer's own free key ---------- */

  const YT = 'https://www.googleapis.com/youtube/v3/';
  class YtError extends Error { constructor(status, reason, msg) { super(msg); this.status = status; this.reason = reason; } }
  // Hours of chat the free daily limit (10,000 units) allows at this pace.
  const youtubeHours = (seconds) => 10000 / (3600 / seconds * 5 + 60);
  function youtubeMessage(x) {
    const s = x.snippet || {}, a = x.authorDetails || {}, roles = [];
    if (a.isChatOwner) roles.push('broadcaster');
    if (a.isChatModerator) roles.push('moderator');
    const name = String(a.displayName || '?');
    return { id: x.id, at: s.publishedAt, userId: a.channelId, login: name.replace(/^@/, '').toLowerCase(), name: name.replace(/^@/, ''), roles, parts: [{ text: String(s.displayMessage || '') }] };
  }
  class YouTubeAccount extends Base {
    constructor(cfg, emit, key) { super(cfg, emit); this.key = key; this.target = youtubeTarget(cfg.channel); this.readOnly = 'YouTube is read-only in this dock'; }
    async api(path, query) {
      const r = await fetch(YT + path + '?' + new URLSearchParams(query), { headers: { 'X-Goog-Api-Key': this.key }, credentials: 'omit' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const e = j.error || {}, first = (e.errors || [])[0] || {};
        throw new YtError(r.status, first.reason || '', e.message || 'YouTube error ' + r.status);
      }
      return j;
    }
    start() { this.emit('status', this); if (!this.target) this.setStatus('error', 'This is not a YouTube channel or video'); else this.find(); }
    // Says what went wrong and returns how long to wait, or null to stop trying.
    trouble(e) {
      if (this.stopped) return null;
      if (e instanceof YtError) {
        if (/quota|dailyLimit/i.test(e.reason)) { this.setStatus('error', 'YouTube’s free daily limit is used up. It resets at midnight Pacific time'); return 1800000; }
        if (/rateLimit/i.test(e.reason)) return 20000;
        if (e.status === 400 && /api key/i.test(e.message)) { this.setStatus('error', 'YouTube did not accept the key'); return null; }
        if (e.status === 403 && !/liveChat/.test(e.reason)) { this.setStatus('error', 'YouTube refused: ' + e.message); return 600000; }
      }
      this.setStatus('reconnecting', 'Cannot reach YouTube, retrying');
      return this.nextDelay();
    }
    async find() {
      try {
        let ids;
        if (this.target.video) ids = [this.target.video];
        else {
          if (!this.uploads) {
            const q = { part: 'snippet,contentDetails' };
            if (this.target.channel) q.id = this.target.channel; else q.forHandle = this.target.handle;
            const c = ((await this.api('channels', q)).items || [])[0];
            if (this.stopped) return;
            if (!c) { this.setStatus('error', 'YouTube has no channel with this name'); return; }
            this.uploads = c.contentDetails.relatedPlaylists.uploads;
            this.name = c.snippet.title;
          }
          const p = await this.api('playlistItems', { part: 'contentDetails', playlistId: this.uploads, maxResults: 8 });
          ids = (p.items || []).map((x) => x.contentDetails.videoId);
        }
        const v = ids.length ? (await this.api('videos', { part: 'snippet,liveStreamingDetails', id: ids.join(',') })).items || [] : [];
        if (this.stopped) return;
        const open = v.filter((x) => x.liveStreamingDetails && x.liveStreamingDetails.activeLiveChatId && !x.liveStreamingDetails.actualEndTime);
        const now = open.find((x) => x.liveStreamingDetails.actualStartTime) || open[0];
        if (this.target.video && v[0]) this.name = v[0].snippet.channelTitle;
        this.backoff = 2000;
        if (!now) {
          this.setViewers(null);
          this.setStatus('ok', 'Not live. Checks every 2 minutes');
          this.later('find', 120000, () => this.find());
          return;
        }
        this.video = now.id;
        this.chat = now.liveStreamingDetails.activeLiveChatId;
        this.page = null;
        this.count(now);
        this.setStatus('ok', 'Connected, read-only');
        this.later('views', 60000, () => this.poll());
        this.read();
      } catch (e) {
        const wait = this.trouble(e);
        if (wait != null) this.later('find', wait, () => this.find());
      }
    }
    count(v) { const d = v.liveStreamingDetails; this.setViewers(d.actualStartTime ? Number(d.concurrentViewers || 0) : null); }
    async poll() {
      try {
        const v = ((await this.api('videos', { part: 'liveStreamingDetails', id: this.video })).items || [])[0];
        if (v && v.liveStreamingDetails && !v.liveStreamingDetails.actualEndTime) this.count(v);
      } catch { /* keep the last count */ }
      this.later('views', 60000, () => this.poll());
    }
    ended() {
      clearTimeout(this.timers.get('views'));
      this.setViewers(null);
      this.setStatus('ok', 'Not live. Checks every 2 minutes');
      this.later('find', 120000, () => this.find());
    }
    async read() {
      try {
        const q = { part: 'id,snippet,authorDetails', liveChatId: this.chat, maxResults: 500 };
        if (this.page) q.pageToken = this.page;
        const j = await this.api('liveChat/messages', q);
        if (this.stopped) return;
        this.page = j.nextPageToken;
        for (const x of j.items || []) {
          const t = x.snippet && x.snippet.type;
          if (t === 'userBannedEvent') { const u = (x.snippet.userBannedDetails || {}).bannedUserDetails; if (u) this.emit('remove', { account: this, userId: u.channelId }); } else if (t === 'tombstone') this.emit('remove', { account: this, id: x.id });
          else if (x.snippet && x.snippet.displayMessage && this.once(x.id)) this.message(youtubeMessage(x));
        }
        if (j.offlineAt) { this.ended(); return; }
        this.backoff = 2000;
        if (this.status !== 'ok') this.setStatus('ok', 'Connected, read-only');
        this.later('read', Math.max(j.pollingIntervalMillis || 0, this.cfg.every * 1000), () => this.read());
      } catch (e) {
        if (this.stopped) return;
        if (e instanceof YtError && /liveChatEnded|liveChatNotFound|liveChatDisabled|notFound/.test(e.reason)) { this.ended(); return; }
        const wait = this.trouble(e);
        if (wait != null) this.later('read', wait, () => this.read());
      }
    }
    profileUrl(login) { return 'https://www.youtube.com/@' + encodeURIComponent(login); }
  }

  /* ---------- TikTok: Euler Stream's free plan with the streamer's own key. Unofficial. ---------- */

  // Field names differ a little between their message versions, so both are read.
  function tiktokMessage(d) {
    const u = d.user || {}, who = d.userIdentity || {}, login = String(u.uniqueId || u.displayId || ''), roles = [];
    if (who.isAnchor) roles.push('broadcaster');
    if (who.isModeratorOfAnchor) roles.push('moderator');
    const c = d.common || d.event || {}, t = Number(c.createTime || 0);
    return { id: String(c.msgId || ''), at: t > 1e12 ? t : Date.now(), userId: String(u.userId || u.id || login), login: login.toLowerCase(), name: String(u.nickname || login || '?'), roles, parts: [{ text: String(d.comment || d.content || '') }] };
  }
  const tiktokViewers = (d) => { const n = Number(d.viewerCount != null ? d.viewerCount : d.total); return Number.isFinite(n) ? n : null; };
  class TikTokAccount extends Base {
    constructor(cfg, emit, key) { super(cfg, emit); this.key = key; this.readOnly = 'TikTok is read-only in this dock'; }
    start() { this.emit('status', this); this.open(); }
    open() {
      if (this.stopped) return;
      this.closeSocket();
      const ws = this.ws = new WebSocket('wss://ws.eulerstream.com?' + new URLSearchParams({ uniqueId: this.cfg.channel, apiKey: this.key, 'features.schemaVersion': 'v2' }));
      ws.onmessage = (e) => {
        if (ws !== this.ws) return;
        let j;
        try { j = JSON.parse(e.data); } catch { return; }
        this.backoff = 2000;
        // A LIVE sends something every few seconds, so a long silence means the line is dead.
        this.later('alive', 120000, () => { this.closeSocket(); this.closed(0); });
        if (this.status !== 'ok' || this.note !== 'Connected, read-only') this.setStatus('ok', 'Connected, read-only');
        for (const m of Array.isArray(j.messages) ? j.messages : [j]) {
          const d = m.data || {};
          if (m.type === 'WebcastChatMessage') { const x = tiktokMessage(d); if (x.parts[0].text && (!x.id || this.once(x.id))) this.message(x); } else if (m.type === 'WebcastRoomUserSeqMessage') this.setViewers(tiktokViewers(d));
        }
      };
      ws.onclose = (e) => { if (ws === this.ws) { this.closeSocket(); this.closed(e.code); } };
    }
    closed(code) {
      if (this.stopped) return;
      this.setViewers(null);
      const wait = (status, note, ms) => { this.setStatus(status, note); if (ms) this.later('retry', ms, () => this.open()); };
      // Each try counts toward the free daily limit, so waiting for a LIVE is slow on purpose.
      if (code === 4404 || code === 4005) wait('ok', 'Not live. Checks every 3 minutes', 180000);
      else if (code === 4401) wait('error', 'Euler Stream did not accept the key');
      else if (code === 4403) wait('error', 'This key is not allowed to read this account');
      else if (code === 4400) wait('error', 'TikTok has no account with this name');
      else if (code === 4429) wait('error', 'Too many connections for the free plan. Tries again in 10 minutes', 600000);
      else wait('reconnecting', 'Reconnecting', Math.max(10000, this.nextDelay()));
    }
    profileUrl(login) { return 'https://www.tiktok.com/@' + encodeURIComponent(login); }
  }

  /* ---------- the list of platforms ---------- */

  // kind: signin, key, open (no sign-in needed) or link (opens the page, no chat).
  const INFO = {
    twitch: { kind: 'signin', name: 'Twitch', note: 'Chat, viewers and moderation' },
    youtube: { kind: 'key', name: 'YouTube', note: 'Chat and viewers, read-only. Needs your free key', ask: 'Channel @handle, channel ID or stream link', key: 'YouTube API key', get: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', how: 'Make a free key in Google Cloud with YouTube Data API v3 turned on.' },
    kick: { kind: 'open', name: 'Kick', note: 'Chat and viewers, read-only. No sign-in', ask: 'Kick channel name' },
    tiktok: { kind: 'key', name: 'TikTok', note: 'Chat and viewers, read-only. Needs your free key', ask: 'TikTok username', key: 'Euler Stream API key', get: 'https://www.eulerstream.com', how: 'Make a free key at Euler Stream. It is an unofficial service.' },
    instagram: { kind: 'link', name: 'Instagram', note: 'Link only. Instagram sends live chat only to approved servers', url: 'https://www.instagram.com/' },
    facebook: { kind: 'link', name: 'Facebook', note: 'Link only. Facebook needs an app approved by Meta', url: 'https://www.facebook.com/' },
    rumble: { kind: 'link', name: 'Rumble', note: 'Link only. Rumble does not let OBS docks read its chat', url: 'https://rumble.com/c/' },
    trovo: { kind: 'link', name: 'Trovo', note: 'Link only for now', url: 'https://trovo.live/s/' },
    x: { kind: 'link', name: 'X', note: 'Link only for now', url: 'https://x.com/' },
    other: { kind: 'link', name: 'Other', note: 'Any page, such as a pop-out chat', url: '' },
  };
  function linkUrl(platform, text) {
    const t = String(text || '').trim();
    if (/^https:\/\/\S+$/i.test(t)) return t;
    const h = handle(t);
    return INFO[platform].url && /^[\w.-]{1,60}$/.test(h) ? INFO[platform].url + h : null;
  }
  // Checks what was typed. Returns the value to keep, or null.
  function clean(platform, text) {
    if (INFO[platform].kind === 'link') return linkUrl(platform, text);
    if (platform === 'youtube') { const t = youtubeTarget(text); return t && (t.video ? 'https://youtu.be/' + t.video : t.channel || t.handle); }
    const h = handle(text);
    return (platform === 'kick' ? /^[\w-]{1,40}$/ : /^[\w.]{1,40}$/).test(h) ? h : null;
  }
  // Stands in for an account that cannot connect yet, or has no chat.
  class StillAccount {
    constructor(cfg, status, note) {
      Object.assign(this, { id: cfg.id, platform: cfg.platform, cfg, status, note, viewers: null, name: cfg.channel || INFO[cfg.platform].name });
      if (INFO[cfg.platform].kind === 'link') { this.link = cfg.channel; this.name = INFO[cfg.platform].name; }
    }
    start() {}
    stop() {}
  }

  MCH.platforms = { INFO, KickAccount, YouTubeAccount, TikTokAccount, StillAccount, handle, youtubeTarget, kickMessage, youtubeMessage, tiktokMessage, tiktokViewers, youtubeHours, linkUrl, clean };
})();
