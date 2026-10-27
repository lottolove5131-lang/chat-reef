(function (root) {
  'use strict';
  var names = ['coralclub', 'moonlit_miso', 'kelpkeeper', 'tinycurrent', 'peachwave', 'sandy_toes', 'lunarjelly', 'mintcondition', 'deepbluejay', 'oceanorbit', 'softshell', 'bubbletea', 'reef_roamer', 'saltysunset', 'mossyrock', 'marshmallowfin', 'starrysea', 'tidepool', 'pinkplankton', 'daydreamdiver', 'cozycrab', 'shellphone', 'seaglass', 'slowturtle', 'aquafern', 'driftwood', 'littlelagoon', 'pearldrop', 'sleepyshrimp', 'neonnoodle', 'waveshello', 'glowgarden', 'whalesong', 'splashzone', 'bluehour', 'seafoam'];
  var colors = ['#f5aa94', '#9fd6bf', '#bba5e3', '#e9cf87', '#8cc9dd', '#e29ebc'];
  var messages = ['hello little ocean', 'this is so cozy', 'look at the turtle!', 'just floating by', 'good vibes in the reef', 'bubbles bubbles bubbles'];
  function DemoChat(onEvent) { this.onEvent = onEvent; this.timer = null; this.count = 0; this.running = false; }
  DemoChat.prototype.emit = function (type, index, count) {
    var name = names[index % names.length];
    this.onEvent({ type: type, userId: 'demo-' + index, username: name, color: colors[index % colors.length], text: messages[index % messages.length], emoteCount: type === 'message' ? (Math.random() < .3 ? 6 : Math.floor(Math.random() * 3)) : 0, count: count || 1, badges: [], emotes: [] });
  };
  DemoChat.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    for (var i = 0; i < 22; i++) this.emit('message', i);
    this.schedule();
  };
  DemoChat.prototype.schedule = function () {
    var self = this;
    this.timer = setTimeout(function () {
      if (!self.running) return;
      self.count++;
      var index = Math.floor(Math.random() * names.length);
      if (self.count % 48 === 0) self.emit('raid', index, 48 + Math.floor(Math.random() * 65));
      else if (self.count % 31 === 0) self.emit('gift', index, 12);
      else if (self.count % 17 === 0) self.emit(self.count % 34 ? 'sub' : 'resub', index);
      else self.emit('message', index);
      self.schedule();
    }, 750 + Math.random() * 1350);
  };
  DemoChat.prototype.stop = function () { this.running = false; clearTimeout(this.timer); };
  root.ChatReefDemo = DemoChat;
})(globalThis);
