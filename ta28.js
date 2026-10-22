const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

// ============ CẤU HÌNH ============
const WSS_URL = 'wss://koay56bcni5e0mk.cq.qnwxdhwica.com/';
const HTTP_PORT = 5500;
const MAX_HISTORY = 50;

// Heartbeat — giảm xuống 10s để giữ NAT
const PING_INTERVAL_MS = 10000;
const TCP_KEEPALIVE_MS = 30000;

// Watchdog: 3 phút không có message nào từ server → chết → reconnect
const WATCHDOG_TIMEOUT_MS = 3 * 60 * 1000;

// Re-login định kỳ mỗi 45 phút (đề phòng token hết hạn)
const RELOGIN_INTERVAL_MS = 45 * 60 * 1000;

// Reconnect
const RECONNECT_MIN_MS = 5000;
const RECONNECT_MAX_MS = 120000;
const STABLE_CONNECTION_MS = 30000;
const MAX_CONSECUTIVE_FAILURES = 10;
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

// Debug: bật để log tất cả message
const DEBUG_ALL_MESSAGES = false;

// ============ HTTP + SOCKET.IO ============
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout:  20000
});

const sessions = { md5: [], tx: [] };
const pending  = { md5: null, tx: null };

// ============ HELPER ============
function calcStats(list, n = 20) {
  const recent = list.slice(0, n);
  let tai = 0, xiu = 0;
  for (const s of recent) {
    if (s.result === 'TÀI') tai++;
    else if (s.result === 'XỈU') xiu++;
  }
  return {
    sampleSize: recent.length,
    tai, xiu,
    taiPercent: recent.length ? +(tai / recent.length * 100).toFixed(1) : 0,
    xiuPercent: recent.length ? +(xiu / recent.length * 100).toFixed(1) : 0
  };
}

function formatSession(s) {
  return {
    matchId: Number(s.matchId),
    dice: s.dice,
    d1: Number(s.dice.split('-')[0]),
    d2: Number(s.dice.split('-')[1]),
    d3: Number(s.dice.split('-')[2]),
    sum: s.sum,
    result: s.result,
    md5: s.md5 || null,
    time: s.time
  };
}

// ============ API ============
function apiHandler(type) {
  return (req, res) => {
    let limit = parseInt(req.query.limit) || MAX_HISTORY;
    if (limit > MAX_HISTORY) limit = MAX_HISTORY;
    if (limit < 1) limit = 1;

    let list = sessions[type];
    if (req.query.matchId) {
      const f = String(req.query.matchId);
      list = list.filter(s => String(s.matchId).includes(f));
    }
    if (req.query.result) {
      const r = String(req.query.result).toUpperCase();
      if (r === 'TAI' || r === 'TÀI') list = list.filter(s => s.result === 'TÀI');
      else if (r === 'XIU' || r === 'XỈU') list = list.filter(s => s.result === 'XỈU');
    }

    const sliced = list.slice(0, limit);
    const latest = sessions[type][0] || null;

    res.json({
      ok: true,
      table: type,
      tableName: type === 'md5' ? 'TÀI XỈU MD5' : 'TÀI XỈU THƯỜNG',
      updatedAt: new Date().toISOString(),
      pending: pending[type] ? {
        matchId: Number(pending[type].matchId) || null,
        md5: pending[type].md5 || null,
        startedAt: pending[type].time
      } : null,
      latest: latest ? formatSession(latest) : null,
      stats: calcStats(sessions[type], 20),
      totalStored: sessions[type].length,
      count: sliced.length,
      data: sliced.map(formatSession)
    });
  };
}

app.get('/api/md5', apiHandler('md5'));
app.get('/api/tx', apiHandler('tx'));

