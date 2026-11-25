(function () {
  'use strict';
  // Talks to OBS on this PC through its built-in WebSocket server. It never asks
  // OBS for stream settings, so stream keys are never read.
  const SUITE = 'aitum-stream-suite';
  const EVENTS = 1 | 64 | 512; // general, outputs, vendors

  async function sha(text) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    return btoa(String.fromCharCode(...d));
  }
  const authString = async (password, salt, challenge) => sha(await sha(password + salt) + challenge);

  class ObsError extends Error { constructor(code, msg) { super(msg || 'OBS refused (' + code + ')'); this.code = code; } }

  class ObsClient {
    constructor(port, password, onState, onEvent) {
      Object.assign(this, { port, password, onState, onEvent, state: 'connecting', note: 'Connecting to OBS', next: 1, wait: new Map(), backoff: 1000, stopped: false, missed: 0 });
    }
    set(state, note) { this.state = state; this.note = note; this.onState(); }
    start() {
      if (this.stopped) return;
      const ws = this.ws = new WebSocket('ws://127.0.0.1:' + this.port);
      ws.onmessage = async (ev) => {
        if (ws !== this.ws) return;
        this.missed = 0;
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        const d = m.d || {};
        if (m.op === 0) {
          const id = { rpcVersion: 1, eventSubscriptions: EVENTS };
          if (d.authentication) id.authentication = await authString(this.password || '', d.authentication.salt, d.authentication.challenge);
          if (ws === this.ws && ws.readyState === 1) ws.send(JSON.stringify({ op: 1, d: id }));
        } else if (m.op === 2) {
          this.backoff = 1000;
          this.reached = true;
          this.set('ok', 'Connected to OBS');
        } else if (m.op === 5) {
          this.onEvent(d);
        } else if (m.op === 7) {
          const w = this.wait.get(d.requestId);
          if (!w) return;
          this.wait.delete(d.requestId);
          clearTimeout(w.timer);
          if (d.requestStatus && d.requestStatus.result) w.res(d.responseData || {});
          else w.rej(new ObsError(d.requestStatus && d.requestStatus.code, d.requestStatus && d.requestStatus.comment));
        }
      };
      ws.onclose = (ev) => {
        if (ws !== this.ws) return;
        this.ws = null;
        this.missed = 0;
        this.failAll();
        if (this.stopped) return;
        if (ev.code === 4009) { this.set('error', 'OBS did not accept that WebSocket password'); return; }
        this.set('reconnecting', this.reached ? 'Lost the connection to OBS, retrying' : 'Cannot reach OBS WebSocket, retrying');
        this.timer = setTimeout(() => this.start(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 15000);
      };
    }
    failAll() {
      for (const w of this.wait.values()) { clearTimeout(w.timer); w.rej(new Error('Lost the connection to OBS')); }
      this.wait.clear();
    }
    stop() {
      this.stopped = true;
      clearTimeout(this.timer);
      const ws = this.ws;
      this.ws = null;
      if (ws) ws.close();
      this.failAll();
    }
    request(requestType, requestData) {
      if (this.state !== 'ok' || !this.ws) return Promise.reject(new Error('OBS is not connected'));
      const requestId = String(this.next++);
      return new Promise((res, rej) => {
        const ws = this.ws, timer = setTimeout(() => {
          this.wait.delete(requestId);
          rej(new Error('OBS did not answer'));
          // Two silent requests in a row: the line is dead even if nothing said so.
          if (ws === this.ws && ws && ++this.missed >= 2) { ws.onclose({ code: 0 }); ws.close(); }
        }, 8000);
        this.wait.set(requestId, { res, rej, timer });
        this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData: requestData || {} } }));
      });
    }
  }

  // Made-up OBS for demo mode. Nothing here can go live.
  class DemoObs {
    constructor(onState, onEvent) {
      Object.assign(this, { onState, onEvent, state: 'ok', note: 'Demo: nothing really goes live', demo: true, t: {} });
      this.suite = [['Record Output', 'record'], ['Backtrack Output', 'backtrack'], ['YouTube Output', 'stream'], ['Instagram', 'stream'], ['TikTok Output', 'stream'], ['Virtual Camera2', 'virtual_cam']];
    }
    start() { this.onState(); }
    stop() { this.t = {}; }
    async request(type, data) {
      const on = (k, v) => { if (v) this.t[k] = this.t[k] || Date.now(); else delete this.t[k]; setTimeout(() => this.onEvent({}), 50); return {}; };
      const st = (k) => ({ outputActive: !!this.t[k], outputDuration: this.t[k] ? Date.now() - this.t[k] : 0 });
      switch (type) {
        case 'GetStreamStatus': return st('stream');
        case 'GetRecordStatus': return Object.assign(st('record'), { outputPaused: !!this.paused });
        case 'GetReplayBufferStatus': return st('replay');
        case 'GetVirtualCamStatus': return st('vcam');
        case 'StartStream': return on('stream', true);
        case 'StopStream': return on('stream', false);
        case 'StartRecord': return on('record', true);
        case 'StopRecord': this.paused = false; return on('record', false);
        case 'ToggleRecordPause': this.paused = !this.paused; return {};
        case 'StartReplayBuffer': return on('replay', true);
        case 'StopReplayBuffer': return on('replay', false);
        case 'StartVirtualCam': return on('vcam', true);
        case 'StopVirtualCam': return on('vcam', false);
        case 'CallVendorRequest': {
          const out = data.requestData && data.requestData.output;
          if (data.requestType === 'start_output') on('s:' + out, true);
          if (data.requestType === 'stop_output') on('s:' + out, false);
          return { responseData: { success: true, outputs: this.suite.map(([name, kind]) => ({ name, type: kind, active: !!this.t['s:' + name] })) } };
        }
        default: return {};
      }
    }
  }

  const KINDS = { stream: 'Streams', record: 'Recording', backtrack: 'Backtrack', virtual_cam: 'Virtual cameras' };
  const BUILTIN = {
    stream: { name: 'Main stream', status: 'GetStreamStatus', start: 'StartStream', stop: 'StopStream' },
    record: { name: 'Main recording', status: 'GetRecordStatus', start: 'StartRecord', stop: 'StopRecord' },
    backtrack: { name: 'Main backtrack', status: 'GetReplayBufferStatus', start: 'StartReplayBuffer', stop: 'StopReplayBuffer', off: 'Turn on Replay Buffer in OBS Settings > Output' },
    virtual_cam: { name: 'Main virtual camera', status: 'GetVirtualCamStatus', start: 'StartVirtualCam', stop: 'StopVirtualCam', off: 'Virtual camera is not available in OBS' },
  };

  // Which platform an output's name points at, for its icon.
  function platformOf(name) {
    const m = /twitch|tik ?tok|youtube|instagram|facebook|kick|trovo|\bx\b|twitter/i.exec(name || '');
    if (!m) return '';
    const k = m[0].toLowerCase().replace(' ', '');
    return k === 'twitter' ? 'x' : k;
  }

  function buildList(main, suite) {
    const list = [];
    for (const kind of Object.keys(KINDS)) {
      const b = BUILTIN[kind], s = main[kind];
      const own = suite.filter((o) => (o.type || 'stream') === kind);
      // Every virtual camera output shares the one OBS virtual camera.
      const ownOn = kind === 'virtual_cam' && own.some((o) => o.active);
      list.push({ id: 'main:' + kind, kind, main: true, name: b.name, active: !!(s && s.outputActive) && !ownOn, ms: s && s.outputActive ? s.outputDuration || 0 : 0,
        reconnecting: !!(s && s.outputReconnecting), paused: !!(s && s.outputPaused), off: s ? '' : b.off || 'OBS did not report this output' });
      for (const o of own) list.push({ id: 'suite:' + o.name, kind, main: false, name: o.name, active: !!o.active, ms: 0, off: '' });
    }
    const cams = list.filter((o) => o.kind === 'virtual_cam');
    if (cams.some((o) => o.active)) for (const c of cams) if (!c.active) c.off = 'Only one virtual camera can run at a time';
    return list;
  }

  // Main stream first, because other outputs can depend on its encoder.
  const startOrder = (list) => [...list].sort((a, b) => (b.id === 'main:stream') - (a.id === 'main:stream'));
  const stopOrder = (list) => startOrder(list).reverse();

  class Outputs {
    constructor(client) { this.client = client; this.list = []; this.since = new Map(); this.hasSuite = null; this.main = {}; }
    call(type, data) { return this.client.request(type, data); }
    async vendor(requestType, requestData) {
      const r = await this.call('CallVendorRequest', { vendorName: SUITE, requestType, requestData: requestData || {} });
      const d = r.responseData || {};
      if (d.success === false) throw new Error(d.error || 'Aitum refused');
      return d;
    }
    async refresh() {
      const kinds = Object.keys(BUILTIN);
      const got = await Promise.all(kinds.map((k) => this.call(BUILTIN[k].status).catch((e) => (e instanceof ObsError ? null : e))));
      if (got.some((g) => g instanceof Error)) return false; // connection trouble: keep the last list
      kinds.forEach((k, i) => { this.main[k] = got[i]; });
      let suite = [];
      try {
        suite = (await this.vendor('get_outputs')).outputs || [];
        this.hasSuite = true;
      } catch (e) {
        if (!(e instanceof ObsError)) return false;
        this.hasSuite = false;
      }
      this.list = buildList(this.main, suite.filter((o) => o && typeof o.name === 'string'));
      for (const o of this.list) {
        if (o.main) continue;
        // Aitum does not report a running time, so count from when the dock first saw it.
        if (!o.active) this.since.delete(o.id);
        else if (!this.since.has(o.id)) this.since.set(o.id, Date.now());
        o.ms = o.active ? Date.now() - this.since.get(o.id) : 0;
      }
      return true;
    }
    find(id) { return this.list.find((o) => o.id === id); }
    start(o) { return o.main ? this.call(BUILTIN[o.kind].start) : this.vendor('start_output', { output: o.name }); }
    stop(o) { return o.main ? this.call(BUILTIN[o.kind].stop) : this.vendor('stop_output', { output: o.name }); }
    saveClip(o) { return o.main ? this.call('SaveReplayBuffer') : this.vendor('save_backtrack', { output: o.name }); }
    pause() { return this.call('ToggleRecordPause'); }
    chapter(o) { return o.main ? this.call('CreateRecordChapter') : this.vendor('add_chapter', { output: o.name }); }
    split(o) { return o.main ? this.call('SplitRecordFile') : this.call('TriggerHotkeyByName', { hotkeyName: 'AitumStreamSuiteSplit' + o.name }); }
    // Sends the command, then waits until OBS really reports the change.
    async drive(o, want, ms) {
      if (want) await this.start(o); else await this.stop(o);
      const until = Date.now() + (ms || 20000);
      while (Date.now() < until) {
        await MCH.sleep(700);
        const ok = await this.refresh();
        const now = this.find(o.id);
        if (ok && now && now.active === want) return true;
        if (this.client.state !== 'ok') throw new Error('Lost the connection to OBS');
      }
      throw new Error(want ? 'it did not start. Check OBS for a message' : 'it is still running. Check OBS');
    }
  }

  MCH.obs = { authString, ObsClient, ObsError, DemoObs, Outputs, KINDS, platformOf, buildList, startOrder, stopOrder };
})();
