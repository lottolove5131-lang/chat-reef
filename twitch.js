(function (root) {
  'use strict';
  function unescapeTag(value) {
    return value.replace(/\\([s:nr\\]|.)/g, function (_, char) {
      return ({ s: ' ', ':': ';', n: '\n', r: '\r', '\\': '\\' })[char] || char;
    }).replace(/\\$/, '');
  }
  function parseTags(raw) {
    var tags = Object.create(null);
    if (!raw) return tags;
    raw.split(';').forEach(function (entry) {
      var eq = entry.indexOf('=');
      var key = eq < 0 ? entry : entry.slice(0, eq);
      if (key) tags[key] = eq < 0 ? '' : unescapeTag(entry.slice(eq + 1));
    });
    return tags;
  }
  function parseLine(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    var rest = raw.replace(/[\r\n]+$/, '');
    var tags = Object.create(null), prefix = '', index;
    if (rest[0] === '@') {
      index = rest.indexOf(' ');
      if (index < 0) return null;
      tags = parseTags(rest.slice(1, index));
      rest = rest.slice(index + 1).trimStart();
    }
    if (rest[0] === ':') {
      index = rest.indexOf(' ');
      if (index < 0) return null;
      prefix = rest.slice(1, index);
      rest = rest.slice(index + 1).trimStart();
    }
    var trailing = '', trailingIndex = rest.indexOf(' :');
    if (trailingIndex >= 0) {
      trailing = rest.slice(trailingIndex + 2);
      rest = rest.slice(0, trailingIndex);
    }
    var parts = rest.split(/ +/), command = parts.shift().toUpperCase();
    if (!command) return null;
    return { tags: tags, prefix: prefix, command: command, params: parts, trailing: trailing };
  }
  function parseEmotes(raw) {
    if (!raw) return [];
    return raw.split('/').map(function (group) {
      var pair = group.split(':');
      return { id: pair[0], ranges: (pair[1] || '').split(',').map(function (range) {
        var bounds = range.split('-');
        return { start: Number(bounds[0]), end: Number(bounds[1]) };
      }).filter(function (range) { return Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end >= range.start; }) };
    }).filter(function (emote) { return emote.id && emote.ranges.length; });
  }
  function toEvent(line) {
    if (!line) return null;
    var tags = line.tags, login = line.prefix.split('!')[0];
    var base = {
      channel: (line.params[0] || '').replace(/^#/, ''),
      userId: tags['user-id'] || login,
      username: tags['display-name'] || tags.login || login,
      color: /^#[0-9a-f]{6}$/i.test(tags.color || '') ? tags.color : '',
      badges: (tags.badges || '').split(',').filter(Boolean).map(function (badge) {
        var pair = badge.split('/'); return { name: pair[0], version: pair[1] || '' };
      }),
      emotes: parseEmotes(tags.emotes), text: line.trailing, tags: tags
    };
    base.emoteCount = base.emotes.reduce(function (sum, emote) { return sum + emote.ranges.length; }, 0);
    if (line.command === 'PRIVMSG') return Object.assign(base, { type: 'message' });
    if (line.command === 'USERNOTICE') {
      var notice = tags['msg-id'];
      var type = ({ sub: 'sub', resub: 'resub', subgift: 'gift', anonsubgift: 'gift', submysterygift: 'gift', anonsubmysterygift: 'gift', raid: 'raid' })[notice];
      if (!type) return null;
      return Object.assign(base, {
        type: type, noticeId: notice,
        userId: tags['user-id'] || tags.login || tags['msg-param-login'] || '',
        username: tags['display-name'] || tags['msg-param-displayName'] || tags.login || 'A visitor',
        count: Math.max(0, parseInt(tags[type === 'raid' ? 'msg-param-viewerCount' : 'msg-param-mass-gift-count'], 10) || (type === 'raid' ? 0 : 1)),
        recipientId: tags['msg-param-recipient-id'] || '',
        recipientName: tags['msg-param-recipient-display-name'] || ''
      });
    }
    if (line.command === 'CLEARCHAT') return { type: 'clear', channel: base.channel, userId: tags['target-user-id'] || '', username: line.trailing, all: !tags['target-user-id'] && !line.trailing };
    return null;
  }
  function normalizeChannel(value) { return String(value || '').trim().replace(/^#/, '').toLowerCase(); }
  function validChannel(value) { return /^[a-z0-9_]{1,25}$/.test(value); }
  function TwitchClient(channel, onEvent, onStatus, options) {
    this.channel = normalizeChannel(channel);
    if (!validChannel(this.channel)) throw new Error('Use a Twitch channel name containing only letters, numbers, or underscores.');
    this.onEvent = onEvent || function () {};
    this.onStatus = onStatus || function () {};
    this.WebSocket = (options || {}).WebSocket || root.WebSocket;
    this.attempt = 0;
    this.stopped = true;
    this.timer = null;
    this.socket = null;
    this.buffer = '';
  }
  TwitchClient.prototype.start = function () {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  };
  TwitchClient.prototype.connect = function () {
    var self = this;
    if (self.stopped) return;
    self.onStatus('connecting', 'Connecting to #' + self.channel + '…');
    var socket;
    try { socket = new self.WebSocket('wss://irc-ws.chat.twitch.tv:443'); }
    catch (_) { self.scheduleReconnect(); return; }
    self.socket = socket;
    self.buffer = '';
    socket.onopen = function () {
      if (self.stopped || self.socket !== socket) return;
      ['CAP REQ :twitch.tv/tags twitch.tv/commands', 'PASS SCHMOOPIIE', 'NICK justinfan' + Math.floor(10000 + Math.random() * 900000000), 'JOIN #' + self.channel].forEach(function (command) { socket.send(command); });
    };
    socket.onmessage = function (message) {
      if (self.stopped || self.socket !== socket || typeof message.data !== 'string') return;
      self.buffer += message.data;
      var lines = self.buffer.split('\r\n');
      self.buffer = lines.pop();
      if (self.buffer.length > 65536) { self.buffer = ''; socket.close(); return; }
      lines.forEach(function (raw) {
        var line = parseLine(raw);
        if (!line) return;
        if (line.command === 'PING') { socket.send('PONG :' + (line.trailing || line.params[0] || 'tmi.twitch.tv') + '\r\n'); return; }
        if (line.command === 'RECONNECT') { socket.close(); return; }
        if (line.command === 'ROOMSTATE' || (line.command === 'JOIN' && line.params[0] === '#' + self.channel)) {
          self.attempt = 0;
          self.onStatus('connected', 'Listening to #' + self.channel);
        }
        if (line.command === 'NOTICE' && /msg_channel_suspended|msg_room_not_found|msg_banned/.test(line.tags['msg-id'] || '')) {
          self.stop(); self.onStatus('error', 'Channel unavailable. Check the channel name.'); return;
        }
        var event = toEvent(line);
        if (event && event.channel === self.channel) self.onEvent(event);
      });
    };
    socket.onerror = function () { if (self.socket === socket) socket.close(); };
    socket.onclose = function () {
      if (self.socket !== socket || self.stopped) return;
      self.socket = null;
      self.scheduleReconnect();
    };
  };
  TwitchClient.prototype.scheduleReconnect = function () {
    if (this.stopped) return;
    clearTimeout(this.timer);
    var self = this, delay = Math.min(60000, 1000 * Math.pow(2, Math.min(this.attempt++, 6))) + Math.random() * 750;
    self.onStatus('reconnecting', 'Current interrupted · reconnecting in ' + Math.ceil(delay / 1000) + 's');
    self.timer = setTimeout(function () { self.connect(); }, delay);
  };
  TwitchClient.prototype.stop = function () {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.socket) { var socket = this.socket; this.socket = null; socket.close(); }
  };
  var api = { parseLine: parseLine, parseTags: parseTags, parseEmotes: parseEmotes, toEvent: toEvent, normalizeChannel: normalizeChannel, validChannel: validChannel, TwitchClient: TwitchClient };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChatReefIRC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
