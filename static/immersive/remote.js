/* Relay the existing immersive messages across devices. No climate data here. */
(function () {
  'use strict';
  var API = '/api/immersive/remote';
  var isWall = !/\/immersive\/control\/?$/.test(location.pathname);
  var role = isWall ? 'wall' : 'controller';
  var KEY = 'climascope-phone-remote-' + role;

  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function nonce() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }
  function save(value) {
    try {
      if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
      else sessionStorage.removeItem(KEY);
    } catch (_) { /* Pairing still works without browser storage. */ }
  }
  function restore() {
    try {
      var v = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      return v && typeof v.room === 'string' && typeof v.token === 'string' ? v : null;
    } catch (_) { return null; }
  }

  function RemoteChannel(name) {
    this.name = name;
    this.onmessage = null;
    this.session = restore();
    this.cursor = this.session ? this.session.cursor || 0 : 0;
    this.local = null;
    this.timer = null;
    this.busy = false;
    this.generation = 0;
    this.closed = false;
    this.peerOnline = false;
    this.lastReport = null;
    this.queue = [];
    this.sending = false;
    this.status = null;
    this.buildUI();
    if (this.session) {
      this.showSession();
      this.poll();
    } else if (isWall) {
      this.useLocal();
    } else {
      this.lockControls(true);
      this.say('Enter the connection code from the immersive wall.');
    }
    var self = this;
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && self.session && !self.busy) {
        clearTimeout(self.timer);
        self.poll();
      }
    });
  }

  RemoteChannel.prototype.say = function (message, kind) {
    this.status.textContent = message;
    this.status.dataset.kind = kind || '';
  };
  RemoteChannel.prototype.emit = function (message) {
    if (this.closed) return;
    if (this.onmessage) this.onmessage({ data: message });
  };
  RemoteChannel.prototype.lockControls = function (locked) {
    if (isWall) return;
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el.id !== 'phone-remote' && el.tagName !== 'SCRIPT' && !el.classList.contains('page-title')) {
        el.inert = locked;
        el.classList.toggle('remote-locked', locked);
      }
    });
  };
  RemoteChannel.prototype.useLocal = function () {
    var self = this;
    if (!this.local && window.BroadcastChannel) {
      this.local = new BroadcastChannel(this.name);
      this.local.onmessage = function (ev) { self.emit(ev.data); };
    }
    this.lockControls(false);
    if (!isWall) this.say('Local control: this browser only. Connect a code for phone control.');
    if (this.local) this.local.postMessage({ type: 'hello' });
  };
  RemoteChannel.prototype.stopLocal = function () {
    if (this.local) this.local.close();
    this.local = null;
  };

  RemoteChannel.prototype.request = async function (path, body, authenticate) {
    var options = { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers: {} };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    if (authenticate !== false && this.session) options.headers.Authorization = 'Bearer ' + this.session.token;
    var abort = new AbortController();
    options.signal = abort.signal;
    var timer = setTimeout(function () { abort.abort(); }, 7000);
    try {
      var response = await fetch(API + path, options);
      var data = await response.json();
      if (!response.ok) {
        var error = new Error(data.error || 'Remote connection failed.');
        error.status = response.status;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  };
  RemoteChannel.prototype.path = function (suffix) {
    return '/rooms/' + encodeURIComponent(this.session.room) + suffix;
  };
  RemoteChannel.prototype.setSession = function (data) {
    clearTimeout(this.timer);
    this.generation++;
    this.stopLocal();
    this.queue = [];
    this.cursor = 0;
    this.session = { room: data.room, token: data.token, cursor: 0, code: data.code || null, code_expires: data.code_expires || 0 };
    save(this.session);
    this.showSession();
    this.poll();
  };
  RemoteChannel.prototype.showSession = function () {
    document.body.classList.add('remote-server-mode');
    if (isWall) {
      this.code.textContent = this.session.code ? this.formatCode(this.session.code) : 'Phone remote';
      this.panel.hidden = false;
    } else {
      this.form.hidden = true;
      this.disconnect.hidden = false;
      this.lockControls(false);
    }
    this.say('Connecting to wall session…');
  };
  RemoteChannel.prototype.formatCode = function (code) { return code.slice(0, 4) + ' ' + code.slice(4); };
  RemoteChannel.prototype.forget = function (message) {
    this.generation++;
    this.session = null;
    this.cursor = 0;
    this.queue = [];
    this.peerOnline = false;
    save(null);
    clearTimeout(this.timer);
    document.body.classList.remove('remote-server-mode');
    if (isWall) {
      this.panel.hidden = true;
      this.useLocal();
    } else {
      this.form.hidden = false;
      this.disconnect.hidden = true;
      this.lockControls(true);
    }
    this.say(message || 'Connect to the wall again.');
  };

  RemoteChannel.prototype.poll = async function () {
    if (!this.session || this.busy || this.closed) return;
    this.busy = true;
    var generation = this.generation, delay = 500;
    try {
      var data = await this.request(this.path('/messages?after=' + this.cursor));
      if (generation !== this.generation) return;
      this.peerOnline = data.peer_online;
      this.say(isWall ? (data.peer_online ? 'Phone connected' : 'Waiting for phone') :
        (data.peer_online ? 'Wall connected' : 'Wall offline — waiting for connection'), data.peer_online ? 'online' : 'waiting');
      if (isWall && data.paired && !data.pair_available) {
        this.code.textContent = 'Phone paired';
        this.help.textContent = 'Use “New code” to connect a different controller.';
      } else if (isWall && this.session.code_expires < Date.now() / 1000) {
        this.code.textContent = 'Code expired';
        this.help.textContent = 'Select “New code” to connect your phone.';
      }
      for (var i = 0; i < data.messages.length; i++) {
        // The snapshot supersedes any older renderer reports in the inbox.
        if (data.report && data.messages[i].type === 'wall') continue;
        this.emit(data.messages[i]);
      }
      if (!isWall && data.peer_online && data.report) {
        this.showReport(data.report);
        this.emit(data.report);
      }
      this.cursor = data.cursor;
      this.session.cursor = this.cursor;
      save(this.session);
    } catch (error) {
      if (generation !== this.generation) return;
      this.peerOnline = false;
      delay = 2000;
      if (error.status === 403 || error.status === 410) this.forget(error.message);
      else this.say('Connection interrupted; reconnecting…', 'error');
    } finally {
      this.busy = false;
      if (this.session && !this.closed) {
        var self = this;
        this.timer = setTimeout(function () { self.poll(); }, delay);
      }
    }
  };

  RemoteChannel.prototype.showReport = function (report) {
    // A renderer report, when provided by the wall, is stronger than a relay ACK.
    if (report.type !== 'wall') return;
    var months = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var selected = report.status === 'ready' && report.shown ? report.shown : report.state;
    var label = selected ? ' · ' + (months[selected.month] || '') + ' · ' +
      (typeof selected.region === 'string' ? selected.region : selected.region && selected.region.name || 'Scotland') : '';
    if (selected && selected.scene && window.ClimaScopeScenes) label += ' · ' + window.ClimaScopeScenes.get(selected.scene).title;
    this.say((report.status === 'ready' ? 'Displayed' : report.status === 'error' ? 'Wall error' : report.status === 'loading' ? 'Updating wall' : 'Wall connected') +
      label + (report.message ? ' · ' + report.message : ''), report.status === 'error' ? 'error' : 'online');
  };
  RemoteChannel.prototype.postMessage = function (message) {
    if (message && message.type === 'wall') this.lastReport = message;
    if (!this.session) {
      if (this.local) this.local.postMessage(message);
      return;
    }
    if (!isWall && !this.peerOnline) {
      if (message.type !== 'hello' && message.type !== 'ping') this.say('Wall not connected; selection was not sent.', 'error');
      return;
    }
    // Coalesce repeated renderer reports; commands retain their order.
    if (message.type === 'wall') this.queue = this.queue.filter(function (q) { return q.message.type !== 'wall'; });
    if (message.type === 'state') this.queue = this.queue.filter(function (q) { return q.message.type !== 'state'; });
    if (this.queue.length >= 30) { this.say('Remote is busy; wait for the current selection.', 'error'); return; }
    this.queue.push({ nonce: nonce(), message: message, created: Date.now() });
    this.flush();
  };
  RemoteChannel.prototype.flush = async function () {
    if (this.sending || !this.session || !this.queue.length) return;
    this.sending = true;
    var generation = this.generation;
    try {
      while (this.queue.length && this.session && generation === this.generation) {
        var item = this.queue.shift();
        if (item.created && Date.now() - item.created > 10000) continue;
        // A lost response is retried once with the SAME nonce, never a duplicate command.
        try { await this.request(this.path('/messages'), item); }
        catch (error) {
          if (!error.status && generation === this.generation) await this.request(this.path('/messages'), item);
          else throw error;
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.queue = [];
        this.say(error.message || 'Command not sent. Check the wall connection.', 'error');
        if (error.status === 403 || error.status === 410) this.forget(error.message);
      }
    } finally { this.sending = false; }
  };
  RemoteChannel.prototype.close = function () {
    this.closed = true;
    clearTimeout(this.timer);
    this.stopLocal();
  };

  RemoteChannel.prototype.buildUI = function () {
    var self = this;
    var root = node('section', 'phone-remote');
    root.id = 'phone-remote';
    root.setAttribute('aria-label', 'Connect phone remote');
    this.status = node('p', 'remote-status');
    this.status.setAttribute('role', 'status');
    if (isWall) {
      var open = node('button', 'remote-open', 'Phone remote');
      open.type = 'button';
      this.panel = node('div', 'remote-panel');
      this.panel.hidden = true;
      this.panel.appendChild(node('p', '', 'Open on your phone:'));
      this.panel.appendChild(node('p', 'remote-url', location.host + '/immersive/control'));
      this.code = node('p', 'remote-code');
      this.help = node('p', 'remote-help', 'Enter this code. It is valid for 10 minutes.');
      var refresh = node('button', '', 'New code');
      refresh.type = 'button';
      refresh.addEventListener('click', async function () {
        refresh.disabled = true;
        try {
          var data = await self.request(self.path('/code'), {});
          self.session.code = data.code;
          self.session.code_expires = data.code_expires;
          save(self.session);
          self.code.textContent = self.formatCode(data.code);
          self.help.textContent = 'Enter this code. Connecting replaces the previous controller.';
        } catch (error) { self.say(error.message, 'error'); }
        finally { refresh.disabled = false; }
      });
      var hide = node('button', '', 'Hide');
      hide.type = 'button';
      hide.addEventListener('click', function () { self.panel.hidden = true; });
      this.panel.appendChild(this.code);
      this.panel.appendChild(this.help);
      this.panel.appendChild(refresh);
      this.panel.appendChild(hide);
      this.panel.appendChild(this.status);
      open.addEventListener('click', async function () {
        if (self.session) { self.panel.hidden = !self.panel.hidden; return; }
        open.disabled = true;
        try {
          var data = await self.request('/rooms', {}, false);
          self.setSession(data);
          if (self.lastReport) self.postMessage(self.lastReport);
          self.emit({ type: 'hello' });
        } catch (error) { self.panel.hidden = false; self.say(error.message, 'error'); }
        finally { open.disabled = false; }
      });
      root.appendChild(open);
      root.appendChild(this.panel);
      document.body.appendChild(root);
    } else {
      root.appendChild(node('h2', '', 'Immersive wall remote'));
      this.form = node('form', 'remote-pair-form');
      var label = node('label', '', 'Wall connection code');
      var input = node('input', 'remote-code-input');
      input.id = 'remote-code';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.maxLength = 12;
      input.placeholder = 'ABCD 2345';
      input.required = true;
      input.setAttribute('autocapitalize', 'characters');
      label.htmlFor = input.id;
      var submit = node('button', '', 'Connect');
      submit.type = 'submit';
      var local = node('button', 'remote-local', 'Use this browser only');
      local.type = 'button';
      local.addEventListener('click', function () { self.useLocal(); });
      this.form.appendChild(label);
      this.form.appendChild(input);
      this.form.appendChild(submit);
      this.form.appendChild(local);
      this.form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        submit.disabled = true;
        self.say('Connecting…');
        try {
          var data = await self.request('/pair', { code: input.value }, false);
          self.setSession(data);
          input.value = '';
          if (data.report) { self.showReport(data.report); self.emit(data.report); }
          // The v4 wall responds with current state; the v3 wall safely ignores this.
          self.queue.push({ nonce: nonce(), message: { type: 'hello' } });
          self.flush();
        } catch (error) { self.say(error.message, 'error'); }
        finally { submit.disabled = false; }
      });
      this.disconnect = node('button', 'remote-disconnect', 'Connect to a different wall');
      this.disconnect.type = 'button';
      this.disconnect.hidden = true;
      this.disconnect.addEventListener('click', function () { self.forget(); });
      root.appendChild(this.form);
      root.appendChild(this.status);
      root.appendChild(this.disconnect);
      document.body.insertBefore(root, document.body.firstChild);
    }
  };

  window.ClimaScopeRemoteChannel = RemoteChannel;
})();