app.get('/api/all', (req, res) => {
  res.json({
    ok: true,
    updatedAt: new Date().toISOString(),
    md5: {
      pending: pending.md5 ? { matchId: Number(pending.md5.matchId) || null, md5: pending.md5.md5 || null } : null,
      latest: sessions.md5[0] ? formatSession(sessions.md5[0]) : null,
      stats: calcStats(sessions.md5, 20),
      data: sessions.md5.slice(0, 20).map(formatSession)
    },
    tx: {
      pending: pending.tx ? { matchId: Number(pending.tx.matchId) || null } : null,
      latest: sessions.tx[0] ? formatSession(sessions.tx[0]) : null,
      stats: calcStats(sessions.tx, 20),
      data: sessions.tx.slice(0, 20).map(formatSession)
    }
  });
});

app.get('/api/signal', (req, res) => {
  const md5Latest = sessions.md5[0] || null;
  const txLatest  = sessions.tx[0]  || null;
  const md5Stats  = calcStats(sessions.md5, 20);
  const txStats   = calcStats(sessions.tx, 20);

  function predict(stats) {
    if (stats.sampleSize < 5) return 'CHỜ THÊM DỮ LIỆU';
    if (stats.taiPercent >= 60) return 'XỈU';
    if (stats.xiuPercent >= 60) return 'TÀI';
    return 'BÌNH THƯỜNG';
  }

  res.json({
    ok: true,
    updatedAt: new Date().toISOString(),
    md5: {
      latestResult: md5Latest ? md5Latest.result : null,
      latestDice: md5Latest ? md5Latest.dice : null,
      latestSum: md5Latest ? md5Latest.sum : null,
      pendingMatchId: pending.md5 ? Number(pending.md5.matchId) || null : null,
      prediction: predict(md5Stats),
      stats20: md5Stats
    },
    tx: {
      latestResult: txLatest ? txLatest.result : null,
      latestDice: txLatest ? txLatest.dice : null,
      latestSum: txLatest ? txLatest.sum : null,
      pendingMatchId: pending.tx ? Number(pending.tx.matchId) || null : null,
      prediction: predict(txStats),
      stats20: txStats
    }
  });
});

app.get('/api/status', (req, res) => {
  const now = Date.now();
  let connDurationSec = 0;
  if (lastConnectedAt && (!lastDisconnectedAt || lastConnectedAt > lastDisconnectedAt)) {
    connDurationSec = Math.floor((now - lastConnectedAt) / 1000);
  }
  res.json({
    ok: true,
    wsState: ws ? ws.readyState : null,
    wsStateText: ws
      ? ['CONNECTING','OPEN','CLOSING','CLOSED'][ws.readyState] || 'UNKNOWN'
      : 'NOT_INIT',
    sessionSeq,
    reconnectAttempts,
    consecutiveFailures,
    totalReconnects,
    lastConnectedAt,
    lastDisconnectedAt,
    connectionDurationSec: connDurationSec,
    lastMessageAgoSec: lastMessageAt ? Math.floor((now - lastMessageAt) / 1000) : null,
    lastLoginAt,
    cooldownUntil: cooldownUntil > now ? new Date(cooldownUntil).toISOString() : null,
    uptimeSec: Math.floor((now - processStartTime) / 1000),
    stats: {
      md5: { stored: sessions.md5.length, pending: !!pending.md5 },
      tx:  { stored: sessions.tx.length,  pending: !!pending.tx  }
    }
  });
});

