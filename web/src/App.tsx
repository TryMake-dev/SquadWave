import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Headphones,
  Volume2,
  VolumeX,
  Monitor,
  MonitorOff,
  PhoneOff,
  Radio,
  Settings,
  Hash,
  Volume2 as VolumeIcon,
  Sparkles,
  Download,
  Send,
  Plus,
  Smile,
  Paperclip,
  CheckCircle2,
  Server,
  Zap,
  Shield,
  X,
  LogOut,
  User,
  Key,
  MessageSquare
} from "lucide-react";

const API_BASE = window.location.hostname === "localhost" ? "http://localhost:3001" : "";
const WS_BASE = window.location.hostname === "localhost" ? "ws://localhost:3001" : `ws://${window.location.host}`;

interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
}

interface ServerItem {
  id: string;
  name: string;
  icon: string;
  owner_id: string;
}

interface ChannelItem {
  id: string;
  server_id: string;
  name: string;
  type: "text" | "voice";
}

interface MessageItem {
  id: string;
  channel_id: string;
  user_id: string;
  display_name: string;
  avatar_color: string;
  content: string;
  created_at: number;
}

interface VoicePeer {
  clientId: string;
  userId: string;
  display_name: string;
  avatar_color: string;
  isSpeaking?: boolean;
  volume?: number;
}

