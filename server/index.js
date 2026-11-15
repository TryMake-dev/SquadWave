const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, "squadwave.db");
const WEB_DIST = path.join(__dirname, "../web/dist");

// ==========================================
// 1. Инициализация базы данных SQLite
// ==========================================
console.log(`[DB] Подключение к SQLite базе: ${DB_PATH}`);
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS server_members (
    server_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (server_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);



const JWT_SECRET = process.env.JWT_SECRET || "squadwave_secret_key_change_me_in_production";

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateToken(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 7 * 24 * 3600 * 1000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function parseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length === 2) {
    const [payloadB64, signature] = parts;
    const expectedSig = crypto.createHmac("sha256", JWT_SECRET).update(payloadB64).digest("base64url");
    if (signature === expectedSig) {
      try {
        const data = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
        if (data.exp >= Date.now()) return data.userId;
      } catch {}
    }
  }
  // Совместимость с legacy базовыми токенами
  try {
    const raw = Buffer.from(token, "base64").toString("utf-8");
    const data = JSON.parse(raw);
    if (data.exp >= Date.now()) return data.userId;
  } catch {}
  return null;
}

// ==========================================
// 2. HTTP Сервер и REST API
// ==========================================
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  const readJsonBody = (cb) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        cb(JSON.parse(body || "{}"));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  };

  // Регистрация
  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    readJsonBody((body) => {
      const { username, password, display_name } = body;
      if (!username || !password) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Укажите имя пользователя и пароль" }));
        return;
      }

      const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username.toLowerCase().trim());
      if (existing) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Пользователь с таким именем уже существует" }));
        return;
      }

      const colors = ["#bef264", "#38bdf8", "#a855f7", "#f59e0b", "#ec4899", "#10b981"];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      const userId = "usr_" + crypto.randomBytes(6).toString("hex");

      db.prepare(`
        INSERT INTO users (id, username, display_name, password_hash, avatar_color, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        username.toLowerCase().trim(),
        display_name || username.trim(),
        hashPassword(password),
        randomColor,
        Date.now()
      );

      const allServers = db.prepare("SELECT id FROM servers").all();
      for (const s of allServers) {
        db.prepare("INSERT OR IGNORE INTO server_members (server_id, user_id, role) VALUES (?, ?, 'member')").run(s.id, userId);
      }

      const token = generateToken(userId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        token,
        user: { id: userId, username, display_name: display_name || username, avatar_color: randomColor }
      }));
    });
    return;
  }

  // Вход
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    readJsonBody((body) => {
      const { username, password } = body;
      if (!username || !password) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Укажите имя пользователя и пароль" }));
        return;
      }

      const user = db.prepare("SELECT id, username, display_name, avatar_color, password_hash FROM users WHERE username = ?").get(username.toLowerCase().trim());
      if (!user || user.password_hash !== hashPassword(password)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Неверный логин или пароль" }));
        return;
      }

      const token = generateToken(user.id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        token,
        user: { id: user.id, username: user.username, display_name: user.display_name, avatar_color: user.avatar_color }
      }));
    });
    return;
  }

  // Проверка сессии
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const userId = parseToken(req.headers.authorization);
    if (!userId) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const user = db.prepare("SELECT id, username, display_name, avatar_color FROM users WHERE id = ?").get(userId);
    if (!user) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "User not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ user }));
    return;
  }

  // Серверы
  if (req.method === "GET" && url.pathname === "/api/servers") {
    const servers = db.prepare("SELECT * FROM servers ORDER BY created_at ASC").all();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ servers }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/servers") {
    const userId = parseToken(req.headers.authorization);
    if (!userId) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    readJsonBody((body) => {
      const { name, icon } = body;
      if (!name) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Name is required" }));
        return;
      }

      const serverId = "srv_" + crypto.randomBytes(6).toString("hex");
      db.prepare("INSERT INTO servers (id, name, icon, owner_id, created_at) VALUES (?, ?, ?, ?, ?)").run(
        serverId,
        name.trim(),
        icon || name.trim()[0].toUpperCase(),
        userId,
        Date.now()
      );

      db.prepare("INSERT INTO server_members (server_id, user_id, role) VALUES (?, ?, 'owner')").run(serverId, userId);

      const generalTextId = "ch_" + crypto.randomBytes(6).toString("hex");
      const generalVoiceId = "ch_" + crypto.randomBytes(6).toString("hex");
      db.prepare("INSERT INTO channels (id, server_id, name, type, created_at) VALUES (?, ?, 'general-chat', 'text', ?)").run(generalTextId, serverId, Date.now());
      db.prepare("INSERT INTO channels (id, server_id, name, type, created_at) VALUES (?, ?, 'Рейд войс [Pion SFU]', 'voice', ?)").run(generalVoiceId, serverId, Date.now());

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ server: { id: serverId, name, icon: icon || name[0], owner_id: userId } }));
    });
    return;
  }

  // Удаление сервера
  const serverDeleteMatch = url.pathname.match(/^\/api\/servers\/([^/]+)$/);
  if (serverDeleteMatch && req.method === "DELETE") {
    const serverId = serverDeleteMatch[1];
    const userId = parseToken(req.headers.authorization);
    if (!userId) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    db.prepare("DELETE FROM servers WHERE id = ?").run(serverId);
    db.prepare("DELETE FROM channels WHERE server_id = ?").run(serverId);
    db.prepare("DELETE FROM server_members WHERE server_id = ?").run(serverId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, serverId }));
    return;
  }

  // Каналы
  const channelsMatch = url.pathname.match(/^\/api\/servers\/([^/]+)\/channels$/);
  if (channelsMatch) {
    const serverId = channelsMatch[1];
    if (req.method === "GET") {
      const channels = db.prepare("SELECT * FROM channels WHERE server_id = ? ORDER BY type DESC, created_at ASC").all(serverId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ channels }));
      return;
    }

    if (req.method === "POST") {
      const userId = parseToken(req.headers.authorization);
      if (!userId) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      readJsonBody((body) => {
        const { name, type } = body;
        if (!name) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Name is required" }));
          return;
        }

        const channelId = "ch_" + crypto.randomBytes(6).toString("hex");
        db.prepare("INSERT INTO channels (id, server_id, name, type, created_at) VALUES (?, ?, ?, ?, ?)").run(
          channelId,
          serverId,
          name.trim(),
          type === "voice" ? "voice" : "text",
          Date.now()
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ channel: { id: channelId, server_id: serverId, name: name.trim(), type: type === "voice" ? "voice" : "text" } }));
      });
      return;
    }
  }

  // Сообщения
  const messagesMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/messages$/);
  if (messagesMatch) {
    const channelId = messagesMatch[1];

    if (req.method === "GET") {
      const messages = db.prepare(`
        SELECT m.id, m.content, m.created_at, u.id as user_id, u.display_name, u.avatar_color
        FROM messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.channel_id = ?
        ORDER BY m.created_at ASC
        LIMIT 100
      `).all(channelId);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages }));
      return;
    }

    if (req.method === "POST") {
      const userId = parseToken(req.headers.authorization);
      if (!userId) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      readJsonBody((body) => {
        const { content } = body;
        if (!content || !content.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Message content cannot be empty" }));
          return;
        }

        const messageId = "msg_" + crypto.randomBytes(6).toString("hex");
        const timestamp = Date.now();
        db.prepare("INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)").run(
          messageId,
          channelId,
          userId,
          content.trim(),
          timestamp
        );

        const user = db.prepare("SELECT id, display_name, avatar_color FROM users WHERE id = ?").get(userId);

        const msgPayload = {
          type: "chat_message",
          message: {
            id: messageId,
            channel_id: channelId,
            content: content.trim(),
            created_at: timestamp,
            user_id: user.id,
            display_name: user.display_name,
            avatar_color: user.avatar_color,
          }
        };

        broadcastToChannel(channelId, msgPayload);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(msgPayload));
      });
      return;
    }
  }

  // Статика React PWA
  if (fs.existsSync(WEB_DIST)) {
    let filePath = path.join(WEB_DIST, url.pathname === "/" ? "index.html" : url.pathname);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(WEB_DIST, "index.html");
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    };

    const contentType = mimeTypes[ext] || "application/octet-stream";
    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500);
        res.end("Internal Server Error");
        return;
      }
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Endpoint not found" }));
});

// ==========================================
// 3. WebSocket Сервер: Чат и WebRTC сигналинг
// ==========================================
const wss = new WebSocketServer({ server });

const clients = new Map();
const voiceRooms = new Map();
const roomScreenSharers = new Map(); // channelId -> Map<clientId, { clientId, sharerName }>

function getLocalIpAddresses() {
  const ips = ["127.0.0.1"];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return Array.from(new Set(ips));
}

function broadcastToAll(data) {
  const jsonStr = JSON.stringify(data);
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(jsonStr);
    }
  }
}

function getAllVoiceStates() {
  const states = {};
  for (const [channelId, clientSet] of voiceRooms.entries()) {
    const list = [];
    for (const cId of clientSet) {
      const cl = clients.get(cId);
      if (cl) {
        list.push({
          clientId: cId,
          userId: cl.userId,
          display_name: cl.user ? cl.user.display_name : "Гость",
          avatar_color: cl.user ? cl.user.avatar_color : "#bef264",
          isMuted: cl.isMuted || false,
          isDeafened: cl.isDeafened || false,
          isSpeaking: cl.isSpeaking || false,
        });
      }
    }
    if (list.length > 0) {
      states[channelId] = list;
    }
  }
  return states;
}

function broadcastToChannel(channelId, data) {
  const jsonStr = JSON.stringify(data);
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(jsonStr);
    }
  }
}

function broadcastToVoiceRoom(channelId, data, excludeClientId = null) {
  const room = voiceRooms.get(channelId);
  if (!room) return;
  const jsonStr = JSON.stringify(data);
  for (const clientId of room) {
    if (clientId !== excludeClientId) {
      const client = clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(jsonStr);
      }
    }
  }
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const userId = parseToken("Bearer " + token);

  const clientId = "c_" + crypto.randomBytes(6).toString("hex");

  let user = null;
  if (userId) {
    user = db.prepare("SELECT id, username, display_name, avatar_color FROM users WHERE id = ?").get(userId);
  }

  const clientInfo = { ws, userId: user ? user.id : null, user, currentVoiceChannel: null, isMuted: false, isDeafened: false, isSpeaking: false };
  clients.set(clientId, clientInfo);

  const localIps = getLocalIpAddresses();
  console.log(`[WS] Клиент подключен: ${clientId} (${user ? user.display_name : "гость"}) | Local IPs: ${localIps.join(", ")}`);
  ws.send(JSON.stringify({ type: "init", clientId, user, localIps }));
  ws.send(JSON.stringify({ type: "all_voice_states", states: getAllVoiceStates() }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);

      switch (msg.type) {
        case "voice_join": {
          const { channelId } = msg;
          if (!channelId) return;

          // Предотвращаем дублирование одного и того же пользователя из разных вкладок
          if (clientInfo.userId) {
            for (const [otherClientId, otherClient] of clients.entries()) {
              if (otherClientId !== clientId && otherClient.userId === clientInfo.userId && otherClient.currentVoiceChannel) {
                console.log(`[WS] Отключение дублирующей сессии пользователя ${clientInfo.user ? clientInfo.user.username : ""} (${otherClientId})`);
                otherClient.ws.send(JSON.stringify({ type: "voice_force_disconnect", reason: "duplicate_session" }));
                leaveVoiceRoom(otherClientId, otherClient.currentVoiceChannel);
                otherClient.currentVoiceChannel = null;
              }
            }
          }

          if (clientInfo.currentVoiceChannel) {
            leaveVoiceRoom(clientId, clientInfo.currentVoiceChannel);
          }

          if (!voiceRooms.has(channelId)) {
            voiceRooms.set(channelId, new Set());
          }
          const room = voiceRooms.get(channelId);
          room.add(clientId);
          clientInfo.currentVoiceChannel = channelId;

          const peerList = [];
          for (const peerId of room) {
            if (peerId !== clientId) {
              const p = clients.get(peerId);
              if (p) {
                peerList.push({
                  clientId: peerId,
                  userId: p.userId,
                  display_name: p.user ? p.user.display_name : "Гость",
                  avatar_color: p.user ? p.user.avatar_color : "#38bdf8",
                  isMuted: p.isMuted || false,
                  isDeafened: p.isDeafened || false,
                  isSpeaking: p.isSpeaking || false,
                });
              }
            }
          }

          console.log(`[WS:Voice] ${clientInfo.user ? clientInfo.user.display_name : clientId} зашел в комнату ${channelId}. Участников: ${room.size}`);

          // Отправляем текущему список присутствующих
          ws.send(JSON.stringify({ type: "voice_room_peers", channelId, peers: peerList }));

          // Если в комнате уже идут стримы экрана, сообщаем новичку о каждом активном стримере
          const channelSharers = roomScreenSharers.get(channelId);
          if (channelSharers && channelSharers.size > 0) {
            for (const sharer of channelSharers.values()) {
              ws.send(JSON.stringify({
                type: "screen_share_status",
                clientId: sharer.clientId,
                isSharing: true,
                sharerName: sharer.sharerName
              }));
            }
          }

          // Оповещаем остальных в комнате, что подключился новый пир
          broadcastToVoiceRoom(channelId, {
            type: "voice_peer_joined",
            peer: {
              clientId,
              userId: clientInfo.userId,
              display_name: clientInfo.user ? clientInfo.user.display_name : "Гость",
              avatar_color: clientInfo.user ? clientInfo.user.avatar_color : "#38bdf8",
              isMuted: clientInfo.isMuted || false,
              isDeafened: clientInfo.isDeafened || false,
              isSpeaking: false,
            }
          }, clientId);

          // Оповещаем ВСЕХ на сервере об обновлении списка участников канала (для отображения в сайдбаре как в Discord!)
          const allRoomPeers = [];
          for (const pid of room) {
            const pinfo = clients.get(pid);
            if (pinfo) {
              allRoomPeers.push({
                clientId: pid,
                userId: pinfo.userId,
                display_name: pinfo.user ? pinfo.user.display_name : "Гость",
                avatar_color: pinfo.user ? pinfo.user.avatar_color : "#bef264",
                isMuted: pinfo.isMuted || false,
                isDeafened: pinfo.isDeafened || false,
                isSpeaking: pinfo.isSpeaking || false,
              });
            }
          }
          broadcastToAll({ type: "voice_channel_state", channelId, peers: allRoomPeers });
          break;
        }

        case "voice_leave": {
          if (clientInfo.currentVoiceChannel) {
            leaveVoiceRoom(clientId, clientInfo.currentVoiceChannel);
            clientInfo.currentVoiceChannel = null;
          }
          break;
        }

        // WebRTC Signaling: Offer, Answer, ICE
        case "webrtc_signal": {
          const { targetClientId, signal } = msg;
          const target = clients.get(targetClientId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            console.log(`[WS:Signal] ${clientId} -> ${targetClientId}: ${signal?.type || (signal?.candidate ? 'ice' : 'unknown')}`);

            // Надежный роутинг ICE кандидатов и SDP:
            // Chromium заменяет локальные IP на <uuid>.local. Для 100% стабильного P2P соединения
            // на localhost и внутри локальной сети, генерируем также прямые 127.0.0.1 кандидаты
            let forwardedSignal = signal;
            if (signal) {
              if (signal.sdp && typeof signal.sdp === "string" && signal.sdp.includes(".local")) {
                forwardedSignal = {
                  ...signal,
                  sdp: signal.sdp.replace(/[a-zA-Z0-9-]+\.local/g, "127.0.0.1"),
                };
              }

              if (signal.candidate && signal.candidate.candidate && signal.candidate.candidate.includes(".local")) {
                const loopbackCand = signal.candidate.candidate.replace(/[a-zA-Z0-9-]+\.local/, "127.0.0.1");
                target.ws.send(JSON.stringify({
                  type: "webrtc_signal",
                  fromClientId: clientId,
                  signal: {
                    type: "ice",
                    candidate: {
                      ...signal.candidate,
                      candidate: loopbackCand,
                    },
                  },
                }));
              }
            }

            target.ws.send(JSON.stringify({
              type: "webrtc_signal",
              fromClientId: clientId,
              signal: forwardedSignal,
            }));
          } else {
            console.warn(`[WebRTC] Target ${targetClientId} not found or closed`);
          }
          break;
        }

        // Состояние микрофона (заглушен / включен)
        case "voice_mute_state": {
          clientInfo.isMuted = !!msg.isMuted;
          if (clientInfo.currentVoiceChannel) {
            broadcastToVoiceRoom(clientInfo.currentVoiceChannel, {
              type: "voice_mute_state",
              clientId,
              userId: clientInfo.userId,
              isMuted: clientInfo.isMuted,
            }, clientId);

            // Обновляем статус микрофона для сайдбара Discord
            const currentRoom = voiceRooms.get(clientInfo.currentVoiceChannel);
            if (currentRoom) {
              const allRoomPeers = [];
              for (const pid of currentRoom) {
                const pinfo = clients.get(pid);
                if (pinfo) {
                  allRoomPeers.push({
                    clientId: pid,
                    userId: pinfo.userId,
                    display_name: pinfo.user ? pinfo.user.display_name : "Гость",
                    avatar_color: pinfo.user ? pinfo.user.avatar_color : "#bef264",
                    isMuted: pinfo.isMuted || false,
                    isDeafened: pinfo.isDeafened || false,
                    isSpeaking: pinfo.isSpeaking || false,
                  });
                }
              }
              broadcastToAll({ type: "voice_channel_state", channelId: clientInfo.currentVoiceChannel, peers: allRoomPeers });
            }
          }
          break;
        }

        // Состояние наушников (заглушен звук / включен)
        case "voice_deafen_state": {
          clientInfo.isDeafened = !!msg.isDeafened;
          if (clientInfo.currentVoiceChannel) {
            broadcastToVoiceRoom(clientInfo.currentVoiceChannel, {
              type: "voice_deafen_state",
              clientId,
              userId: clientInfo.userId,
              isDeafened: clientInfo.isDeafened,
            }, clientId);

            const currentRoom = voiceRooms.get(clientInfo.currentVoiceChannel);
            if (currentRoom) {
              const allRoomPeers = [];
              for (const pid of currentRoom) {
                const pinfo = clients.get(pid);
                if (pinfo) {
                  allRoomPeers.push({
                    clientId: pid,
                    userId: pinfo.userId,
                    display_name: pinfo.user ? pinfo.user.display_name : "Гость",
                    avatar_color: pinfo.user ? pinfo.user.avatar_color : "#bef264",
                    isMuted: pinfo.isMuted || false,
                    isDeafened: pinfo.isDeafened || false,
                    isSpeaking: pinfo.isSpeaking || false,
                  });
                }
              }
              broadcastToAll({ type: "voice_channel_state", channelId: clientInfo.currentVoiceChannel, peers: allRoomPeers });
            }
          }
          break;
        }

        // Индикация речи
        case "voice_speaking": {
          clientInfo.isSpeaking = !clientInfo.isMuted && !!msg.isSpeaking;
          if (clientInfo.currentVoiceChannel) {
            broadcastToVoiceRoom(clientInfo.currentVoiceChannel, {
              type: "voice_speaking",
              clientId,
              userId: clientInfo.userId,
              isSpeaking: clientInfo.isSpeaking,
              volume: msg.volume || 0,
            }, clientId);
          }
          break;
        }

        // Стрим экрана (уведомление о старте/стопе)
        case "screen_share_status": {
          if (clientInfo.currentVoiceChannel) {
            const chId = clientInfo.currentVoiceChannel;
            const sharerName = clientInfo.user ? clientInfo.user.display_name : "Участник";
            if (!roomScreenSharers.has(chId)) {
              roomScreenSharers.set(chId, new Map());
            }
            const channelSharers = roomScreenSharers.get(chId);
            if (msg.isSharing) {
              channelSharers.set(clientId, { clientId, sharerName });
            } else {
              channelSharers.delete(clientId);
            }
            broadcastToVoiceRoom(chId, {
              type: "screen_share_status",
              clientId,
              isSharing: msg.isSharing,
              sharerName
            }, clientId);
          }
          break;
        }

        // Живой аудио-поток по WebSocket (гарантированная доставка звука при блокировках UDP/VPN)
        case "voice_pcm": {
          if (clientInfo.currentVoiceChannel) {
            broadcastToVoiceRoom(clientInfo.currentVoiceChannel, {
              type: "voice_pcm",
              clientId,
              userId: clientInfo.userId,
              pcm: msg.pcm,
            }, clientId);
          }
          break;
        }

        // Живой стрим экрана по WebSocket (гарантированное видео без черных экранов)
        case "screen_frame": {
          if (clientInfo.currentVoiceChannel) {
            broadcastToVoiceRoom(clientInfo.currentVoiceChannel, {
              type: "screen_frame",
              clientId,
              sharerName: clientInfo.user ? clientInfo.user.display_name : "Участник",
              frame: msg.frame,
            }, clientId);
          }
          break;
        }

        // Измерение реального динамического пинга (RTT)
        case "ping": {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pong", t: msg.t }));
          }
          break;
        }
      }
    } catch (e) {
      console.error("[WS] Ошибка:", e);
    }
  });

  ws.on("close", () => {
    if (clientInfo.currentVoiceChannel) {
      leaveVoiceRoom(clientId, clientInfo.currentVoiceChannel);
    }
    clients.delete(clientId);
    console.log(`[WS] Клиент отключился: ${clientId}`);
  });
});

function leaveVoiceRoom(clientId, channelId) {
  const room = voiceRooms.get(channelId);
  if (!room) return;
  room.delete(clientId);
  const channelSharers = roomScreenSharers.get(channelId);
  if (channelSharers && channelSharers.has(clientId)) {
    channelSharers.delete(clientId);
    broadcastToVoiceRoom(channelId, { type: "screen_share_status", clientId, isSharing: false });
  }
  if (room.size === 0) {
    voiceRooms.delete(channelId);
    roomScreenSharers.delete(channelId);
  }
  broadcastToVoiceRoom(channelId, { type: "voice_peer_left", clientId });

  // Обновляем список участников комнаты для всех клиентов в сайдбаре
  const allRoomPeers = [];
  const currentRoom = voiceRooms.get(channelId);
  if (currentRoom) {
    for (const pid of currentRoom) {
      const pinfo = clients.get(pid);
      if (pinfo) {
        allRoomPeers.push({
          clientId: pid,
          userId: pinfo.userId,
          display_name: pinfo.user ? pinfo.user.display_name : "Гость",
          avatar_color: pinfo.user ? pinfo.user.avatar_color : "#bef264",
          isMuted: pinfo.isMuted || false,
          isDeafened: pinfo.isDeafened || false,
        });
      }
    }
  }
  broadcastToAll({ type: "voice_channel_state", channelId, peers: allRoomPeers });
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 [SquadWave Server] Запущен на http://0.0.0.0:${PORT}`);
  console.log(`💾 [SQLite] База данных готова к работе`);
  console.log(`📡 [WebSockets] Сигналинг WebRTC и живой чат активны`);
});
