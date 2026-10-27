(function () {
  'use strict';
  var W = 1920, H = 1080, MAX_CREATURES = 120, MAX_RECORDS = 2000, MAX_PARTICLES = 420, MAX_SCHOOL = 220;
  var species = ['fish', 'jelly', 'seahorse', 'crab', 'turtle'];
  var params = new URLSearchParams(location.search);
  var demo = params.get('demo') === '1', anonymous = params.get('anon') === '1', transparent = params.get('transparent') === '1';
  var channel = ChatReefIRC.normalizeChannel(params.get('channel'));
  var valid = ChatReefIRC.validChannel(channel);
  var storageKey = 'chat-reef:v1:' + (demo ? 'demo:' : 'channel:') + (valid ? channel : 'ocean');
  var canvas = document.getElementById('reef'), ctx = canvas.getContext('2d');
  var ageElement = document.getElementById('reef-age'), countElement = document.getElementById('creature-count');
  var pulseElement = document.getElementById('pulse-value'), pulseFill = document.getElementById('pulse-fill');
  var noteElement = document.getElementById('event-note');
  var creatures = new Map(), records = new Map(), particles = [], school = [], messageTimes = [], corals = [];
  var now = performance.now() / 1000, lastActivity = now, lastFrame = now, lastHud = -1, lastSave = now;
  var startedAt = Date.now(), dirty = false, storageAvailable = true, noteUntil = 0, clamUntil = 0, bloomUntil = 0;
  var pulse = 0, light = .45, growth = 0, sleeping = false, source = null, animationId = 0, destroyed = false;
  document.body.classList.toggle('transparent', transparent);
  document.getElementById('demo-caption').hidden = !demo;

  function hash(text) {
    var result = 2166136261;
    for (var i = 0; i < text.length; i++) { result ^= text.charCodeAt(i); result = Math.imul(result, 16777619); }
    return result >>> 0;
  }
  function randomGenerator(seed) {
    return function () { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function random(min, max) { return min + Math.random() * (max - min); }
  function colorFor(id) { return ['#a7dfc5', '#edb49d', '#bdabe4', '#a1d8e8', '#ecd697', '#e9a9c9'][hash(id) % 6]; }
  function safeColor(color, id) { return /^#[0-9a-f]{6}$/i.test(color || '') ? color : colorFor(id); }
  function ellipse(x, y, rx, ry, fill) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(.01, rx), Math.max(.01, ry), 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } else ctx.stroke();
  }
  function path(points, fill) {
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for (var i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  function note(text) { noteElement.textContent = text; noteElement.classList.add('visible'); noteUntil = now + 6; }
  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!saved || saved.version !== 1 || !Array.isArray(saved.creatures)) return;
      if (Number.isFinite(saved.startedAt) && saved.startedAt > 0 && saved.startedAt <= Date.now()) startedAt = saved.startedAt;
      growth = clamp(Number(saved.growth) || 0, 0, 1);
      saved.creatures.slice(-MAX_RECORDS).forEach(function (record) {
        if (!record || typeof record.userId !== 'string' || !record.userId || !species.includes(record.species)) return;
        records.set(record.userId, {
          userId: record.userId, species: record.species, size: clamp(Number(record.size) || 1, 1, 2.2),
          firstSeen: Number.isFinite(record.firstSeen) && record.firstSeen > 0 && record.firstSeen <= Date.now() ? record.firstSeen : Date.now(),
          messageCount: clamp(Math.floor(Number(record.messageCount) || 0), 0, 1000000000),
          color: safeColor(record.color, record.userId)
        });
      });
    } catch (_) { storageAvailable = false; }
  }
  function save() {
    if (!dirty || !storageAvailable) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, startedAt: startedAt, growth: growth, creatures: Array.from(records.values()) }));
      dirty = false;
    } catch (_) { storageAvailable = false; note('Local saving unavailable · this reef lives for this session'); }
  }
  function sparkle(x, y, count, color) {
    for (var i = 0; i < count && particles.length < MAX_PARTICLES; i++) particles.push({ kind: 'spark', x: x, y: y, vx: random(-45, 45), vy: random(-70, 15), life: random(1, 3), maxLife: 3, size: random(2, 5), color: color || '#f6e3ac' });
  }
  function bubbles(x, y, count) {
    for (var i = 0; i < Math.min(40, count) && particles.length < MAX_PARTICLES; i++) particles.push({ kind: 'bubble', x: x + random(-30, 30), y: y, vx: random(-12, 12), vy: random(-80, -32), life: random(3, 7), maxLife: 7, size: random(3, 11), color: '#c0f0e9' });
  }
  function getCreature(event) {
    var id = String(event.userId || event.username || '').slice(0, 100);
    if (!id) return null;
    var creature = creatures.get(id), record = records.get(id), returning = !!record;
    if (!record) {
      record = { userId: id, species: species[hash(id) % species.length], size: 1, firstSeen: Date.now(), messageCount: 0, color: safeColor(event.color, id) };
      if (records.size >= MAX_RECORDS) {
        var dormant = Array.from(records.keys()).find(function (key) { return !creatures.has(key); });
        if (dormant) records.delete(dormant);
      }
      records.set(id, record);
    }
    if (!creature) {
      if (creatures.size >= MAX_CREATURES) {
        var oldest = Array.from(creatures.values()).reduce(function (a, b) { return a.lastTalk < b.lastTalk ? a : b; });
        creatures.delete(oldest.id);
      }
      creature = { id: id, record: record, x: random(130, W - 130), y: record.species === 'crab' ? random(910, 985) : random(230, 800), vx: random(-30, 30), vy: random(-12, 12), phase: random(0, Math.PI * 2), labelUntil: 0, lastTalk: now, shimmerUntil: 0, welcomeUntil: returning ? now + 4 : 0, username: '' };
      creatures.set(id, creature);
      if (returning) sparkle(creature.x, creature.y, 18, '#b7f3da');
    }
    creature.username = String(event.username || '').slice(0, 32);
    creature.lastTalk = now;
    creature.labelUntil = now + 4;
    if (event.color) record.color = safeColor(event.color, id);
    dirty = true;
    return creature;
  }
  function spawnSchool(count, rain) {
    count = clamp(Math.floor(Number(count) || 0), 0, rain ? 80 : 150);
    var side = Math.random() < .5 ? 1 : -1;
    var room = MAX_SCHOOL - school.length;
    if (count > room) school.splice(0, count - room);
    for (var i = 0; i < count; i++) school.push({ x: rain ? random(50, W - 50) : (side === 1 ? -random(30, 400) : W + random(30, 400)), y: rain ? random(-450, -30) : random(280, 760), vx: rain ? random(-20, 20) : side * random(115, 185), vy: rain ? random(60, 105) : random(-6, 6), size: random(.35, .7), phase: random(0, 6.28), life: rain ? 14 : 23, color: colorFor(String(i)) });
  }
  function receive(event) {
    if (destroyed || !event) return;
    now = performance.now() / 1000;
    if (event.type === 'clear') {
      if (event.all) { creatures.clear(); records.clear(); school.length = 0; particles.length = 0; noteElement.classList.remove('visible'); clamUntil = 0; }
      else {
        var id = String(event.userId || '');
        if (!id && event.username) creatures.forEach(function (c) { if (c.username.toLowerCase() === event.username.toLowerCase()) id = c.id; });
        creatures.delete(id); records.delete(id);
      }
      dirty = true; save(); return;
    }
    if (!['message', 'sub', 'resub', 'gift', 'raid'].includes(event.type)) return;
    lastActivity = now;
    if (event.type === 'message') {
      if (messageTimes.length >= 6000) messageTimes.shift();
      messageTimes.push(now);
      var creature = getCreature(event);
      if (!creature) return;
      creature.record.messageCount = Math.min(1000000000, creature.record.messageCount + 1);
      creature.record.size = Math.min(2.2, 1 + Math.sqrt(creature.record.messageCount) * .055);
      var emotes = Math.max(0, Number(event.emoteCount) || 0);
      if (emotes) bubbles(creature.x, creature.y, emotes * 3);
      if (emotes >= 5) { bloomUntil = now + 7; growth = Math.min(1, growth + .006); sparkle(creature.x, 920, 15, '#f3b7cd'); }
    } else if (event.type === 'sub' || event.type === 'resub') {
      var subscriber = getCreature(event);
      if (subscriber) { subscriber.shimmerUntil = now + 12; sparkle(subscriber.x, subscriber.y, 30); }
      clamUntil = now + 10;
      note(anonymous ? 'A pearl for a new supporter' : (event.username || 'A visitor') + (event.type === 'resub' ? ' returned to the pearl club' : ' joined the pearl club'));
    } else if (event.type === 'gift') {
      spawnSchool(Math.max(12, Math.min(80, (Number(event.count) || 1) * 4)), true);
      note('A little generosity. A whole shower of fish.');
    } else if (event.type === 'raid') {
      var raidCount = clamp(Math.floor(Number(event.count) || 0), 0, 150);
      spawnSchool(raidCount, false);
      note('A new current arrives · ' + raidCount + ' little visitors');
    }
  }

  function makeCoral(index) {
    var rng = randomGenerator(hash('coral:' + index)), surface = document.createElement('canvas');
    surface.width = 260; surface.height = 330;
    var brush = surface.getContext('2d');
    var palette = ['#d88f98', '#8abbb1', '#ad9ac6', '#c9b784', '#78a5ad'];
    var tint = palette[index % palette.length];
    brush.lineCap = 'round';
    function branch(x, y, length, angle, width, depth) {
      var endX = x + Math.sin(angle) * length, endY = y - Math.cos(angle) * length;
      brush.strokeStyle = tint; brush.lineWidth = width;
      brush.beginPath(); brush.moveTo(x, y); brush.quadraticCurveTo(x + Math.sin(angle + .2) * length * .6, y - length * .5, endX, endY); brush.stroke();
      if (depth > 0) {
        branch(endX, endY, length * (.62 + rng() * .12), angle - .3 - rng() * .45, width * .63, depth - 1);
        branch(endX, endY, length * (.62 + rng() * .12), angle + .3 + rng() * .45, width * .63, depth - 1);
      } else {
        brush.fillStyle = '#edd7c5'; brush.beginPath(); brush.arc(endX, endY, 2.5, 0, Math.PI * 2); brush.fill();
      }
    }
    if (index % 4 === 0) {
      for (var j = 0; j < 11; j++) {
        brush.strokeStyle = tint; brush.lineWidth = 4 + rng() * 5;
        brush.beginPath(); brush.moveTo(130, 325); brush.bezierCurveTo(85 + rng() * 95, 240, 40 + rng() * 180, 190, 65 + rng() * 130, 90 + rng() * 100); brush.stroke();
      }
    } else branch(130, 325, 64 + rng() * 25, (rng() - .5) * .3, 13, 4);
    return { image: surface, x: index * 88 - 60 + rng() * 35, y: 1010 + rng() * 65, scale: .4 + rng() * .65, phase: rng() * 6.28, front: index % 3 !== 0 };
  }
  for (var coralIndex = 0; coralIndex < 24; coralIndex++) corals.push(makeCoral(coralIndex));
  var motes = Array.from({ length: 65 }, function (_, i) { var rng = randomGenerator(i + 89); return { x: rng() * W, y: rng() * H, size: .7 + rng() * 1.8, speed: 2 + rng() * 6, phase: rng() * 6.28 }; });

  function background(time) {
    ctx.clearRect(0, 0, W, H);
    if (!transparent) {
      var ocean = ctx.createLinearGradient(0, 0, 0, H);
      ocean.addColorStop(0, '#103d49'); ocean.addColorStop(.42, '#0a293b'); ocean.addColorStop(1, '#061726');
      ctx.fillStyle = ocean; ctx.fillRect(0, 0, W, H);
      var glow = ctx.createRadialGradient(1070, -150, 0, 1070, -150, 1200);
      glow.addColorStop(0, 'rgba(130,215,186,' + (.08 + light * .14) + ')'); glow.addColorStop(1, 'rgba(70,150,153,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      for (var r = 0; r < 8; r++) {
        var x = 320 + r * 230 + Math.sin(time * .09 + r) * 65;
        var ray = ctx.createLinearGradient(x, 0, x - 220, 870);
        ray.addColorStop(0, 'rgba(180,238,207,' + (.015 + light * .025) + ')'); ray.addColorStop(1, 'rgba(180,238,207,0)');
        path([[x, 0], [x + 70, 0], [x - 170, 950], [x - 410, 950]], ray);
      }
      ctx.restore();
      ctx.fillStyle = '#091f2c'; ctx.beginPath(); ctx.moveTo(0, H);
      ctx.lineTo(0, 985); ctx.bezierCurveTo(450, 940, 900, 1040, 1400, 969); ctx.quadraticCurveTo(1740, 935, W, 982); ctx.lineTo(W, H); ctx.fill();
    }
    ctx.save(); ctx.globalAlpha = .24 + light * .2;
    motes.forEach(function (m) {
      var y = ((m.y - time * m.speed) % H + H) % H;
      ellipse(m.x + Math.sin(time * .15 + m.phase) * 25, y, m.size, m.size, '#b3dcd2');
    });
    ctx.restore();
  }
  function drawCorals(time, front) {
    corals.forEach(function (c) {
      if (c.front !== front) return;
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(Math.sin(time * .4 + c.phase) * .018);
      var size = c.scale * (.75 + growth * .4);
      ctx.scale(size, size); ctx.globalAlpha = (front ? .85 : .3) * (.55 + light * .45);
      if (bloomUntil > now) { ctx.shadowColor = '#efbad0'; ctx.shadowBlur = 14 * Math.min(1, (bloomUntil - now) / 2); }
      ctx.drawImage(c.image, -130, -325); ctx.restore();
    });
    if (front) {
      ctx.save(); ctx.globalAlpha = .5;
      for (var i = 0; i < 18; i++) {
        var x = i * 118 + 20, y = 1025 + Math.sin(i * 3) * 26;
        ellipse(x, y, 35 + (i % 4) * 10, 14, '#122f3a');
        ellipse(x - 5, y - 7, 20, 4, '#1d3f46');
      }
      ctx.restore();
    }
  }
  function eye(x, y, size) {
    ellipse(x, y, size + 1.5, size + 1.5, '#e9f1da');
    ellipse(x + .8, y, size, size, '#102a33');
  }
  function fish(color, time) {
    var tail = Math.sin(time * 5) * 3;
    path([[-18, 0], [-36, -15 + tail], [-32, 12 + tail]], color);
    ellipse(0, 0, 25, 14, color);
    ctx.globalAlpha *= .65; path([[-3, -8], [2, -23], [13, -9]], color); ctx.globalAlpha /= .65;
    path([[-2, 3], [-10, 11], [9, 9]], '#ffffff28');
    ctx.strokeStyle = '#143d4544'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(9, 0, 7, -1.3, 1.3); ctx.stroke();
    eye(15, -3, 2.4);
    ellipse(-5, -5, 11, 2, '#ffffff20');
  }
  function jelly(color, time) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    for (var i = 0; i < 5; i++) {
      var x = (i - 2) * 9;
      ctx.beginPath(); ctx.moveTo(x, 2); ctx.bezierCurveTo(x - 12, 20, x + Math.sin(time * 2 + i) * 17, 32, x + Math.sin(time * 2 + i) * 13, 48 + (i % 2) * 8); ctx.stroke();
    }
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-28, 5); ctx.bezierCurveTo(-30, -39, 30, -39, 28, 5); ctx.quadraticCurveTo(16, 14, 0, 6); ctx.quadraticCurveTo(-16, 14, -28, 5); ctx.fill();
    ellipse(-7, -16, 9, 4, '#ffffff38'); eye(12, -5, 1.9);
  }
  function turtle(color, time) {
    var flap = Math.sin(time * 2) * 5;
    ellipse(-5, -20 - flap, 13, 7, color); ellipse(-5, 20 + flap, 13, 7, color);
    ellipse(-24, 0, 8, 5, color); ellipse(29, 0, 12, 9, color);
    ellipse(0, 0, 28, 21, color); ellipse(0, 0, 22, 17, '#123f4750');
    ctx.strokeStyle = '#e1f1cd60'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(7, -12); ctx.lineTo(16, 0); ctx.lineTo(6, 12); ctx.lineTo(-10, 10); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(7, -12); ctx.lineTo(11, -18); ctx.moveTo(16, 0); ctx.lineTo(22, 0); ctx.moveTo(6, 12); ctx.lineTo(10, 18); ctx.moveTo(-10, 10); ctx.lineTo(-19, 14); ctx.moveTo(-10, -10); ctx.lineTo(-19, -14); ctx.stroke();
    eye(34, -3, 2);
  }
  function seahorse(color, time) {
    ctx.strokeStyle = color; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(6, -19); ctx.bezierCurveTo(-23, -5, 10, 18, -4, 32); ctx.bezierCurveTo(-22, 47, -32, 18, -15, 22); ctx.stroke();
    ellipse(6, -22, 13, 12, color); path([[12, -24], [30, -20], [28, -13], [9, -17]], color);
    path([[-7, -3], [-25, -9 + Math.sin(time * 7) * 4], [-18, 13], [-6, 9]], color);
    path([[-4, -29], [1, -41], [9, -32]], color); eye(11, -25, 2.2);
    ctx.strokeStyle = '#ffffff30'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(4, 2); ctx.moveTo(-4, 7); ctx.lineTo(5, 9); ctx.stroke();
  }
  function crab(color, time) {
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (var side = -1; side <= 1; side += 2) {
      for (var i = 0; i < 3; i++) {
        var step = Math.sin(time * 4 + i) * 3;
        ctx.beginPath(); ctx.moveTo(side * 15, 3 + i * 3); ctx.lineTo(side * (29 + i * 2), 8 + i * 5); ctx.lineTo(side * (32 + i * 3), 20 + step); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(side * 17, 0); ctx.quadraticCurveTo(side * 38, -4, side * 31, -20); ctx.stroke();
      ellipse(side * 31, -23, 8, 10, color); path([[side * 31, -31], [side * 37, -37], [side * 37, -26]], color);
    }
    ellipse(0, 2, 24, 15, color);
    ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-12, -15); ctx.moveTo(10, -4); ctx.lineTo(12, -15); ctx.stroke();
    eye(-12, -16, 2); eye(12, -16, 2); ellipse(-5, -3, 8, 2, '#ffffff30');
  }
  function drawCreature(c, time) {
    var size = c.record.size * .9;
    ctx.save(); ctx.translate(c.x, c.y + Math.sin(time * 1.4 + c.phase) * 4);
    ctx.scale(c.vx < 0 ? -size : size, size);
    if (c.shimmerUntil > now) { ctx.shadowColor = '#ffedbc'; ctx.shadowBlur = 16 + Math.sin(time * 5) * 6; }
    ctx.globalAlpha = .7 + light * .3;
    var render = { fish: fish, jelly: jelly, turtle: turtle, seahorse: seahorse, crab: crab }[c.record.species];
    render(c.record.color, time + c.phase); ctx.restore();
    if (!anonymous && c.labelUntil > now) {
      ctx.save(); ctx.globalAlpha = Math.min(1, c.labelUntil - now) * .85;
      ctx.font = '13px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#e1f4e9';
      ctx.fillText(c.username, c.x, c.y - 44 * size); ctx.restore();
    }
    if (c.welcomeUntil > now) {
      ctx.save(); ctx.globalAlpha = Math.min(1, c.welcomeUntil - now) * .7; ctx.font = '11px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#c9eac7';
      ctx.fillText('welcome back', c.x, c.y + 55 * size); ctx.restore();
    }
  }
  function drawClam(time) {
    var active = clamUntil > now, opening = active ? Math.min(1, clamUntil - now, (10 - (clamUntil - now)) * 2) : 0;
    ctx.save(); ctx.translate(1480, 979);
    ellipse(0, 13, 67, 15, '#09212a');
    ctx.save(); ctx.translate(0, -Math.max(0, opening) * 36); ctx.rotate(-Math.max(0, opening) * .18);
    ctx.fillStyle = '#829caa'; ctx.beginPath(); ctx.moveTo(-52, 0); ctx.bezierCurveTo(-65, -65, 55, -65, 52, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c3cac760'; ctx.lineWidth = 1.5;
    for (var i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 4, 0); ctx.quadraticCurveTo(i * 16, -25, i * 13, -37 + Math.abs(i) * 4); ctx.stroke(); }
    ctx.restore();
    if (active) {
      ctx.save(); ctx.shadowColor = '#ffe3a7'; ctx.shadowBlur = 35 + Math.sin(time * 3) * 8;
      ellipse(0, -8, 15, 15, '#f4e7c7'); ellipse(-4, -13, 4, 3, '#fff9e7'); ctx.restore();
    }
    ellipse(0, 6, 56, 17, '#afaaa4'); ellipse(0, 2, 46, 8, '#d3c5b2'); ctx.restore();
  }
  function drawAngler(time) {
    if (!sleeping) return;
    ctx.save(); ctx.translate(960 + Math.sin(time * .3) * 45, 570 + Math.sin(time * .7) * 10);
    ctx.shadowColor = '#d9efa0'; ctx.shadowBlur = 18;
    ctx.strokeStyle = '#6a8d83'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(9, -20); ctx.bezierCurveTo(0, -74, 55, -80, 60, -50); ctx.stroke();
    ellipse(60, -48, 6, 8, '#e1ed9e'); ctx.shadowBlur = 0;
    path([[-29, 0], [-52, -19], [-49, 19]], '#627e84'); ellipse(0, 0, 37, 27, '#627e84');
    ctx.strokeStyle = '#c1d9bd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(13, -5); ctx.lineTo(23, -4); ctx.stroke();
    ctx.font = '14px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = '#a4bcac'; ctx.fillText('z', -44, -42); ctx.font = '10px "Segoe UI", Arial, sans-serif'; ctx.fillText('z', -32, -57); ctx.restore();
  }
  function update(dt, time) {
    while (messageTimes.length && messageTimes[0] < now - 60) messageTimes.shift();
    pulse = messageTimes.length;
    sleeping = now - lastActivity >= 60;
    light += ((sleeping ? .12 : .45 + Math.min(pulse / 160, .55)) - light) * Math.min(1, dt * .6);
    if (pulse > 0) { var previousGrowth = growth; growth = Math.min(1, growth + dt * Math.min(pulse, 150) * .000006); if (growth !== previousGrowth) dirty = true; }
    var all = Array.from(creatures.values());
    all.forEach(function (c) {
      var sx = 0, sy = 0, avx = 0, avy = 0, cx = 0, cy = 0, neighbors = 0;
      all.forEach(function (other) {
        if (other === c) return;
        var dx = c.x - other.x, dy = c.y - other.y, distance2 = dx * dx + dy * dy;
        if (distance2 < 6400 && distance2 > .01) { sx += dx / distance2 * 650; sy += dy / distance2 * 650; }
        if (distance2 < 40000 && other.record.species === c.record.species) { avx += other.vx; avy += other.vy; cx += other.x; cy += other.y; neighbors++; }
      });
      var ax = sx * 3 + Math.sin(time * .23 + c.phase) * 5, ay = sy * 3 + Math.cos(time * .31 + c.phase) * 4;
      if (neighbors) { ax += (avx / neighbors - c.vx) * .08 + (cx / neighbors - c.x) * .012; ay += (avy / neighbors - c.vy) * .08 + (cy / neighbors - c.y) * .012; }
      var ground = c.record.species === 'crab', top = ground ? 910 : 180, bottom = ground ? 991 : 858;
      if (c.x < 100) ax += (100 - c.x) * .3;
      if (c.x > W - 100) ax -= (c.x - W + 100) * .3;
      if (c.y < top) ay += (top - c.y) * .4;
      if (c.y > bottom) ay -= (c.y - bottom) * .4;
      c.vx += ax * dt; c.vy += ay * dt;
      var speed = Math.hypot(c.vx, c.vy), max = ground ? 16 : c.record.species === 'jelly' ? 22 : 42;
      if (speed > max) { c.vx *= max / speed; c.vy *= max / speed; }
      if (speed < 8) c.vx += Math.cos(c.phase) * dt * 4;
      c.x = clamp(c.x + c.vx * dt, 45, W - 45); c.y = clamp(c.y + c.vy * dt, top - 30, bottom + 20);
    });
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i]; p.x += (p.vx + Math.sin(time + p.y * .02) * 5) * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 || p.y < -20) particles.splice(i, 1);
    }
    for (var j = school.length - 1; j >= 0; j--) {
      var s = school[j]; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0 || s.x < -500 || s.x > W + 500 || s.y > H + 50) school.splice(j, 1);
    }
  }
  function render(time) {
    background(time); drawCorals(time, false);
    school.forEach(function (s) {
      ctx.save(); ctx.translate(s.x, s.y + Math.sin(time * 2 + s.phase) * 12); ctx.scale(s.vx < 0 ? -s.size : s.size, s.size); ctx.globalAlpha = Math.min(1, s.life) * .8;
      fish(s.color, time + s.phase); ctx.restore();
    });
    creatures.forEach(function (c) { drawCreature(c, time); });
    drawCorals(time, true); drawClam(time);
    particles.forEach(function (p) {
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life) * .65;
      if (p.kind === 'bubble') { ctx.lineWidth = 1; ctx.strokeStyle = p.color; ellipse(p.x, p.y, p.size, p.size); ellipse(p.x - p.size * .3, p.y - p.size * .35, 1, 1, '#e6fff3'); }
      else { ctx.translate(p.x, p.y); ctx.rotate(time); path([[0, -p.size], [p.size * .3, -p.size * .3], [p.size, 0], [p.size * .3, p.size * .3], [0, p.size], [-p.size * .3, p.size * .3], [-p.size, 0], [-p.size * .3, -p.size * .3]], p.color); }
      ctx.restore();
    });
    drawAngler(time);
  }
  function hud() {
    var seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    ageElement.textContent = seconds >= 86400 ? Math.floor(seconds / 86400) + 'd ' + Math.floor(seconds % 86400 / 3600) + 'h' : seconds >= 3600 ? Math.floor(seconds / 3600) + 'h ' + Math.floor(seconds % 3600 / 60) + 'm' : Math.floor(seconds / 60) + 'm';
    countElement.textContent = creatures.size;
    pulseElement.replaceChildren(document.createTextNode(String(pulse)), Object.assign(document.createElement('span'), { textContent: ' / min' }));
    pulseFill.style.width = Math.min(100, pulse / 150 * 100) + '%';
    document.body.classList.toggle('sleeping', sleeping);
    if (now > noteUntil) noteElement.classList.remove('visible');
  }
  function frame() {
    if (destroyed) return;
    now = performance.now() / 1000;
    var dt = Math.min(.05, Math.max(0, now - lastFrame)); lastFrame = now;
    update(dt, now); render(now);
    if (now - lastHud >= 1) { hud(); lastHud = now; }
    if (now - lastSave >= 5) { save(); lastSave = now; }
    animationId = requestAnimationFrame(frame);
  }
  function status(state, text) {
    document.body.classList.toggle('connected', state === 'connected');
    document.getElementById('connection-status').textContent = text;
  }
  load();
  if (!storageAvailable) note('Local saving unavailable · this reef lives for this session');
  if (demo) {
    status('connected', 'An offline ocean · everyone is welcome');
    source = new ChatReefDemo(receive); source.start();
  } else if (valid) {
    source = new ChatReefIRC.TwitchClient(channel, receive, status); source.start();
  } else {
    document.getElementById('setup').hidden = false;
    status('idle', channel ? 'Check your channel name · letters, numbers, underscores' : 'Waiting for your first current');
  }
  document.getElementById('channel-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var input = ChatReefIRC.normalizeChannel(document.getElementById('channel').value);
    if (!ChatReefIRC.validChannel(input)) return;
    var next = new URL(location.href); next.searchParams.set('channel', input); next.searchParams.delete('demo'); location.href = next.href;
  });
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });
  window.ChatReef = {
    receive: receive,
    stats: function () { return { creatures: creatures.size, savedCreatures: records.size, particles: particles.length, school: school.length, pulse: pulse, sleeping: sleeping, storageAvailable: storageAvailable }; },
    destroy: function () { save(); destroyed = true; if (source) source.stop(); cancelAnimationFrame(animationId); }
  };
  dirty = true; save(); frame();
})();