// ============ HTML ============
const HTML_PAGE = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tài Xỉu Realtime</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif;
    background: #0f172a; color: #e2e8f0; padding: 12px; }
  h1 { text-align: center; font-size: 18px; margin: 0 0 8px; color: #38bdf8; }
  .api-links { text-align: center; margin-bottom: 12px; font-size: 13px; }
  .api-links a { color: #38bdf8; text-decoration: none; margin: 0 4px;
    padding: 4px 10px; border: 1px solid #38bdf8; border-radius: 4px; display: inline-block; margin-bottom: 4px; }
  .api-links a:hover { background: #38bdf8; color: #0f172a; }
  .toolbar { text-align: center; margin-bottom: 12px; }
  .toolbar input { background: #1e293b; border: 1px solid #334155; color: #e2e8f0;
    padding: 8px 12px; border-radius: 6px; width: 180px; font-size: 14px; }
  .toolbar button { background: #ef4444; color: white; border: none; padding: 8px 14px;
    border-radius: 6px; cursor: pointer; margin-left: 6px; font-size: 14px; }
  .status { text-align: center; margin-bottom: 12px; font-size: 12px; color: #94a3b8; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: #22c55e; margin-right: 6px; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 1400px; margin: 0 auto; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .panel { background: #1e293b; border-radius: 10px; overflow: hidden; border: 1px solid #334155; }
  .panel h2 { margin: 0; padding: 10px; font-size: 14px; text-align: center; color: white; letter-spacing: 1px; }
  .panel.md5 h2 { background: #8b5cf6; }
  .panel.tx h2 { background: #f59e0b; }
  .stats { display: flex; gap: 8px; padding: 8px 10px; background: #0f172a; font-size: 12px; }
  .stats .item { flex: 1; text-align: center; padding: 4px; border-radius: 4px; background: #1e293b; }
  .stats .item b { display: block; font-size: 14px; margin-top: 2px; }
  .stats .tai b { color: #22c55e; }
  .stats .xiu b { color: #ef4444; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 8px; border-top: 1px solid #334155; }
  tr.start td { color: #94a3b8; font-style: italic; }
  tr.end.tai td { background: rgba(34,197,94,.10); }
  tr.end.xiu td { background: rgba(239,68,68,.10); }
  .tai { color: #22c55e; font-weight: bold; }
  .xiu { color: #ef4444; font-weight: bold; }
  .md5hash { font-family: monospace; font-size: 11px; color: #94a3b8; word-break: break-all; }
  .dice { display: inline-block; background: #334155; border-radius: 4px; padding: 2px 6px;
    font-family: monospace; font-weight: bold; margin-right: 2px; }
  .empty { text-align: center; padding: 30px; color: #64748b; font-style: italic; }
</style>
</head>
<body>
  <h1>🎲 TÀI XỈU REALTIME</h1>
  <div class="api-links">
    <a href="/api/md5" target="_blank">/api/md5</a>
    <a href="/api/tx" target="_blank">/api/tx</a>
    <a href="/api/all" target="_blank">/api/all</a>
    <a href="/api/signal" target="_blank">/api/signal</a>
    <a href="/api/status" target="_blank">/api/status</a>
  </div>
  <div class="toolbar">
    <input id="search" placeholder="Tìm mã phiên...">
    <button onclick="clearAll()">🗑 Clear</button>
  </div>
  <div class="status"><span class="dot"></span><span id="conn">Đang kết nối...</span>
    | MD5: <b id="countMd5">0</b> | Thường: <b id="countTx">0</b></div>

  <div class="grid">
    <div class="panel md5">
      <h2>🔮 TÀI XỈU MD5</h2>
      <div class="stats" id="statsMd5">
        <div class="item tai">TÀI<b>-</b></div>
        <div class="item xiu">XỈU<b>-</b></div>
        <div class="item">Tỷ lệ<b>-</b></div>
      </div>
      <div style="max-height: 70vh; overflow-y: auto;">
        <table><tbody id="bodyMd5"><tr><td class="empty">Chưa có dữ liệu...</td></tr></tbody></table>
      </div>
    </div>
    <div class="panel tx">
      <h2>💰 TÀI XỈU THƯỜNG</h2>
      <div class="stats" id="statsTx">
        <div class="item tai">TÀI<b>-</b></div>
        <div class="item xiu">XỈU<b>-</b></div>
        <div class="item">Tỷ lệ<b>-</b></div>
      </div>
      <div style="max-height: 70vh; overflow-y: auto;">
        <table><tbody id="bodyTx"><tr><td class="empty">Chưa có dữ liệu...</td></tr></tbody></table>
      </div>
    </div>
  </div>

<script src="/socket.io/socket.io.js"></script>
<script>
  const socket = io();
  const rows = { md5: [], tx: [] };

  socket.on('connect', () => document.getElementById('conn').textContent = 'Đang nhận realtime');
  socket.on('disconnect', () => document.getElementById('conn').textContent = 'Mất kết nối');

  socket.on('init', (data) => {
    rows.md5 = data.md5 || [];
    rows.tx = data.tx || [];
    render('md5'); render('tx');
    updateStats('md5'); updateStats('tx');
  });

  socket.on('result', ({ type, data }) => {
    rows[type].unshift(data);
    if (rows[type].length > 50) rows[type].pop();
    render(type);
    updateStats(type);
  });

  function updateStats(type) {
    const done = rows[type].filter(r => r.status === 'END').slice(0, 20);
    let tai = 0, xiu = 0;
    for (const s of done) {
      if (s.result === 'TÀI') tai++;
      else if (s.result === 'XỈU') xiu++;
    }
    const total = done.length;
    const el = document.getElementById(type === 'md5' ? 'statsMd5' : 'statsTx');
    el.querySelector('.tai b').textContent = tai;
    el.querySelector('.xiu b').textContent = xiu;
    el.querySelectorAll('.item b')[2].textContent =
      total ? tai + '/' + xiu + ' (' + (tai/total*100).toFixed(0) + '% T)' : '-';
  }

  function render(type) {
    const tbody = document.getElementById(type === 'md5' ? 'bodyMd5' : 'bodyTx');
    const filter = document.getElementById('search').value.trim();
    const list = filter ? rows[type].filter(r => String(r.matchId).includes(filter)) : rows[type];
    document.getElementById(type === 'md5' ? 'countMd5' : 'countTx').textContent = rows[type].length;

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td class="empty">Chưa có dữ liệu...</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(r => {
      if (r.status === 'START') {
        return '<tr class="start"><td>#' + r.matchId + '</td><td>BẮT ĐẦU</td>' +
          '<td colspan="3">' + (r.md5 ? 'MD5: ' + r.md5.substring(0,20) + '...' : 'Đang chờ kết quả...') + '</td></tr>';
      }
      const cls = r.result === 'TÀI' ? 'tai' : 'xiu';
      const d = r.dice.split('-');
      return '<tr class="end ' + cls + '">' +
        '<td><b>#' + r.matchId + '</b></td>' +
        '<td><span class="dice">' + d[0] + '</span>' +
            '<span class="dice">' + d[1] + '</span>' +
            '<span class="dice">' + d[2] + '</span></td>' +
        '<td>' + r.sum + '</td>' +
        '<td class="' + cls + '">' + r.result + '</td>' +
        '<td class="md5hash">' + (r.md5 ? r.md5.substring(0,16) + '...' : '') + '</td></tr>';
    }).join('');
  }

  document.getElementById('search').addEventListener('input', () => { render('md5'); render('tx'); });
  function clearAll() { rows.md5 = []; rows.tx = []; render('md5'); render('tx'); }
</script>
</body>
</html>`;

app.get('/', (req, res) => res.send(HTML_PAGE));

io.on('connection', (socket) => {
  socket.emit('init', {
    md5: sessions.md5.slice(0, MAX_HISTORY).map(s => ({
      status: 'END', matchId: s.matchId, dice: s.dice, sum: s.sum,
      result: s.result, md5: s.md5, time: s.time
    })),
    tx: sessions.tx.slice(0, MAX_HISTORY).map(s => ({
      status: 'END', matchId: s.matchId, dice: s.dice, sum: s.sum,
      result: s.result, md5: s.md5, time: s.time
    }))
  });
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log('🌐 Web + API đang chạy:');
  console.log(`   - Web:        http://161.248.4.235:${HTTP_PORT}`);
  console.log(`   - API MD5:    http://161.248.4.235:${HTTP_PORT}/api/md5`);
  console.log(`   - API TX:     http://161.248.4.235:${HTTP_PORT}/api/tx`);
  console.log(`   - API ALL:    http://161.248.4.235:${HTTP_PORT}/api/all`);
  console.log(`   - API SIGNAL: http://161.248.4.235:${HTTP_PORT}/api/signal`);
  console.log(`   - API STATUS: http://161.248.4.235:${HTTP_PORT}/api/status`);
});

// ============ PUSH ============
function pushStart(type, data) {
  pending[type] = data;
  io.emit('result', { type, data: { status: 'START', ...data } });
}

function pushEnd(type, data) {
  sessions[type].unshift(data);
  if (sessions[type].length > MAX_HISTORY) sessions[type].pop();
  pending[type] = null;
  io.emit('result', { type, data: { status: 'END', ...data } });
}

// ============ WEBSOCKET CLIENT ============
console.log(`🚀 Khởi động tool. Server: ${WSS_URL}`);

const options = {
  headers: {
    'Origin': 'https://68gbvn88.bar',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  },
  handshakeTimeout: 15000
};

let ws = null;
let currentMd5MatchId = '???';
let currentTxMatchId = '???';
let pingInterval = null;
let watchdogInterval = null;
let reloginInterval = null;
let isAlive = false;
let reconnectAttempts = 0;
let consecutiveFailures = 0;
let reconnectTimer = null;
let sessionSeq = 0;
const processStartTime = Date.now();
let lastConnectedAt = null;
let lastDisconnectedAt = null;
let lastMessageAt = null;
let lastLoginAt = null;
let totalReconnects = 0;
let cooldownUntil = 0;

const handshakeHex = "010000727b22737973223a7b22706c6174666f726d223a226a732d776562736f636b6574222c22636c69656e744275696c644e756d626572223a22302e302e31222c22636c69656e7456657273696f6e223a223061323134383164373436663932663834323865316236646565623736666561227d7d";
const handshakeBuffer = Buffer.from(handshakeHex, 'hex');
const handshakeAckBuffer = Buffer.from([0x02, 0x00, 0x00, 0x00]);
const loginHex = "0400004d01040001080210ca011a40373537626233613938353539346563356133303764333537343666366565626138356432373862336536373634343061626265393239383531316535393537624200";
const loginBuffer = Buffer.from(loginHex, 'hex');
const joinRoomHex = "040000250005226d6e6d6473622e6d6e6d64736268616e646c65722e656e74657267616d65726f6f6d";
const joinRoomBuffer = Buffer.from(joinRoomHex, 'hex');
const joinRoomTxHex = "0400002b0006286d6e7368616962616f2e6d6e7368616962616f68616e646c65722e656e74657267616d65726f6f6d";
const joinRoomTxBuffer = Buffer.from(joinRoomTxHex, 'hex');
let currentReqId = 6;
const heartbeatBuffer = Buffer.from([0x03, 0x00, 0x00, 0x00]);

function decodeRawProtobuf(buffer) {
  let offset = 0;
  let result = {};
  function readVarint() {
    let value = 0n, shift = 0n;
    while (offset < buffer.length) {
      let b = buffer[offset++];
      value |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7n;
    }
    return value;
  }
  while (offset < buffer.length) {
    try {
      let tag = readVarint();
      let wireType = Number(tag & 7n);
      let fieldNumber = Number(tag >> 3n);
      if (wireType === 0) {
        let val = readVarint().toString();
        if (result[fieldNumber]) result[fieldNumber] += ',' + val;
        else result[fieldNumber] = val;
      } else if (wireType === 1) {
        offset += 8; result[fieldNumber] = "(Số 64-bit)";
      } else if (wireType === 2) {
        let length = Number(readVarint());
        let data = buffer.slice(offset, offset + length);
        offset += length;
        let text = '';
        for (let i = 0; i < data.length; i++) {
          if (data[i] >= 32 && data[i] <= 126) text += String.fromCharCode(data[i]);
          else text += '.';
        }
        if (result[fieldNumber]) result[fieldNumber] += ' | ' + text;
        else result[fieldNumber] = text;
        result[fieldNumber + '_hex'] = data.toString('hex');
      } else if (wireType === 5) {
        offset += 4; result[fieldNumber] = "(Số 32-bit)";
      } else break;
    } catch (e) { break; }
  }
  return result;
}

// ============ HEARTBEAT ============
function startHeartbeat() {
  stopHeartbeat();
  isAlive = true;
  pingInterval = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (isAlive === false) {
      console.log('⚠️  Không nhận pong, chủ động ngắt kết nối');
      try { ws.terminate(); } catch (e) {}
      return;
    }
    isAlive = false;
    try {
      ws.ping();
      ws.send(heartbeatBuffer);
    } catch (e) {}
  }, PING_INTERVAL_MS);
}

function stopHeartbeat() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
}

// ============ WATCHDOG ============
function startWatchdog() {
  stopWatchdog();
  watchdogInterval = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!lastMessageAt) return;
    const idle = Date.now() - lastMessageAt;
    if (idle > WATCHDOG_TIMEOUT_MS) {
      console.log(`⚠️  Không nhận message nào trong ${Math.floor(idle/1000)}s → chủ động ngắt để reconnect`);
      try { ws.terminate(); } catch (e) {}
    }
  }, 30000);
}

function stopWatchdog() {
  if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
}

// ============ RE-LOGIN định kỳ ============
function startRelogin() {
  stopRelogin();
  reloginInterval = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(loginBuffer);
      lastLoginAt = Date.now();
      console.log('🔁 Re-login định kỳ (đề phòng token hết hạn)');
    } catch (e) {}
  }, RELOGIN_INTERVAL_MS);
}

function stopRelogin() {
  if (reloginInterval) { clearInterval(reloginInterval); reloginInterval = null; }
}

function cleanupTimers() {
  stopHeartbeat();
  stopWatchdog();
  stopRelogin();
}

// ============ XỬ LÝ MESSAGE ============
function handleMessage(data, sessionId) {
  if (sessionId !== sessionSeq) return;
  if (data.length === 0) return;

  lastMessageAt = Date.now();

  if (DEBUG_ALL_MESSAGES) {
    console.log(`📥 [DEBUG] Nhận ${data.length}B: type=0x${data[0].toString(16)}`);
  }

  const type = data[0];

  if (type === 1) {
    console.log('📩 [SERVER] Handshake OK');
    try {
      ws.send(handshakeAckBuffer);
      ws.send(loginBuffer);
      lastLoginAt = Date.now();
    } catch (e) { return; }

    setTimeout(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN || sessionId !== sessionSeq) return;
      try {
        ws.send(joinRoomBuffer);
        console.log('📤 Vào bàn MD5');
      } catch (e) {}
    }, 1500);

    setTimeout(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN || sessionId !== sessionSeq) return;
      try {
        ws.send(joinRoomTxBuffer);
        console.log('📤 Vào bàn TX');
      } catch (e) {}
    }, 3000);

    startRelogin();
  }
  else if (type === 3) { /* pong cấp game */ }
  else if (type === 4) {
    const payload = data.slice(4);
    if (payload.length === 0) return;

    let offset = 0;
    const flag = payload[offset++];
    const msgType = (flag >> 1) & 0x07;
    const compressRoute = flag & 0x01;

    if (msgType === 0 || msgType === 2) {
      let m = 0;
      do { m = payload[offset++]; } while (m >= 128);
    }

    let route = '';
    if (msgType === 0 || msgType === 1 || msgType === 3) {
      if (compressRoute) {
        route = 'RouteCode_' + ((payload[offset] << 8) | payload[offset + 1]);
        offset += 2;
      } else {
        const routeLen = payload[offset++];
        route = payload.slice(offset, offset + routeLen).toString('utf8');
        offset += routeLen;
      }
    }

    if (!route || route === 'broadhallmessage' || route === 'mnsbuserbet' || route === 'mnmdsbuserbet') return;

    let prefix = route.includes('mnmdsb') ? '[MD5]' : (route.includes('mnsb') || route.includes('mnshaibao') ? '[THƯỜNG]' : '');

    try {
      const protobufData = payload.slice(offset);
      const decoded = decodeRawProtobuf(protobufData);

      for (const key in decoded) {
        let value = decoded[key];

        if (route === 'mnmdsbgamestart' && key === '2') {
          currentMd5MatchId = decoded[1] ? (decoded[1] / 2) : '???';
          console.log(`🟢 ${prefix} BẮT ĐẦU (Phiên #${currentMd5MatchId}) | MD5: ${value}`);
          pushStart('md5', { matchId: currentMd5MatchId, md5: value, time: Date.now() });
          continue;
        }

        if (route.includes('mnmdsb') && typeof value === 'string' && value.includes('{') && value.includes('}')) {
          const matchId = currentMd5MatchId;
          const md5hash = crypto.createHash('md5').update(value).digest('hex');
          const diceMatch = value.match(/\{(\d+-\d+-\d+)\}/);
          if (diceMatch) {
            const dice = diceMatch[1].split('-');
            const sum = parseInt(dice[0]) + parseInt(dice[1]) + parseInt(dice[2]);
            const tx = sum >= 11 ? 'TÀI' : 'XỈU';
            console.log(`🔴 ${prefix} KẾT THÚC (Phiên #${matchId}) | 🎲 ${dice[0]}-${dice[1]}-${dice[2]} (${sum}: ${tx})`);
            pushEnd('md5', {
              matchId, dice: dice.join('-'), sum,
              result: tx, md5: md5hash, time: Date.now()
            });
          }
        }

        if (route === 'mnsbgamestart') {
          const nextMatchId = currentTxMatchId !== '???' ? (parseInt(currentTxMatchId) + 1) : '???';
          console.log(`🟢 ${prefix} BẮT ĐẦU (Phiên #${nextMatchId})`);
          pushStart('tx', { matchId: nextMatchId, time: Date.now() });
          break;
        }

        if (route === 'mnsbgameend' && key === '1_hex') {
          if (value.length === 6) {
            const matchId = decoded[5] || '???';
            currentTxMatchId = matchId;
            const d1 = parseInt(value.substring(0, 2), 16) / 2;
            const d2 = parseInt(value.substring(2, 4), 16) / 2;
            const d3 = parseInt(value.substring(4, 6), 16) / 2;
            const sum = d1 + d2 + d3;
            const tx = sum >= 11 ? 'TÀI' : 'XỈU';
            console.log(`🔴 ${prefix} KẾT THÚC (Phiên #${matchId}) | 🎲 ${d1}-${d2}-${d3} (${sum}: ${tx})`);
            pushEnd('tx', {
              matchId, dice: `${d1}-${d2}-${d3}`, sum,
              result: tx, md5: null, time: Date.now()
            });
          }
        }
      }
    } catch (e) { }

    if (route.endsWith('gameend')) {
      setTimeout(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN || sessionId !== sessionSeq) return;
        currentReqId++;
        if (currentReqId > 127) currentReqId = 5;
        try {
          if (route.includes('mnmdsb')) {
            joinRoomBuffer[5] = currentReqId;
            ws.send(joinRoomBuffer);
          } else {
            joinRoomTxBuffer[5] = currentReqId;
            ws.send(joinRoomTxBuffer);
          }
        } catch (e) {}
      }, 2000);
    }
  }
}