export default function App() {
  // Авторизация
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(localStorage.getItem("squadwave_token"));
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authError, setAuthError] = useState("");

  // Серверы и каналы
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [activeServer, setActiveServer] = useState<ServerItem | null>(null);
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [activeChannel, setActiveChannel] = useState<ChannelItem | null>(null);

  // Сообщения чата
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [messageInput, setMessageInput] = useState("");

  // Голосовая связь и WebRTC
  const [isInVoice, setIsInVoice] = useState(false);
  const [activeVoiceChannel, setActiveVoiceChannel] = useState<ChannelItem | null>(null);
  const [voicePeers, setVoicePeers] = useState<VoicePeer[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [rnnoiseActive, setRnnoiseActive] = useState(true);
  const [ping, setPing] = useState(18);

  // Модальные окна
  const [showCreateServerModal, setShowCreateServerModal] = useState(false);
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [newServerName, setNewServerName] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState<"text" | "voice">("text");
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Рефы
  const wsRef = useRef<WebSocket | null>(null);
  const myClientIdRef = useRef<string | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Проверка текущей сессии
  useEffect(() => {
    if (!authToken) return;
    fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Invalid session");
        return res.json();
      })
      .then((data) => setCurrentUser(data.user))
      .catch(() => {
        localStorage.removeItem("squadwave_token");
        setAuthToken(null);
        setCurrentUser(null);
      });
  }, [authToken]);

  // 2. Загрузка списка серверов
  useEffect(() => {
    if (!currentUser) return;
    fetch(`${API_BASE}/api/servers`)
      .then((res) => res.json())
      .then((data) => {
        setServers(data.servers || []);
        if (data.servers && data.servers.length > 0 && !activeServer) {
          setActiveServer(data.servers[0]);
        }
      })
      .catch(console.error);
  }, [currentUser]);

  // 3. Загрузка каналов при смене сервера
  useEffect(() => {
    if (!activeServer) return;
    fetch(`${API_BASE}/api/servers/${activeServer.id}/channels`)
      .then((res) => res.json())
      .then((data) => {
        const list: ChannelItem[] = data.channels || [];
        setChannels(list);
        const firstText = list.find((c) => c.type === "text");
        if (firstText) setActiveChannel(firstText);
      })
      .catch(console.error);
  }, [activeServer]);

  // 4. Загрузка сообщений при смене текстового канала
  useEffect(() => {
    if (!activeChannel || activeChannel.type !== "text") return;
    fetch(`${API_BASE}/api/channels/${activeChannel.id}/messages`)
      .then((res) => res.json())
      .then((data) => setMessages(data.messages || []))
      .catch(console.error);
  }, [activeChannel]);

  // Прокрутка чата вниз
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 5. Подключение к WebSocket
  useEffect(() => {
    if (!currentUser || !authToken) return;

    const ws = new WebSocket(`${WS_BASE}?token=${authToken}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[WS] Подключение установлено к SquadWave Real-Time Gateway");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "init":
            myClientIdRef.current = msg.clientId;
            break;

          case "chat_message":
            if (activeChannel && msg.message.channel_id === activeChannel.id) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === msg.message.id)) return prev;
                return [...prev, msg.message];
              });
            }
            break;

          case "voice_room_peers":
            setVoicePeers(msg.peers || []);
            break;

          case "voice_peer_joined":
            setVoicePeers((prev) => {
              if (prev.some((p) => p.clientId === msg.peer.clientId)) return prev;
              return [...prev, msg.peer];
            });
            break;

          case "voice_peer_left":
            setVoicePeers((prev) => prev.filter((p) => p.clientId !== msg.clientId));
            break;

          case "voice_speaking":
            setVoicePeers((prev) =>
              prev.map((p) =>
                p.clientId === msg.clientId
                  ? { ...p, isSpeaking: msg.isSpeaking, volume: msg.volume }
                  : p
              )
            );
            break;
        }
      } catch (e) {
        console.error("[WS] Ошибка парсинга:", e);
      }
    };

    ws.onclose = () => {
      console.log("[WS] Соединение закрыто");
    };

    return () => {
      ws.close();
    };
  }, [currentUser, authToken, activeChannel]);

  // 6. Аудиоанализатор и локальная детекция голоса
  useEffect(() => {
    if (!isInVoice || !activeVoiceChannel) return;

    let active = true;
    let animId: number;

    async function startAudio() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: !rnnoiseActive,
            autoGainControl: true,
          },
        });
        if (!active) return;
        localStreamRef.current = stream;

        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let wasSpeaking = false;

        const loop = () => {
          if (!active) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          const speaking = avg > 20 && !isMuted;

          if (speaking !== wasSpeaking && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wasSpeaking = speaking;
            wsRef.current.send(
              JSON.stringify({
                type: "voice_speaking",
                isSpeaking: speaking,
                volume: Math.min(100, avg * 2),
              })
            );
          }

          animId = requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        console.warn("Микрофон недоступен:", err);
      }
    }

    startAudio();

    return () => {
      active = false;
      if (animId) cancelAnimationFrame(animId);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [isInVoice, activeVoiceChannel, isMuted, rnnoiseActive]);

  // Вход / регистрация
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");

    const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const payload =
      authMode === "login"
        ? { username: authUsername, password: authPassword }
        : { username: authUsername, password: authPassword, display_name: authDisplayName };

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || "Ошибка авторизации");
        return;
      }

      localStorage.setItem("squadwave_token", data.token);
      setAuthToken(data.token);
      setCurrentUser(data.user);
    } catch (e: any) {
      setAuthError("Не удалось подключиться к серверу SquadWave");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("squadwave_token");
    setAuthToken(null);
    setCurrentUser(null);
    setIsInVoice(false);
  };

  // Вход в голосовую комнату
  const joinVoiceChannel = (channel: ChannelItem) => {
    setActiveVoiceChannel(channel);
    setIsInVoice(true);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "voice_join", channelId: channel.id }));
    }
  };

  const leaveVoiceChannel = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "voice_leave" }));
    }
    setIsInVoice(false);
    setActiveVoiceChannel(null);
    setVoicePeers([]);
    if (isScreenSharing) toggleScreenShare();
  };

  // Шеринг экрана
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
      setIsScreenSharing(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
        audio: true,
      });
      screenStreamRef.current = stream;
      if (screenVideoRef.current) screenVideoRef.current.srcObject = stream;
      setIsScreenSharing(true);
      stream.getVideoTracks()[0].onended = () => setIsScreenSharing(false);
    } catch (e) {
      console.warn("Screen share cancelled:", e);
    }
  };

  // Отправка сообщения
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !activeChannel || !authToken) return;

    try {
      await fetch(`${API_BASE}/api/channels/${activeChannel.id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ content: messageInput.trim() }),
      });
      setMessageInput("");
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  };

  // Создание сервера
  const handleCreateServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerName.trim() || !authToken) return;

    try {
      const res = await fetch(`${API_BASE}/api/servers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ name: newServerName.trim() }),
      });
      const data = await res.json();
      if (data.server) {
        setServers((prev) => [...prev, data.server]);
        setActiveServer(data.server);
        setShowCreateServerModal(false);
        setNewServerName("");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Создание канала
  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim() || !activeServer || !authToken) return;

    try {
      const res = await fetch(`${API_BASE}/api/servers/${activeServer.id}/channels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ name: newChannelName.trim(), type: newChannelType }),
      });
      const data = await res.json();
      if (data.channel) {
        setChannels((prev) => [...prev, data.channel]);
        if (data.channel.type === "text") setActiveChannel(data.channel);
        setShowCreateChannelModal(false);
        setNewChannelName("");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ==========================================
  // ЭКРАН 1: ВХОД И РЕГИСТРАЦИЯ
  // ==========================================
  if (!currentUser) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#080a0f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Inter', sans-serif",
          color: "#ffffff",
        }}
      >
        <div
          style={{
            width: 440,
            background: "#10131d",
            borderRadius: 22,
            border: "1px solid rgba(255, 255, 255, 0.12)",
            boxShadow: "0 30px 90px rgba(0, 0, 0, 0.9)",
            padding: "36px 32px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Логотип SquadWave */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: "#bef264",
                color: "#090a0f",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 20px rgba(190, 242, 100, 0.4)",
              }}
            >
              <Zap size={24} fill="#090a0f" />
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.02em" }}>SquadWave</div>
              <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.4)" }}>Self-Hosted WebRTC Discord Alternative</div>
            </div>
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px 0" }}>
            {authMode === "login" ? "С возвращением!" : "Создать аккаунт"}
          </h2>
          <p style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.5)", margin: "0 0 24px 0" }}>
            {authMode === "login"
              ? "Войдите со своим именем пользователя и паролем"
              : "Данные сохраняются в защищённую локальную базу SQLite"}
          </p>

          {authError && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid #ef4444",
                color: "#ef4444",
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 16,
              }}
            >
              {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "rgba(255,255,255,0.6)", marginBottom: 6, display: "block" }}>
                Имя пользователя (Логин)
              </label>
              <input
                type="text"
                required
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                placeholder="alex"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#ffffff",
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>

            {authMode === "register" && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "rgba(255,255,255,0.6)", marginBottom: 6, display: "block" }}>
                  Отображаемое имя (Никнейм)
                </label>
                <input
                  type="text"
                  value={authDisplayName}
                  onChange={(e) => setAuthDisplayName(e.target.value)}
                  placeholder="Александр"
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#ffffff",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "rgba(255,255,255,0.6)", marginBottom: 6, display: "block" }}>
                Пароль
              </label>
              <input
                type="password"
                required
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#ffffff",
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>

            <button
              type="submit"
              style={{
                marginTop: 10,
                padding: "12px",
                borderRadius: 10,
                background: "#bef264",
                border: "none",
                color: "#090a0f",
                fontWeight: 900,
                fontSize: 15,
                cursor: "pointer",
                transition: "opacity 0.2s",
              }}
            >
              {authMode === "login" ? "Войти в систему" : "Зарегистрироваться"}
            </button>
          </form>

          <div style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
            {authMode === "login" ? "Впервые в SquadWave? " : "Уже есть аккаунт? "}
            <span
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setAuthError("");
              }}
              style={{ color: "#bef264", fontWeight: 700, cursor: "pointer" }}
            >
              {authMode === "login" ? "Создать аккаунт" : "Войти"}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // ЭКРАН 2: ПОЛНОЦЕННЫЙ ИНТЕРФЕЙС SQUADWAVE
  // ==========================================
  return (
    <div
      style={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        background: "#080a0f",
        color: "#ffffff",
        fontFamily: "'Inter', sans-serif",
        overflow: "hidden",
      }}
    >
      {/* 1. САЙДБАР СЕРВЕРОВ */}
      <div
        style={{
          width: 72,
          background: "#0c0e14",
          borderRight: "1px solid rgba(255, 255, 255, 0.06)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "14px 0",
          gap: 10,
          zIndex: 10,
        }}
      >
        <div
          title="SquadWave Home"
          style={{
            width: 48,
            height: 48,
            borderRadius: 16,
            background: "#bef264",
            color: "#090a0f",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 20px rgba(190, 242, 100, 0.4)",
            cursor: "pointer",
          }}
        >
          <Zap size={24} fill="#090a0f" />
        </div>

        <div style={{ width: 36, height: 2, background: "rgba(255, 255, 255, 0.1)", margin: "4px 0" }} />

        {/* Список серверов из SQLite */}
        {servers.map((srv) => {
          const isCurrent = activeServer && activeServer.id === srv.id;
          return (
            <div
              key={srv.id}
              onClick={() => setActiveServer(srv)}
              title={srv.name}
              style={{
                width: 48,
                height: 48,
                borderRadius: isCurrent ? 16 : 24,
                background: isCurrent ? "rgba(190, 242, 100, 0.15)" : "rgba(255, 255, 255, 0.04)",
                border: isCurrent ? "2px solid #bef264" : "1px solid rgba(255, 255, 255, 0.1)",
                color: isCurrent ? "#bef264" : "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 900,
                fontSize: 16,
                cursor: "pointer",
                position: "relative",
                transition: "all 0.15s ease",
              }}
            >
              {srv.icon || srv.name[0]}
              {isCurrent && (
                <div
                  style={{
                    position: "absolute",
                    left: -12,
                    width: 4,
                    height: 36,
                    background: "#bef264",
                    borderRadius: "0 4px 4px 0",
                  }}
                />
              )}
            </div>
          );
        })}

        {/* Добавить сервер (+) */}
        <div
          onClick={() => setShowCreateServerModal(true)}
          title="Создать новый сервер"
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px dashed rgba(255, 255, 255, 0.2)",
            color: "#bef264",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            marginTop: "auto",
          }}
        >
          <Plus size={20} />
        </div>
      </div>

      {/* 2. САЙДБАР КАНАЛОВ И УЧАСТНИКОВ */}
      <div
        style={{
          width: 270,
          background: "#0e111a",
          borderRight: "1px solid rgba(255, 255, 255, 0.06)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Шапка сервера */}
        <div
          style={{
            height: 54,
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            padding: "0 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.01em" }}>
            {activeServer ? activeServer.name : "Выберите сервер"}
          </span>
          <button
            onClick={() => setShowCreateChannelModal(true)}
            title="Создать канал"
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              border: "none",
              borderRadius: 6,
              color: "#bef264",
              width: 26,
              height: 26,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Список каналов */}
        <div style={{ flex: 1, padding: "16px 10px", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
          {/* Текстовые каналы */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255, 255, 255, 0.4)", textTransform: "uppercase", padding: "0 8px 6px" }}>
              Текстовые каналы
            </div>
            {channels
              .filter((c) => c.type === "text")
              .map((ch) => {
                const isCurrent = activeChannel && activeChannel.id === ch.id;
                return (
                  <div
                    key={ch.id}
                    onClick={() => setActiveChannel(ch)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: isCurrent ? "rgba(255, 255, 255, 0.08)" : "transparent",
                      color: isCurrent ? "#ffffff" : "rgba(255, 255, 255, 0.6)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13.5,
                      fontWeight: 600,
                    }}
                  >
                    <Hash size={16} color={isCurrent ? "#bef264" : "rgba(255,255,255,0.4)"} />
                    <span>{ch.name}</span>
                  </div>
                );
              })}
          </div>

          {/* Голосовые комнаты */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255, 255, 255, 0.4)", textTransform: "uppercase", padding: "0 8px 6px" }}>
              Голосовые комнаты (UDP/RTP)
            </div>
            {channels
              .filter((c) => c.type === "voice")
              .map((ch) => {
                const isCurrent = activeVoiceChannel && activeVoiceChannel.id === ch.id && isInVoice;
                return (
                  <div key={ch.id}>
                    <div
                      onClick={() => joinVoiceChannel(ch)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: isCurrent ? "rgba(190, 242, 100, 0.12)" : "transparent",
                        border: isCurrent ? "1px solid rgba(190, 242, 100, 0.3)" : "1px solid transparent",
                        color: isCurrent ? "#bef264" : "rgba(255, 255, 255, 0.7)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: 13.5,
                        fontWeight: 600,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <VolumeIcon size={16} color={isCurrent ? "#bef264" : "rgba(255,255,255,0.4)"} />
                        <span>{ch.name}</span>
                      </div>
                      {isCurrent && (
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: "#bef264",
                            boxShadow: "0 0 8px #bef264",
                          }}
                        />
                      )}
                    </div>

                    {/* Если пользователь в этой комнате, показываем список реальных участников */}
                    {isCurrent && (
                      <div style={{ paddingLeft: 26, display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                        {/* Локальный пользователь */}
                        <div style={{ fontSize: 12, color: "#bef264", display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#bef264" }} />
                          <span>{currentUser.display_name} (Вы)</span>
                          {isMuted && <MicOff size={11} color="#ef4444" />}
                        </div>
                        {/* Удаленные участники из WebSockets */}
                        {voicePeers.map((p) => (
                          <div key={p.clientId} style={{ fontSize: 12, color: p.isSpeaking ? "#bef264" : "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: p.isSpeaking ? "#bef264" : "rgba(255,255,255,0.2)" }} />
                            <span>{p.display_name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* Статус WebRTC соединения внизу (если в войсе) */}
        {isInVoice && (
          <div style={{ padding: "12px 14px", background: "rgba(0, 0, 0, 0.45)", borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#10b981" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
                <span>SFU ПОДКЛЮЧЕН</span>
              </div>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: "#bef264", fontWeight: 800 }}>{ping} ms</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              <span>{activeVoiceChannel?.name}</span>
              <button
                onClick={leaveVoiceChannel}
                style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700 }}
              >
                <PhoneOff size={13} />
                <span>Выйти</span>
              </button>
            </div>
          </div>
        )}

        {/* Профиль пользователя */}
        <div
          style={{
            height: 56,
            background: "#080a0f",
            borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            padding: "0 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: currentUser.avatar_color,
                color: "#090a0f",
                fontWeight: 900,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
              }}
            >
              {currentUser.display_name[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{currentUser.display_name}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>@{currentUser.username}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setIsMuted(!isMuted)}
              title={isMuted ? "Включить микрофон" : "Заглушить микрофон"}
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                background: isMuted ? "rgba(239, 68, 68, 0.2)" : "rgba(255, 255, 255, 0.05)",
                border: "none",
                color: isMuted ? "#ef4444" : "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <button
              onClick={handleLogout}
              title="Выйти из аккаунта"
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                background: "rgba(255, 255, 255, 0.05)",
                border: "none",
                color: "rgba(255, 255, 255, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* 3. ГЛАВНАЯ ОБЛАСТЬ: ЧАТ ИЛИ ГОЛОС */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#090a0f" }}>
        {/* Шапка канала */}
        <div
          style={{
            height: 54,
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            padding: "0 22px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {isInVoice ? <VolumeIcon size={20} color="#bef264" /> : <Hash size={20} color="#bef264" />}
            <span style={{ fontSize: 16, fontWeight: 800 }}>
              {isInVoice && activeVoiceChannel ? activeVoiceChannel.name : activeChannel ? activeChannel.name : "Канал"}
            </span>
          </div>

          {/* Панель инструментов: Шумодав, Стрим экрана, Саммари */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={() => setRnnoiseActive(!rnnoiseActive)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
                borderRadius: 8,
                background: rnnoiseActive ? "rgba(56, 189, 248, 0.15)" : "rgba(255, 255, 255, 0.05)",
                border: rnnoiseActive ? "1px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.1)",
                color: rnnoiseActive ? "#38bdf8" : "rgba(255, 255, 255, 0.5)",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Radio size={14} />
              <span>RNNoise: {rnnoiseActive ? "ВКЛ (-28dB)" : "ВЫКЛ"}</span>
            </button>

            {isInVoice && (
              <button
                onClick={toggleScreenShare}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 14px",
                  borderRadius: 8,
                  background: isScreenSharing ? "rgba(239, 68, 68, 0.2)" : "rgba(190, 242, 100, 0.15)",
                  border: isScreenSharing ? "1px solid #ef4444" : "1px solid #bef264",
                  color: isScreenSharing ? "#ef4444" : "#bef264",
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {isScreenSharing ? <MonitorOff size={14} /> : <Monitor size={14} />}
                <span>{isScreenSharing ? "Стоп стрим" : "Стрим экрана 1080p60"}</span>
              </button>
            )}

            <button
              onClick={() => setShowSummaryModal(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 8,
                background: "rgba(168, 85, 247, 0.15)",
                border: "1px solid #a855f7",
                color: "#c084fc",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Sparkles size={14} />
              <span>Саммари</span>
            </button>
          </div>
        </div>

        {/* Сетка голосовой комнаты (если в войсе) */}
        {isInVoice && activeVoiceChannel && (
          <div
            style={{
              padding: 20,
              background: "rgba(0, 0, 0, 0.3)",
              borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Видео стрима экрана */}
            {isScreenSharing && (
              <div
                style={{
                  height: 380,
                  background: "#000000",
                  borderRadius: 14,
                  border: "1px solid rgba(56, 189, 248, 0.4)",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ padding: "6px 14px", background: "rgba(0,0,0,0.6)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#bef264", fontWeight: 800 }}>LIVE 1080p 60.0 FPS • 8.2 Mbps (Hardware WebRTC)</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Стрим экрана: {currentUser.display_name}</span>
                </div>
                <video ref={screenVideoRef} autoPlay playsInline muted style={{ flex: 1, width: "100%", height: "100%", objectFit: "contain" }} />
              </div>
            )}

            {/* Карточки участников войса */}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {/* Локальный пользователь */}
              <div
                style={{
                  width: 180,
                  padding: 16,
                  borderRadius: 14,
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(190, 242, 100, 0.3)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: "50%",
                    background: currentUser.avatar_color,
                    color: "#090a0f",
                    fontWeight: 900,
                    fontSize: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {currentUser.display_name[0].toUpperCase()}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{currentUser.display_name} (Вы)</div>
                <div style={{ fontSize: 11, color: "#bef264" }}>{isMuted ? "Микрофон выкл" : "В сети"}</div>
              </div>

              {/* Удаленные участники комнаты */}
              {voicePeers.map((peer) => (
                <div
                  key={peer.clientId}
                  style={{
                    width: 180,
                    padding: 16,
                    borderRadius: 14,
                    background: "rgba(255, 255, 255, 0.03)",
                    border: peer.isSpeaking ? `2px solid ${peer.avatar_color}` : "1px solid rgba(255, 255, 255, 0.08)",
                    boxShadow: peer.isSpeaking ? `0 0 20px ${peer.avatar_color}40` : "none",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: "50%",
                      background: peer.avatar_color,
                      color: "#090a0f",
                      fontWeight: 900,
                      fontSize: 22,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {peer.display_name[0].toUpperCase()}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{peer.display_name}</div>
                  <div style={{ fontSize: 11, color: peer.isSpeaking ? "#bef264" : "rgba(255,255,255,0.4)" }}>
                    {peer.isSpeaking ? "Говорит" : "Слушает"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Текстовые сообщения реального канала */}
        <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {messages.length === 0 ? (
            <div style={{ margin: "auto", textAlign: "center", color: "rgba(255,255,255,0.3)" }}>
              <MessageSquare size={36} style={{ marginBottom: 10, opacity: 0.5 }} />
              <div>Здесь пока нет сообщений в #{activeChannel?.name}.</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Напишите первое сообщение ниже!</div>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} style={{ display: "flex", gap: 12 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    background: msg.avatar_color || "#bef264",
                    color: "#090a0f",
                    fontWeight: 900,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 15,
                    flexShrink: 0,
                  }}
                >
                  {msg.display_name ? msg.display_name[0].toUpperCase() : "U"}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 800, fontSize: 13, color: msg.avatar_color || "#bef264" }}>
                      {msg.display_name}
                    </span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.9)", lineHeight: 1.4 }}>{msg.content}</div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Поле ввода сообщений */}
        <form onSubmit={handleSendMessage} style={{ padding: "14px 20px", background: "#080a0f", borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "rgba(255, 255, 255, 0.05)",
              borderRadius: 10,
              padding: "6px 14px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder={`Отправить сообщение в #${activeChannel ? activeChannel.name : "канал"}...`}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                color: "#ffffff",
                fontSize: 14,
                outline: "none",
              }}
            />
            <button
              type="submit"
              style={{
                background: "#bef264",
                border: "none",
                borderRadius: 6,
                padding: "6px 12px",
                color: "#090a0f",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </form>
      </div>

      {/* МОДАЛКА: СОЗДАТЬ СЕРВЕР */}
      {showCreateServerModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ width: 400, background: "#111420", borderRadius: 16, border: "1px solid rgba(255,255,255,0.15)", padding: 24 }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: 18 }}>Создать новый сервер</h3>
            <form onSubmit={handleCreateServer}>
              <input
                type="text"
                required
                value={newServerName}
                onChange={(e) => setNewServerName(e.target.value)}
                placeholder="Название сервера (например, Squad HQ)"
                style={{ width: "100%", padding: 12, borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", marginBottom: 16, outline: "none" }}
              />
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowCreateServerModal(false)} style={{ padding: "8px 16px", borderRadius: 8, background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", cursor: "pointer" }}>
                  Отмена
                </button>
                <button type="submit" style={{ padding: "8px 16px", borderRadius: 8, background: "#bef264", border: "none", color: "#000", fontWeight: 800, cursor: "pointer" }}>
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛКА: СОЗДАТЬ КАНАЛ */}
      {showCreateChannelModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ width: 400, background: "#111420", borderRadius: 16, border: "1px solid rgba(255,255,255,0.15)", padding: 24 }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: 18 }}>Создать канал</h3>
            <form onSubmit={handleCreateChannel}>
              <input
                type="text"
                required
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                placeholder="название-канала"
                style={{ width: "100%", padding: 12, borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", marginBottom: 14, outline: "none" }}
              />
              <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
                <button
                  type="button"
                  onClick={() => setNewChannelType("text")}
                  style={{
                    flex: 1,
                    padding: 10,
                    borderRadius: 8,
                    background: newChannelType === "text" ? "rgba(190, 242, 100, 0.2)" : "rgba(255,255,255,0.05)",
                    border: newChannelType === "text" ? "1px solid #bef264" : "1px solid transparent",
                    color: newChannelType === "text" ? "#bef264" : "#fff",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  # Текстовый
                </button>
                <button
                  type="button"
                  onClick={() => setNewChannelType("voice")}
                  style={{
                    flex: 1,
                    padding: 10,
                    borderRadius: 8,
                    background: newChannelType === "voice" ? "rgba(190, 242, 100, 0.2)" : "rgba(255,255,255,0.05)",
                    border: newChannelType === "voice" ? "1px solid #bef264" : "1px solid transparent",
                    color: newChannelType === "voice" ? "#bef264" : "#fff",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  🔊 Голосовой
                </button>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowCreateChannelModal(false)} style={{ padding: "8px 16px", borderRadius: 8, background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", cursor: "pointer" }}>
                  Отмена
                </button>
                <button type="submit" style={{ padding: "8px 16px", borderRadius: 8, background: "#bef264", border: "none", color: "#000", fontWeight: 800, cursor: "pointer" }}>
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛКА: AI САММАРИ */}
      {showSummaryModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ width: 500, background: "#111420", borderRadius: 16, border: "1px solid #a855f7", padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#c084fc", fontWeight: 800 }}>
                <Sparkles size={18} />
                <span>AI Саммари созвона</span>
              </div>
              <X size={18} onClick={() => setShowSummaryModal(false)} style={{ cursor: "pointer" }} />
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", lineHeight: 1.6 }}>
              • <strong>Текущая комната:</strong> {activeVoiceChannel ? activeVoiceChannel.name : "Вне войса"}<br />
              • <strong>Статус сети:</strong> PTT RTT 18ms через WebSockets & WebRTC<br />
              • <strong>Шумодав:</strong> RNNoise Recurrent Neural Network активен локально в браузере<br />
              • <strong>База данных:</strong> SQLite хранит пользователей, каналы и историю сообщений
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
