(function () {
  'use strict';
  // Made-up chat for trying the dock without signing in. Never moderates anyone.
  const people = [
    ['1', 'NovaPixel', '#FF4D6D', []],
    ['2', 'quietlurker', '#0000FF', []],
    ['3', 'ModMaple', '#2ECC71', ['moderator']],
    ['4', 'VioletVIP', '', ['vip']],
    ['5', 'rude_dude_77', '#8A2BE2', []],
  ];
  const lines = [
    'hello from the demo',
    'that was a great play',
    'what game is next?',
    'lol',
    'this is a much longer message so you can see how a wrapped line looks in a narrow dock',
    'good evening everyone',
  ];
  MCH.DemoAccount = class {
    constructor(emit, platform) {
      const tiktok = platform === 'tiktok';
      Object.assign(this, { platform: platform || 'twitch', emit, name: tiktok ? 'DemoTikTok' : 'DemoChannel', status: 'ok', note: 'Demo: made-up chat', viewers: tiktok ? 118 : 42, n: 0, demo: true });
      if (tiktok) this.readOnly = 'TikTok is read-only in this dock';
    }
    start() {
      this.emit('status', this);
      for (let i = 0; i < 12; i++) this.one();
      this.t = setInterval(() => this.one(), this.readOnly ? 2300 : 1500);
    }
    stop() { clearInterval(this.t); }
    one() {
      const p = people[this.n % people.length];
      const text = lines[(this.n * 7 + Math.floor(this.n / 3)) % lines.length];
      const parts = !this.readOnly && this.n % 6 === 2 ? [{ text: text + ' ' }, { emote: '25', text: 'Kappa' }] : [{ text }];
      this.emit('message', { account: this, id: this.platform + this.n++, at: new Date(), userId: p[0], login: p[1].toLowerCase(), name: p[1], color: this.readOnly ? '' : p[2], roles: p[3], parts });
    }
    profileUrl(login) { return (this.readOnly ? 'https://www.tiktok.com/@' : 'https://www.twitch.tv/') + encodeURIComponent(login); }
    async ban(userId) { this.emit('remove', { account: this, userId }); }
    async unban() { /* nothing to undo in the demo */ }
    // Moderator page: kept in memory only, so nothing reaches Twitch.
    can() { return true; }
    async chatSettings() { return Object.assign({}, this.chat); }
    async setChatSettings(patch) { this.chat = Object.assign({}, this.chat, patch); }
    async clearChat() { this.emit('remove', { account: this, all: true }); }
    async shield() { return !!this.shieldOn; }
    async setShield(on) { this.shieldOn = on; }
    async channelInfo() { return Object.assign({ title: 'Demo stream', game_name: 'Just Chatting', tags: ['English'] }, this.info); }
    async setChannelInfo(body) { this.info = Object.assign({}, this.info, body); }
    async findCategory(name) { return { id: '1', name }; }
    async findUser(login) { return { id: '99', display_name: login }; }
    async raid() {}
    async cancelRaid() {}
    async clip() { return {}; }
    async marker() {}
    async announce() {}
    async shoutout() {}
    async commercial() {}
    async snoozeAd() {}
    async polls() { return this.poll ? [this.poll] : []; }
    async startPoll(title, choices) { this.poll = { id: '1', status: 'ACTIVE', title, choices: choices.map((t) => ({ title: t, votes: 3 })) }; }
    async endPoll() { this.poll = null; }
    async predictions() { return this.guess ? [this.guess] : []; }
    async startPrediction(title, outs) { this.guess = { id: '1', status: 'ACTIVE', title, outcomes: outs.map((t, i) => ({ id: 'o' + i, title: t })) }; }
    async endPrediction(id, status) { if (status === 'LOCKED') this.guess.status = status; else this.guess = null; }
    async automod() { return { overall_level: this.level || 0 }; }
    async setAutomod(level) { this.level = level; }
    async blockedTerms() { return this.terms || (this.terms = []); }
    async blockTerm(text) { this.terms.push({ id: 't' + this.n++, text }); }
    async unblockTerm(id) { this.terms = this.terms.filter((t) => t.id !== id); }
    async unbanRequests() { return this.asked ? [] : [{ id: '1', user_name: 'SorryViewer', text: 'sorry, can I come back?' }]; }
    async resolveUnban() { this.asked = true; }
    async warn() {}
    async suspicious() {}
    async addMod() {}
    async removeMod() {}
    async addVip() {}
    async removeVip() {}
    async goals() { return [{ type: 'follower', description: '', current_amount: 42, target_amount: 100 }]; }
    async deleteMessage(id) { this.emit('remove', { account: this, id }); }
  };
})();