// ============ CONNECT ============
function connect() {
  sessionSeq++;
  const thisSession = sessionSeq;

  console.log(`\n🔌 [Session ${thisSession}] Đang kết nối tới ${WSS_URL}...`);
  lastConnectedAt = null;
  lastMessageAt = null;

  try {
    ws = new WebSocket(WSS_URL, options);
  } catch (e) {
    console.error('❌ Không tạo được WebSocket:', e.message);
    scheduleReconnect();
    return;
  }

  const openedAt = { t: 0 };

  ws.on('open', function open() {
    if (thisSession !== sessionSeq) return;
    openedAt.t = Date.now();
    console.log(`✅ [Session ${thisSession}] Đã kết nối WSS!`);
    lastConnectedAt = openedAt.t;
    lastMessageAt = openedAt.t;
    isAlive = true;

    // Bật TCP keepalive (30s) để giữ NAT/firewall không drop
    try {
      if (ws._socket && typeof ws._socket.setKeepAlive === 'function') {
        ws._socket.setKeepAlive(true, TCP_KEEPALIVE_MS);
        // Giảm timeout TCP_USER_TIMEOUT (Linux) — không có trên Windows
        if (typeof ws._socket.setNoDelay === 'function') ws._socket.setNoDelay(true);
        console.log(`🔧 Đã bật TCP keepalive ${TCP_KEEPALIVE_MS/1000}s`);
      }
    } catch (e) {}

    try { ws.send(handshakeBuffer); } catch (e) {}
    startHeartbeat();
    startWatchdog();
  });

  ws.on('pong', () => {
    if (thisSession !== sessionSeq) return;
    isAlive = true;
  });

  ws.on('message', (data) => {
    if (thisSession !== sessionSeq) return;
    handleMessage(data, thisSession);
  });

  ws.on('close', function close(code, reason) {
    if (thisSession !== sessionSeq) return;

    const lived = openedAt.t ? Date.now() - openedAt.t : 0;
    const livedSec = (lived / 1000).toFixed(1);
    const idleSec = lastMessageAt ? Math.floor((Date.now() - lastMessageAt) / 1000) : null;
    console.log(`\n🔴 [Session ${thisSession}] Ngắt kết nối sau ${livedSec}s (idle ${idleSec}s). Code: ${code}, Lý do: ${reason || '(không có)'}`);
    lastDisconnectedAt = Date.now();
    cleanupTimers();

    if (lived > STABLE_CONNECTION_MS) {
      reconnectAttempts = 0;
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
    }

    scheduleReconnect();
  });

  ws.on('error', function error(err) {
    if (thisSession !== sessionSeq) return;
    console.error(`❌ [Session ${thisSession}] Lỗi WebSocket: ${err.message}`);
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  const now = Date.now();

  if (cooldownUntil > now) {
    const waitMs = cooldownUntil - now;
    console.log(`⏸️  Đang trong thời gian nghỉ, còn ${Math.ceil(waitMs/1000)}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, waitMs);
    return;
  }

  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    cooldownUntil = now + FAILURE_COOLDOWN_MS;
    consecutiveFailures = 0;
    console.log(`🛑 Thất bại ${MAX_CONSECUTIVE_FAILURES} lần liên tiếp. Nghỉ ${FAILURE_COOLDOWN_MS/60000} phút.`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, FAILURE_COOLDOWN_MS);
    return;
  }

  const delay = Math.min(RECONNECT_MIN_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
  reconnectAttempts++;
  totalReconnects++;

  console.log(`🔄 Sẽ kết nối lại sau ${(delay/1000).toFixed(1)}s (lần ${reconnectAttempts}, fail liên tiếp: ${consecutiveFailures})...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

// ============ START ============
connect();

// Log trạng thái mỗi 5 phút
setInterval(() => {
  const state = ws ? ['CONNECTING','OPEN','CLOSING','CLOSED'][ws.readyState] : 'NULL';
  const upMin = Math.floor((Date.now() - processStartTime) / 60000);
  const idleSec = lastMessageAt ? Math.floor((Date.now() - lastMessageAt) / 1000) : '-';
  console.log(`⏱️  [${upMin}p] WS=${state} | Session=${sessionSeq} | Reconnect=${totalReconnects} | Fail liên tiếp=${consecutiveFailures} | Idle=${idleSec}s | MD5=${sessions.md5.length} | TX=${sessions.tx.length}`);
}, 5 * 60 * 1000);

process.on('uncaughtException', (err) => {
  console.error('💥 uncaughtException:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('💥 unhandledRejection:', err && err.message ? err.message : err);
});
