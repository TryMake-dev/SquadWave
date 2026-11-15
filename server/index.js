const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
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

// Создание таблиц
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
    type TEXT NOT NULL, -- 'text' | 'voice'
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

// Создание дефолтного сервера если БД пустая
const serverCountRow = db.prepare("SELECT COUNT(*) as count FROM servers").get();
if (serverCountRow.count === 0) {
  console.log("[DB] Создание начального сервера Squad Gaming HQ...");
  const defaultServerId = "server_default_hq";
  db.prepare("INSERT INTO servers (id, name, icon, owner_id, created_at) VALUES (?, ?, ?, ?, ?)").run(
    defaultServerId,
    "Squad Gaming HQ",
    "⚡",
    "system",
    Date.now()
  );

  const defaultChannels = [
    { id: "ch_general", name: "general-chat", type: "text" },
    { id: "ch_clips", name: "clips-and-screenshots", type: "text" },
    { id: "ch_patch", name: "patch-notes", type: "text" },
    { id: "ch_voice_raid", name: "Рейд войс [Pion SFU]", type: "voice" },
    { id: "ch_voice_chill", name: "Чилл & Музыка 128k", type: "voice" },
    { id: "ch_voice_duo", name: "Duo Arena", type: "voice" },
  ];

  for (const ch of defaultChannels) {
    db.prepare("INSERT INTO channels (id, server_id, name, type, created_at) VALUES (?, ?, ?, ?, ?)").run(
      ch.id,
      defaultServerId,
      ch.name,
      ch.type,
      Date.now()
    );
  }
}

// Хеширование паролей
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateToken(userId) {
  return Buffer.from(JSON.stringify({ userId, exp: Date.now() + 7 * 24 * 3600 * 1000 })).toString("base64");
}

function parseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    const raw = Buffer.from(authHeader.slice(7), "base64").toString("utf-8");
    const data = JSON.parse(raw);
    if (data.exp < Date.now()) return null;
    return data.userId;
  } catch (e) {
    return null;
  }
}

// ==========================================
// 2. HTTP Сервер и REST API
// ==========================================
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Чтение тела запроса
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

  // --- API: Регистрация ---
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

      // Автоматически добавляем во все серверы
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

  // --- API: Вход ---
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

  // --- API: Проверка текущего пользователя (/api/auth/me) ---
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

  // --- API: Список серверов ---
  if (req.method === "GET" && url.pathname === "/api/servers") {
    const servers = db.prepare("SELECT * FROM servers ORDER BY created_at ASC").all();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ servers }));
    return;
  }

  // --- API: Создать сервер ---
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

      // Дефолтные каналы
      const generalTextId = "ch_" + crypto.randomBytes(6).toString("hex");
      const generalVoiceId = "ch_" + crypto.randomBytes(6).toString("hex");
      db.prepare("INSERT INTO channels (id, server_id, name, type, created_at) VALUES (?, ?, 'general-chat', 'text', ?)").run(generalTextId, serverId, Date.now());
      db.prepare("INSERT INTO channels (id, server_id, name, type, created_at) VALUES (?, ?, 'Рейд войс [Pion SFU]', 'voice', ?)").run(generalVoiceId, serverId, Date.now());

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ server: { id: serverId, name, icon: icon || name[0], owner_id: userId } }));
    });
    return;
  }

  // --- API: Каналы сервера (/api/servers/:id/channels) ---
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

  // --- API: Сообщения канала (/api/channels/:id/messages) ---
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

        // Трансляция сообщения через WebSocket
        broadcastToChannel(channelId, msgPayload);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(msgPayload));
      });
      return;
    }
  }

  // --- Раздача статики (React PWA) ---
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

// Хранилище подключений: clientId -> { ws, userId, user, currentVoiceChannel }
const clients = new Map();
// Voice rooms: channelId -> Set(clientId)
const voiceRooms = new Map();

function broadcastToChannel(channelId, data) {
  const jsonStr = JSON.stringify(data);
  for (const [clientId, client] of clients.entries()) {
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

  const clientInfo = { ws, userId: user ? user.id : null, user, currentVoiceChannel: null };
  clients.set(clientId, clientInfo);

  console.log(`[WS] Клиент подключен: ${clientId} (${user ? user.display_name : "гость"})`);

  // Отправляем клиенту его собственный ID
  ws.send(JSON.stringify({ type: "init", clientId, user }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);

      switch (msg.type) {
        // --- 1. Вход в голосовую комнату ---
        case "voice_join": {
          const { channelId } = msg;
          if (!channelId) return;

          // Покидаем старую комнату если были
          if (clientInfo.currentVoiceChannel) {
            leaveVoiceRoom(clientId, clientInfo.currentVoiceChannel);
          }

          if (!voiceRooms.has(channelId)) {
            voiceRooms.set(channelId, new Set());
          }
          const room = voiceRooms.get(channelId);
          room.add(clientId);
          clientInfo.currentVoiceChannel = channelId;

          // Список существующих участников в комнате
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
                });
              }
            }
          }

          // Отправляем текущему клиенту список тех, кто уже в войсе
          ws.send(JSON.stringify({ type: "voice_room_peers", channelId, peers: peerList }));

          // Оповещаем остальных, что вошел новый участник
          broadcastToVoiceRoom(channelId, {
            type: "voice_peer_joined",
            peer: {
              clientId,
              userId: clientInfo.userId,
              display_name: clientInfo.user ? clientInfo.user.display_name : "Гость",
              avatar_color: clientInfo.user ? clientInfo.user.avatar_color : "#38bdf8",
            }
          }, clientId);

          break;
        }

        // --- 2. Выход из голосовой комнаты ---
        case "voice_leave": {
          if (clientInfo.currentVoiceChannel) {
            leaveVoiceRoom(clientId, clientInfo.currentVoiceChannel);
            clientInfo.currentVoiceChannel = null;
          }
          break;
        }

        // --- 3. WebRTC Сигналинг: Offer, Answer, ICE Candidate ---
        case "webrtc_signal": {
          const { targetClientId, signal } = msg;
          const target = clients.get(targetClientId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({
              type: "webrtc_signal",
              fromClientId: clientId,
              signal,
            }));
          }
          break;
        }

        // --- 4. Индикация речи (Speaking Status & Volume) ---
        case "voice_speaking": {
          if (clientInfo.currentVoiceChannel) {
            broadcastToVoiceRoom(clientInfo.currentVoiceChannel, {
              type: "voice_speaking",
              clientId,
              isSpeaking: msg.isSpeaking,
              volume: msg.volume || 0,
            }, clientId);
          }
          break;
        }
      }
    } catch (e) {
      console.error("[WS] Ошибка обработки сообщения:", e);
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
  if (room.size === 0) {
    voiceRooms.delete(channelId);
  }
  broadcastToVoiceRoom(channelId, { type: "voice_peer_left", clientId });
}

// Запуск сервера
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 [SquadWave Server] Запущен на http://0.0.0.0:${PORT}`);
  console.log(`💾 [SQLite] База данных готова к работе`);
  console.log(`📡 [WebSockets] Сигналинг WebRTC и живой чат активны`);
});
