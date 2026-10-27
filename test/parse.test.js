'use strict';
const assert = require('node:assert/strict');
const { parseLine, parseTags, parseEmotes, toEvent, normalizeChannel, validChannel, TwitchClient } = require('../twitch.js');
let passed = 0;
function test(name, run) { run(); passed++; process.stdout.write('PASS ' + name + '\n'); }
function event(raw) { return toEvent(parseLine(raw)); }

test('IRCv3 escaping, empty values, unknown escapes, equals and safe keys', () => {
  const tags = parseTags('display-name=Sea\\sOtter;note=a\\:b\\sc\\\\d\\r\\n;empty=;flag;unknown=\\q;equals=a=b;__proto__=safe;tail=end\\');
  assert.equal(tags['display-name'], 'Sea Otter');
  assert.equal(tags.note, 'a;b c\\d\r\n');
  assert.equal(tags.empty, ''); assert.equal(tags.flag, ''); assert.equal(tags.unknown, 'q');
  assert.equal(tags.equals, 'a=b'); assert.equal(tags.__proto__, 'safe'); assert.equal(tags.tail, 'end');
  assert.equal(Object.getPrototypeOf(tags), null);
});
test('PRIVMSG includes identity, badges, emotes and colon-containing text', () => {
  const parsed = event('@badges=subscriber/12,moderator/1;color=#80FFAA;display-name=Ocean;emotes=25:0-4,6-10/1902:12-16;user-id=42 :ocean!ocean@host PRIVMSG #reef :Kappa Kappa Keepo : hello\r\n');
  assert.equal(parsed.type, 'message'); assert.equal(parsed.userId, '42'); assert.equal(parsed.username, 'Ocean');
  assert.equal(parsed.channel, 'reef'); assert.equal(parsed.color, '#80FFAA'); assert.equal(parsed.emoteCount, 3);
  assert.deepEqual(parsed.badges, [{ name: 'subscriber', version: '12' }, { name: 'moderator', version: '1' }]);
  assert.deepEqual(parsed.emotes[0].ranges, [{ start: 0, end: 4 }, { start: 6, end: 10 }]);
  assert.equal(parsed.text, 'Kappa Kappa Keepo : hello');
});
test('plain PRIVMSG has login fallback and invalid colors are rejected', () => {
  const parsed = event(':guest!guest@host PRIVMSG #reef :hello');
  assert.equal(parsed.username, 'guest'); assert.equal(parsed.userId, 'guest'); assert.equal(parsed.emoteCount, 0);
  assert.equal(event('@color=red :guest!x PRIVMSG #reef :hello').color, '');
});
test('sub and resub notices work with or without a trailing message', () => {
  for (const kind of ['sub', 'resub']) {
    const parsed = event('@msg-id=' + kind + ';user-id=15;display-name=Pearl;login=pearl :tmi.twitch.tv USERNOTICE #reef' + (kind === 'resub' ? ' :another month!' : ''));
    assert.equal(parsed.type, kind); assert.equal(parsed.userId, '15'); assert.equal(parsed.username, 'Pearl');
    assert.equal(parsed.text, kind === 'resub' ? 'another month!' : '');
  }
});
test('gift subs preserve recipient and mass gift counts', () => {
  const gift = event('@msg-id=subgift;user-id=6;msg-param-recipient-id=7;msg-param-recipient-display-name=Kelp :tmi.twitch.tv USERNOTICE #reef');
  assert.equal(gift.type, 'gift'); assert.equal(gift.count, 1); assert.equal(gift.recipientId, '7'); assert.equal(gift.recipientName, 'Kelp');
  assert.equal(event('@msg-id=submysterygift;msg-param-mass-gift-count=12 :tmi.twitch.tv USERNOTICE #reef').count, 12);
  assert.equal(event('@msg-id=anonsubgift :tmi.twitch.tv USERNOTICE #reef').type, 'gift');
});
test('raid extracts viewer count and raid display name', () => {
  const raid = event('@msg-id=raid;msg-param-viewerCount=321;msg-param-displayName=Big\\sWave;msg-param-login=bigwave :tmi.twitch.tv USERNOTICE #reef');
  assert.equal(raid.type, 'raid'); assert.equal(raid.count, 321); assert.equal(raid.username, 'Big Wave'); assert.equal(raid.userId, 'bigwave');
  assert.equal(event('@msg-id=raid;msg-param-viewerCount=bad :tmi.twitch.tv USERNOTICE #reef').count, 0);
});
test('CLEARCHAT distinguishes target ban, timeout and full clear', () => {
  const ban = event('@target-user-id=42 :tmi.twitch.tv CLEARCHAT #reef :ocean');
  assert.equal(ban.userId, '42'); assert.equal(ban.all, false);
  const timeout = event('@ban-duration=600;target-user-id=5 :tmi.twitch.tv CLEARCHAT #reef :tide');
  assert.equal(timeout.type, 'clear'); assert.equal(timeout.userId, '5');
  assert.equal(event(':tmi.twitch.tv CLEARCHAT #reef').all, true);
});
test('PING, unknown notices and malformed input', () => {
  assert.equal(parseLine('PING :tmi.twitch.tv').trailing, 'tmi.twitch.tv');
  assert.equal(toEvent(parseLine('PING :tmi.twitch.tv')), null);
  assert.equal(event('@msg-id=unknown :tmi.twitch.tv USERNOTICE #reef'), null);
  for (const raw of ['', ' ', null, '@broken', ':broken']) assert.equal(parseLine(raw), null);
  assert.deepEqual(parseEmotes('25:bad/90:4-2/3:1-2'), [{ id: '3', ranges: [{ start: 1, end: 2 }] }]);
});
test('channel validation prevents IRC command injection', () => {
  assert.equal(normalizeChannel(' #Ocean_1 '), 'ocean_1'); assert.equal(validChannel('ocean_1'), true);
  assert.equal(validChannel('reef\r\nJOIN #other'), false);
  assert.throws(() => new TwitchClient('bad channel'), /channel name/);
});
test('WebSocket handshake, fragmented frames, PONG and stop', () => {
  let socket;
  class MockSocket {
    constructor(url) { this.url = url; this.sent = []; socket = this; }
    send(text) { this.sent.push(text); }
    close() { this.closed = true; if (this.onclose) this.onclose(); }
  }
  const received = [], statuses = [];
  const client = new TwitchClient('reef', e => received.push(e), state => statuses.push(state), { WebSocket: MockSocket });
  client.start(); socket.onopen();
  assert.equal(socket.url, 'wss://irc-ws.chat.twitch.tv:443');
  assert.deepEqual([socket.sent[0], socket.sent[1], socket.sent[3]], ['CAP REQ :twitch.tv/tags twitch.tv/commands', 'PASS SCHMOOPIIE', 'JOIN #reef']); assert.match(socket.sent[2], /^NICK justinfan\d+$/);
  socket.onmessage({ data: 'PING :tmi.twitch.tv\r' }); assert.equal(socket.sent.length, 4);
  socket.onmessage({ data: '\n@room-id=1 :tmi.twitch.tv ROOMSTATE #reef\r\n:wave!x PRIVMSG #reef :hi\r\n' });
  assert.equal(socket.sent[4], 'PONG :tmi.twitch.tv\r\n'); assert.equal(received.length, 1); assert.ok(statuses.includes('connected'));
  socket.onmessage({ data: ':wave!x PRIVMSG #other :ignore\r\n' }); assert.equal(received.length, 1);
  client.stop(); assert.equal(socket.closed, true); assert.equal(client.stopped, true); assert.equal(client.timer, null);
});
process.stdout.write('\n' + passed + ' tests passed.\n');
