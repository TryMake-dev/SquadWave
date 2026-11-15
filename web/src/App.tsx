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
  Play,
  Maximize2
} from "lucide-react";

interface Peer {
  id: string;
  name: string;
  role: string;
  isSpeaking: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  avatarColor: string;
  avatarLetter: string;
  volume: number;
  ping: number;
}

interface ChatMessage {
  id: string;
  sender: string;
  senderColor: string;
  avatarLetter: string;
  time: string;
  text: string;
}

export default function App() {
  // Навигация
  const [activeTab, setActiveTab] = useState<"voice" | "text">("voice");
  const [activeTextChannel, setActiveTextChannel] = useState("general-chat");
  const [activeVoiceChannel, setActiveVoiceChannel] = useState("Рейд войс [Pion SFU]");

  // Состояния войса
  const [isInVoice, setIsInVoice] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [rnnoiseActive, setRnnoiseActive] = useState(true);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [pwaInstalled, setPwaInstalled] = useState(false);
  const [ping, setPing] = useState(18);

  // Стрим экрана
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Микрофон и анализатор звука
  const audioContextRef = useRef<AudioContext | null>(null);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Сообщения чата
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      sender: "Кирилл (Carry)",
      senderColor: "#38bdf8",
      avatarLetter: "К",
      time: "18:42",
      text: "Здорово всем! Проверил пинг на нашем сервере за $3 — ровно 18 миллисекунд, звук идеальный!",
    },
    {
      id: "2",
      sender: "Максим (Support)",
      senderColor: "#a855f7",
      avatarLetter: "М",
      time: "18:43",
      text: "Да, после вечного RTC Connecting в Дискорде это просто небо и земля. Включаю стрим экрана.",
    },
    {
      id: "3",
      sender: "Александр (Dev)",
      senderColor: "#bef264",
      avatarLetter: "А",
      time: "18:45",
      text: "RNNoise шумодав на Wasm уже работает. Кликов синих свичей на механике вообще не слышно.",
    },
  ]);
  const [inputText, setInputText] = useState("");

  // Список участников комнаты
  const [peers, setPeers] = useState<Peer[]>([
    {
      id: "local",
      name: "Александр (Вы)",
      role: "Host / Architect",
      isSpeaking: false,
      isMuted: false,
      isDeafened: false,
      isScreenSharing: false,
      avatarColor: "#bef264",
      avatarLetter: "А",
      volume: 0,
      ping: 18,
    },
    {
      id: "p2",
      name: "Кирилл",
      role: "Carry Player",
      isSpeaking: true,
      isMuted: false,
      isDeafened: false,
      isScreenSharing: false,
      avatarColor: "#38bdf8",
      avatarLetter: "К",
      volume: 68,
      ping: 21,
    },
    {
      id: "p3",
      name: "Максим",
      role: "Support",
      isSpeaking: false,
      isMuted: false,
      isDeafened: false,
      isScreenSharing: false,
      avatarColor: "#a855f7",
      avatarLetter: "М",
      volume: 12,
      ping: 19,
    },
    {
      id: "p4",
      name: "Артём",
      role: "Mid Laner",
      isSpeaking: false,
      isMuted: true,
      isDeafened: false,
      isScreenSharing: false,
      avatarColor: "#f59e0b",
      avatarLetter: "А",
      volume: 0,
      ping: 24,
    },
  ]);

  // Запуск микрофона с реальным AudioContext Web Audio API
  useEffect(() => {
    let active = true;

    async function initAudio() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: !rnnoiseActive,
            autoGainControl: true,
          },
        });
        if (!active) return;
        localAudioStreamRef.current = stream;

        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const trackVolume = () => {
          if (!active) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const speaking = avg > 20 && !isMuted;

          setPeers((prev) =>
            prev.map((p) =>
              p.id === "local"
                ? { ...p, isSpeaking: speaking, volume: Math.min(100, avg * 2.5) }
                : p
            )
          );
          animFrameRef.current = requestAnimationFrame(trackVolume);
        };
        trackVolume();
      } catch (err) {
        // Фоновый генератор для превью если микрофон не разрешен
        const interval = setInterval(() => {
          if (!active) return;
          const speaking = Math.random() > 0.65 && !isMuted;
          setPeers((prev) =>
            prev.map((p) =>
              p.id === "p2"
                ? { ...p, isSpeaking: Math.random() > 0.3, volume: Math.floor(Math.random() * 80) }
                : p
            )
          );
        }, 1200);
        return () => clearInterval(interval);
      }
    }

    if (isInVoice) {
      initAudio();
    }

    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (localAudioStreamRef.current) {
        localAudioStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [isInVoice, isMuted, rnnoiseActive]);

  // Включение шеринга экрана 1080p 60fps
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
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60 },
        },
        audio: true,
      });

      screenStreamRef.current = stream;
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
      }
      setIsScreenSharing(true);

      stream.getVideoTracks()[0].onended = () => {
        setIsScreenSharing(false);
      };
    } catch (e) {
      console.warn("Screen share cancelled:", e);
    }
  };

  // Отправка текстового сообщения
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const newMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: "Александр (Вы)",
      senderColor: "#bef264",
      avatarLetter: "А",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      text: inputText.trim(),
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputText("");
  };

  return (
    <div
      style={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        background: "#080a0f",
        color: "#ffffff",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* 1. БОКОВАЯ ПАНЕЛЬ СЕРВЕРОВ (Discord Style) */}
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
        {/* Главная иконка SquadWave */}
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
            fontWeight: 900,
            fontSize: 22,
            cursor: "pointer",
            boxShadow: "0 0 20px rgba(190, 242, 100, 0.45)",
            transition: "all 0.2s ease",
          }}
        >
          <Zap size={24} fill="#090a0f" />
        </div>

        <div style={{ width: 36, height: 2, background: "rgba(255, 255, 255, 0.1)", margin: "4px 0" }} />

        {/* Сервер Squad Gaming HQ (Активный) */}
        <div
          title="Squad Gaming HQ"
          style={{
            width: 48,
            height: 48,
            borderRadius: 16,
            background: "rgba(56, 189, 248, 0.2)",
            border: "2px solid #38bdf8",
            color: "#38bdf8",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 16,
            cursor: "pointer",
            position: "relative",
          }}
        >
          HQ
          {/* Индикатор активности */}
          <div
            style={{
              position: "absolute",
              left: -12,
              width: 4,
              height: 36,
              background: "#ffffff",
              borderRadius: "0 4px 4px 0",
            }}
          />
        </div>

        {/* Другие серверы */}
        {[
          { label: "DEV", color: "#a855f7", name: "Rust & Go SFU Devs" },
          { label: "CYBER", color: "#f59e0b", name: "Cyberpunk Clan" },
        ].map((srv, idx) => (
          <div
            key={idx}
            title={srv.name}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              background: "rgba(255, 255, 255, 0.04)",
              color: srv.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 13,
              cursor: "pointer",
              transition: "border-radius 0.2s ease",
            }}
          >
            {srv.label}
          </div>
        ))}

        {/* Добавить сервер (+) */}
        <div
          title="Создать или подключить сервер"
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

      {/* 2. БОКОВАЯ ПАНЕЛЬ КАНАЛОВ И СТАТУСА */}
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.01em" }}>
              Squad Gaming HQ
            </span>
          </div>
          <span
            style={{
              fontSize: 10,
              padding: "2px 7px",
              borderRadius: 5,
              background: "rgba(190, 242, 100, 0.15)",
              border: "1px solid rgba(190, 242, 100, 0.3)",
              color: "#bef264",
              fontWeight: 800,
            }}
          >
            PION SFU
          </span>
        </div>

        {/* Список каналов */}
        <div
          style={{
            flex: 1,
            padding: "16px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            overflowY: "auto",
          }}
        >
          {/* Категория: Текстовые каналы */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "rgba(255, 255, 255, 0.4)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                padding: "0 8px 6px 8px",
              }}
            >
              Текстовые каналы
            </div>
            {["general-chat", "clips-and-screenshots", "patch-notes"].map((ch) => {
              const isCurrent = activeTab === "text" && activeTextChannel === ch;
              return (
                <div
                  key={ch}
                  onClick={() => {
                    setActiveTab("text");
                    setActiveTextChannel(ch);
                  }}
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
                    transition: "all 0.15s ease",
                  }}
                >
                  <Hash size={16} color={isCurrent ? "#bef264" : "rgba(255,255,255,0.4)"} />
                  <span>{ch}</span>
                </div>
              );
            })}
          </div>

          {/* Категория: Голосовые комнаты */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "rgba(255, 255, 255, 0.4)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                padding: "0 8px 6px 8px",
              }}
            >
              Голосовые комнаты (UDP/RTP)
            </div>
            {["Рейд войс [Pion SFU]", "Чилл & Музыка 128k", "Duo Arena"].map((ch) => {
              const isCurrent = activeTab === "voice" && activeVoiceChannel === ch;
              return (
                <div key={ch}>
                  <div
                    onClick={() => {
                      setActiveTab("voice");
                      setActiveVoiceChannel(ch);
                      if (!isInVoice) setIsInVoice(true);
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: isCurrent ? "rgba(190, 242, 100, 0.12)" : "transparent",
                      border: isCurrent ? "1px solid rgba(190, 242, 100, 0.25)" : "1px solid transparent",
                      color: isCurrent ? "#bef264" : "rgba(255, 255, 255, 0.7)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 13.5,
                      fontWeight: 600,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <VolumeIcon size={16} color={isCurrent ? "#bef264" : "rgba(255,255,255,0.4)"} />
                      <span>{ch}</span>
                    </div>
                    {isCurrent && isInVoice && (
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

                  {/* Если эта комната активна, показываем мини-список говорящих в сайдбаре */}
                  {isCurrent && isInVoice && (
                    <div style={{ paddingLeft: 28, display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                      {peers.map((p) => (
                        <div
                          key={p.id}
                          style={{
                            fontSize: 12,
                            color: p.isSpeaking ? "#bef264" : "rgba(255,255,255,0.5)",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: p.isSpeaking ? "#bef264" : "rgba(255,255,255,0.2)",
                            }}
                          />
                          <span>{p.name}</span>
                          {p.isMuted && <MicOff size={11} color="#ef4444" />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Панель активного WebRTC подключения */}
        {isInVoice && (
          <div
            style={{
              padding: "12px 14px",
              background: "rgba(0, 0, 0, 0.45)",
              borderTop: "1px solid rgba(255, 255, 255, 0.06)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#10b981" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
                <span>ГОЛОС ПОДКЛЮЧЕН (SFU)</span>
              </div>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: "#bef264", fontWeight: 800 }}>
                {ping} ms
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              <span>Opus 128k • 48 kHz</span>
              <button
                onClick={() => setIsInVoice(false)}
                title="Отключиться"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#ef4444",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                <PhoneOff size={13} />
                <span>Выйти</span>
              </button>
            </div>
          </div>
        )}

        {/* Профиль пользователя внизу */}
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
                background: "#bef264",
                color: "#090a0f",
                fontWeight: 900,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                position: "relative",
              }}
            >
              А
              <span
                style={{
                  position: "absolute",
                  bottom: 0,
                  right: 0,
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#10b981",
                  border: "2px solid #080a0f",
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>Александр</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>#0001 (Host)</div>
            </div>
          </div>

          {/* Кнопки управления микрофоном, звуком и настройками */}
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setIsMuted(!isMuted)}
              title={isMuted ? "Включить микрофон" : "Заглушить микрофон"}
              style={{
                width: 32,
                height: 32,
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
              {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>

            <button
              onClick={() => setIsDeafened(!isDeafened)}
              title={isDeafened ? "Включить звук" : "Заглушить наушники"}
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: isDeafened ? "rgba(239, 68, 68, 0.2)" : "rgba(255, 255, 255, 0.05)",
                border: "none",
                color: isDeafened ? "#ef4444" : "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              {isDeafened ? <VolumeX size={16} /> : <Headphones size={16} />}
            </button>

            <button
              onClick={() => setShowSettingsModal(true)}
              title="Настройки"
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: "rgba(255, 255, 255, 0.05)",
                border: "none",
                color: "rgba(255, 255, 255, 0.7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* 3. ГЛАВНАЯ РАБОЧАЯ ОБЛАСТЬ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#090a0f" }}>
        {/* Верхняя строка управления */}
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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {activeTab === "voice" ? <VolumeIcon size={20} color="#bef264" /> : <Hash size={20} color="#bef264" />}
            <span style={{ fontSize: 16, fontWeight: 800 }}>
              {activeTab === "voice" ? activeVoiceChannel : activeTextChannel}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "rgba(255, 255, 255, 0.4)",
                fontFamily: "monospace",
                marginLeft: 8,
              }}
            >
              {activeTab === "voice" ? "Opus 128 kbps • 48 kHz Stereo • Pion SFU" : "Текстовый канал HQ"}
            </span>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {/* Тумблер RNNoise шумодава */}
            <button
              onClick={() => setRnnoiseActive(!rnnoiseActive)}
              title="RNNoise нейросетевое шумоподавление на WebAssembly"
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

            {/* Кнопка Саммари созвона (Whisper + LLM) */}
            <button
              onClick={() => setShowSummaryModal(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
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
              <span>Саммари войса</span>
            </button>

            {/* Кнопка шеринга экрана 1080p 60fps */}
            <button
              onClick={toggleScreenShare}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 16px",
                borderRadius: 8,
                background: isScreenSharing ? "rgba(239, 68, 68, 0.2)" : "rgba(190, 242, 100, 0.15)",
                border: isScreenSharing ? "1px solid #ef4444" : "1px solid #bef264",
                color: isScreenSharing ? "#ef4444" : "#bef264",
                fontSize: 12,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {isScreenSharing ? <MonitorOff size={15} /> : <Monitor size={15} />}
              <span>{isScreenSharing ? "Остановить стрим" : "Стрим экрана 1080p60"}</span>
            </button>

            {/* PWA установка */}
            <button
              onClick={() => setPwaInstalled(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 8,
                background: pwaInstalled ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.05)",
                border: pwaInstalled ? "1px solid #10b981" : "1px solid rgba(255, 255, 255, 0.1)",
                color: pwaInstalled ? "#10b981" : "#ffffff",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {pwaInstalled ? <CheckCircle2 size={14} /> : <Download size={14} />}
              <span>{pwaInstalled ? "PWA установлен" : "PWA"}</span>
            </button>
          </div>
        </div>

        {/* Контент: Голосовая сетка ИЛИ Текстовый чат */}
        {activeTab === "voice" ? (
          <div
            style={{
              flex: 1,
              padding: 24,
              display: "grid",
              gridTemplateColumns: isScreenSharing ? "1.8fr 1fr" : "repeat(2, 1fr)",
              gap: 20,
              overflowY: "auto",
            }}
          >
            {/* Окно активного стрима экрана */}
            {isScreenSharing && (
              <div
                style={{
                  background: "#040508",
                  borderRadius: 18,
                  border: "1px solid rgba(56, 189, 248, 0.35)",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                  boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
                }}
              >
                <div
                  style={{
                    height: 40,
                    background: "rgba(0, 0, 0, 0.6)",
                    backdropFilter: "blur(12px)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 16px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: "#ef4444",
                        fontSize: 10,
                        fontWeight: 900,
                      }}
                    >
                      LIVE 60 FPS
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>Стрим экрана: Александр</span>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      color: "#bef264",
                      fontWeight: 800,
                      fontFamily: "monospace",
                    }}
                  >
                    1080p 60.0 FPS • 8.2 Mbps
                  </span>
                </div>

                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#000000",
                    position: "relative",
                  }}
                >
                  <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                </div>
              </div>
            )}

            {/* Сетка участников войса */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isScreenSharing ? "1fr" : "repeat(2, 1fr)",
                gap: 16,
              }}
            >
              {peers.map((peer) => (
                <div
                  key={peer.id}
                  style={{
                    background: "rgba(16, 20, 30, 0.5)",
                    borderRadius: 20,
                    border: peer.isSpeaking
                      ? `2px solid ${peer.avatarColor}`
                      : "1px solid rgba(255, 255, 255, 0.08)",
                    boxShadow: peer.isSpeaking ? `0 0 30px ${peer.avatarColor}40` : "none",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "28px 20px",
                    position: "relative",
                    transition: "all 0.15s ease",
                  }}
                >
                  {/* Пинг в углу */}
                  <div
                    style={{
                      position: "absolute",
                      top: 14,
                      right: 16,
                      fontSize: 11,
                      fontFamily: "monospace",
                      color: "#bef264",
                    }}
                  >
                    {peer.ping} ms
                  </div>

                  {/* Аватар с неоновым светящимся кольцом */}
                  <div
                    style={{
                      width: 86,
                      height: 86,
                      borderRadius: "50%",
                      background: peer.avatarColor,
                      color: "#090a0f",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 32,
                      fontWeight: 900,
                      position: "relative",
                      boxShadow: peer.isSpeaking ? `0 0 25px ${peer.avatarColor}` : "none",
                    }}
                  >
                    {peer.avatarLetter}

                    {peer.isMuted && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: -2,
                          right: -2,
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          background: "#ef4444",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#ffffff",
                          border: "2px solid #090a0f",
                        }}
                      >
                        <MicOff size={14} />
                      </div>
                    )}
                  </div>

                  {/* Имя и роль */}
                  <div style={{ marginTop: 14, fontWeight: 800, fontSize: 16 }}>{peer.name}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                    {peer.role}
                  </div>

                  {/* Статус речи и индикатор громкости */}
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: peer.isSpeaking ? "#bef264" : "rgba(255,255,255,0.3)",
                        fontWeight: 700,
                      }}
                    >
                      {peer.isMuted
                        ? "Микрофон выключен"
                        : peer.isSpeaking
                        ? "Говорит (Opus 128k)"
                        : "Молчит"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Текстовый чат канала */
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, padding: "24px 32px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
              {messages.map((msg) => (
                <div key={msg.id} style={{ display: "flex", gap: 14 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      background: msg.senderColor,
                      color: "#090a0f",
                      fontWeight: 900,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 16,
                      flexShrink: 0,
                    }}
                  >
                    {msg.avatarLetter}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 800, fontSize: 14, color: msg.senderColor }}>
                        {msg.sender}
                      </span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                        {msg.time}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, color: "rgba(255,255,255,0.9)", lineHeight: 1.5 }}>
                      {msg.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Поле ввода сообщения */}
            <form
              onSubmit={handleSendMessage}
              style={{
                padding: "16px 24px",
                background: "#080a0f",
                borderTop: "1px solid rgba(255, 255, 255, 0.06)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "rgba(255, 255, 255, 0.05)",
                  borderRadius: 12,
                  padding: "6px 14px",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                }}
              >
                <Paperclip size={18} color="rgba(255,255,255,0.4)" style={{ cursor: "pointer", marginRight: 10 }} />
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={`Отправить сообщение в #${activeTextChannel}...`}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    color: "#ffffff",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
                <Smile size={18} color="rgba(255,255,255,0.4)" style={{ cursor: "pointer", marginRight: 12 }} />
                <button
                  type="submit"
                  style={{
                    background: "#bef264",
                    border: "none",
                    borderRadius: 8,
                    padding: "6px 12px",
                    color: "#090a0f",
                    fontWeight: 800,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <Send size={15} />
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* МОДАЛЬНОЕ ОКНО: WHISPER + LLM САММАРИ */}
      {showSummaryModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 540,
              background: "#111420",
              border: "1px solid #a855f7",
              borderRadius: 20,
              boxShadow: "0 30px 90px rgba(0, 0, 0, 0.9)",
              padding: 28,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#c084fc", fontWeight: 800, fontSize: 17 }}>
                <Sparkles size={20} />
                <span>AI Саммари созвона (Whisper + LLM)</span>
              </div>
              <X size={20} onClick={() => setShowSummaryModal(false)} style={{ cursor: "pointer", color: "rgba(255,255,255,0.5)" }} />
            </div>

            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <strong>🔹 Тема:</strong> Развёртывание собственного сервера SquadWave на замену Discord.
              </div>
              <div>
                <strong>🔹 Задержка:</strong> Зафиксировано 18 миллисекунд RTT на VPS за $3 в месяц.
              </div>
              <div>
                <strong>🔹 Звук:</strong> Битрейт 128 kbps Opus Stereo, нейросеть RNNoise успешно устранила фоновые щелчки механической клавиатуры.
              </div>
              <div>
                <strong>🔹 Решение:</strong> Запустить репозиторий на GitHub и предоставить docker-compose файл для сообщества.
              </div>
            </div>

            <button
              onClick={() => setShowSummaryModal(false)}
              style={{
                marginTop: 24,
                width: "100%",
                padding: "12px",
                borderRadius: 10,
                background: "#a855f7",
                border: "none",
                color: "#ffffff",
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО: НАСТРОЙКИ СЕТИ И ЗВУКА */}
      {showSettingsModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 500,
              background: "#111420",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: 20,
              boxShadow: "0 30px 90px rgba(0, 0, 0, 0.9)",
              padding: 28,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 17 }}>⚙️ Настройки звука и SFU</div>
              <X size={20} onClick={() => setShowSettingsModal(false)} style={{ cursor: "pointer", color: "rgba(255,255,255,0.5)" }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontWeight: 700 }}>АУДИОКОДЕК</label>
                <div style={{ marginTop: 6, padding: "10px 14px", background: "rgba(255,255,255,0.05)", borderRadius: 8, fontSize: 13, border: "1px solid rgba(255,255,255,0.1)" }}>
                  Opus Interactive Audio (48 000 Hz, Stereo, 128 kbps)
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontWeight: 700 }}>СЕРВЕР МАРШРУТИЗАЦИИ</label>
                <div style={{ marginTop: 6, padding: "10px 14px", background: "rgba(255,255,255,0.05)", borderRadius: 8, fontSize: 13, border: "1px solid rgba(255,255,255,0.1)" }}>
                  Go Pion SFU + Coturn TURN Relay (Symmetric NAT Bypassed)
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontWeight: 700 }}>ЗАДЕРЖКА (RTT)</label>
                <div style={{ marginTop: 6, padding: "10px 14px", background: "rgba(190,242,100,0.1)", borderRadius: 8, fontSize: 13, color: "#bef264", fontWeight: 800, border: "1px solid rgba(190,242,100,0.3)" }}>
                  ⚡ 18 миллисекунд (VPS за $3)
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowSettingsModal(false)}
              style={{
                marginTop: 24,
                width: "100%",
                padding: "12px",
                borderRadius: 10,
                background: "#bef264",
                border: "none",
                color: "#090a0f",
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Сохранить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
