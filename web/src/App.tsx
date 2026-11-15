import React, { useState, useEffect, useRef } from "react";

interface Peer {
  id: string;
  name: string;
  isSpeaking: boolean;
  isMuted: boolean;
  avatarColor: string;
  volume: number;
}

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [rnnoiseEnabled, setRnnoiseEnabled] = useState(true);
  const [showSummary, setShowSummary] = useState(false);
  const [ping, setPing] = useState(18);
  const [activeChannel, setActiveChannel] = useState("Рейд войс [Pion SFU]");

  // Локальный пользователь и пиры
  const [peers, setPeers] = useState<Peer[]>([
    { id: "1", name: "Вы (Александр)", isSpeaking: false, isMuted: false, avatarColor: "#bef264", volume: 0 },
    { id: "2", name: "Кирилл (Carry)", isSpeaking: true, isMuted: false, avatarColor: "#38bdf8", volume: 65 },
    { id: "3", name: "Максим (Support)", isSpeaking: false, isMuted: false, avatarColor: "#a855f7", volume: 15 },
    { id: "4", name: "Артём (Mid)", isSpeaking: false, isMuted: true, avatarColor: "#f59e0b", volume: 0 },
  ]);

  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Инициализация микрофона и детекции голоса
  const toggleConnection = async () => {
    if (isConnected) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      setIsConnected(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: !rnnoiseEnabled,
          autoGainControl: true,
          channelCount: 2,
        },
      });
      localStreamRef.current = stream;

      // Анализатор громкости Web Audio API
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!audioContextRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const speaking = avg > 20;

        setPeers((prev) =>
          prev.map((p) =>
            p.id === "1" ? { ...p, isSpeaking: speaking, volume: Math.min(100, avg * 2) } : p
          )
        );

        requestAnimationFrame(checkVolume);
      };
      checkVolume();
      setIsConnected(true);
    } catch (err) {
      console.warn("Микрофон недоступен, переключаем в демо-режим WebRTC:", err);
      setIsConnected(true);
    }
  };

  // Шеринг экрана 1080p 60fps
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      if (screenVideoRef.current && screenVideoRef.current.srcObject) {
        const stream = screenVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        screenVideoRef.current.srcObject = null;
      }
      setIsScreenSharing(false);
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60 },
        },
        audio: true,
      });

      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = displayStream;
      }
      setIsScreenSharing(true);

      displayStream.getVideoTracks()[0].onended = () => {
        setIsScreenSharing(false);
      };
    } catch (e) {
      console.warn("Шеринг отменен или заблокирован:", e);
    }
  };

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", background: "#090a0f", color: "#ffffff", overflow: "hidden" }}>
      {/* 1. Колонка серверов */}
      <div style={{ width: 72, background: "#0c0e15", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 0", gap: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: 16, background: "#bef264", color: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, cursor: "pointer", boxShadow: "0 0 16px rgba(190, 242, 100, 0.4)" }}>
          ⚡
        </div>
        <div style={{ width: 36, height: 2, background: "rgba(255,255,255,0.1)" }} />
        {["🎮", "🛡️", "🔥"].map((emoji, idx) => (
          <div key={idx} style={{ width: 48, height: 48, borderRadius: 24, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, cursor: "pointer", transition: "all 0.2s" }}>
            {emoji}
          </div>
        ))}
      </div>

      {/* 2. Колонка каналов */}
      <div style={{ width: 280, background: "#0f121c", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column" }}>
        <div style={{ height: 56, borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.01em" }}>Squad Gaming HQ</span>
          <span style={{ fontSize: 11, background: "rgba(190, 242, 100, 0.15)", color: "#bef264", padding: "3px 8px", borderRadius: 6, fontWeight: 700 }}>PION SFU</span>
        </div>

        <div style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", padding: "0 8px", marginBottom: 6 }}>
            Голосовые комнаты (UDP/RTP)
          </div>

          {["Рейд войс [Pion SFU]", "Чилл & Музыка", "AFK Канал"].map((channel) => {
            const isActive = activeChannel === channel;
            return (
              <div
                key={channel}
                onClick={() => setActiveChannel(channel)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: isActive ? "rgba(190, 242, 100, 0.12)" : "transparent",
                  border: isActive ? "1px solid rgba(190, 242, 100, 0.3)" : "1px solid transparent",
                  color: isActive ? "#bef264" : "rgba(255,255,255,0.7)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🔊</span>
                  <span>{channel}</span>
                </div>
                {isActive && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#bef264", boxShadow: "0 0 8px #bef264" }} />}
              </div>
            );
          })}
        </div>

        {/* Статус WebRTC соединения внизу */}
        <div style={{ padding: "14px 18px", background: "rgba(0,0,0,0.4)", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: isConnected ? "#10b981" : "#f59e0b", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: isConnected ? "#10b981" : "#f59e0b" }} />
              {isConnected ? "ГОЛОС ПОДКЛЮЧЕН (SFU)" : "ОЖИДАНИЕ ВХОДА"}
            </span>
            <span style={{ fontFamily: "monospace", color: "#bef264", fontWeight: 800 }}>{ping} ms</span>
          </div>

          <button
            onClick={toggleConnection}
            style={{
              padding: "10px",
              borderRadius: 8,
              background: isConnected ? "rgba(239, 68, 68, 0.2)" : "rgba(190, 242, 100, 0.2)",
              border: isConnected ? "1px solid #ef4444" : "1px solid #bef264",
              color: isConnected ? "#ef4444" : "#bef264",
              fontWeight: 800,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {isConnected ? "ОТКЛЮЧИТЬСЯ ОТ ВОЙСА" : "ПОДКЛЮЧИТЬСЯ К ВОЙСУ"}
          </button>
        </div>
      </div>

      {/* 3. Основная рабочая область войса */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#090a0f" }}>
        {/* Верхняя строка управления с PWA и RNNoise */}
        <div style={{ height: 56, borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Комната: {activeChannel}</span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>Opus 128 kbps • 48 kHz Stereo</span>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {/* Тумблер RNNoise */}
            <button
              onClick={() => setRnnoiseEnabled(!rnnoiseEnabled)}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                background: rnnoiseEnabled ? "rgba(56, 189, 248, 0.15)" : "rgba(255,255,255,0.05)",
                border: rnnoiseEnabled ? "1px solid #38bdf8" : "1px solid rgba(255,255,255,0.1)",
                color: rnnoiseEnabled ? "#38bdf8" : "rgba(255,255,255,0.5)",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              🧠 RNNoise Wasm: {rnnoiseEnabled ? "ВКЛ (-28dB)" : "ВЫКЛ"}
            </button>

            {/* Кнопка Саммари */}
            <button
              onClick={() => setShowSummary(!showSummary)}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                background: showSummary ? "rgba(168, 85, 247, 0.25)" : "rgba(168, 85, 247, 0.1)",
                border: "1px solid #a855f7",
                color: "#c084fc",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ✨ Саммари войса
            </button>

            {/* Шеринг экрана 1080p 60fps */}
            <button
              onClick={toggleScreenShare}
              style={{
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
              🖥️ {isScreenSharing ? "Остановить стрим" : "Стрим экрана 1080p 60fps"}
            </button>
          </div>
        </div>

        {/* Сетка участников и видеопотока */}
        <div style={{ flex: 1, padding: 24, display: "grid", gridTemplateColumns: isScreenSharing ? "1.6fr 1fr" : "repeat(2, 1fr)", gap: 20, position: "relative" }}>
          {/* Блок стрима экрана (если включен) */}
          {isScreenSharing && (
            <div style={{ background: "#05070a", borderRadius: 16, border: "1px solid rgba(56, 189, 248, 0.4)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "8px 16px", background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#bef264", fontWeight: 800 }}>LIVE 1080p 60 FPS • 8.2 Mbps</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>WebRTC Hardware Accelerated</span>
              </div>
              <video ref={screenVideoRef} autoPlay playsInline muted style={{ flex: 1, width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
          )}

          {/* Карточки участников */}
          <div style={{ display: "grid", gridTemplateColumns: isScreenSharing ? "1fr" : "repeat(2, 1fr)", gap: 16 }}>
            {peers.map((peer) => (
              <div
                key={peer.id}
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  borderRadius: 18,
                  border: peer.isSpeaking ? `2px solid ${peer.avatarColor}` : "1px solid rgba(255, 255, 255, 0.06)",
                  boxShadow: peer.isSpeaking ? `0 0 25px ${peer.avatarColor}40` : "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 24,
                  position: "relative",
                  transition: "all 0.15s ease",
                }}
              >
                {/* Аватарка с неоновым кольцом громкости */}
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: "50%",
                    background: peer.avatarColor,
                    color: "#000",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 28,
                    fontWeight: 900,
                    position: "relative",
                  }}
                >
                  {peer.name[0]}
                </div>

                <div style={{ marginTop: 14, fontWeight: 700, fontSize: 16 }}>{peer.name}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                  {peer.isSpeaking ? "Говорит (Opus 128k)" : "Молчит"}
                </div>
              </div>
            ))}
          </div>

          {/* Всплывающее окно Саммари Whisper + LLM */}
          {showSummary && (
            <div
              style={{
                position: "absolute",
                right: 30,
                bottom: 30,
                width: 420,
                background: "rgba(15, 18, 28, 0.98)",
                border: "1px solid #38bdf8",
                borderRadius: 16,
                boxShadow: "0 25px 60px rgba(0,0,0,0.9)",
                padding: 20,
                fontSize: 13,
                zIndex: 100,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ color: "#38bdf8", fontWeight: 800, fontSize: 14 }}>✨ Whisper + LLM Саммари</span>
                <span onClick={() => setShowSummary(false)} style={{ cursor: "pointer", color: "rgba(255,255,255,0.5)" }}>✕</span>
              </div>
              <div style={{ color: "rgba(255,255,255,0.85)", lineHeight: 1.6 }}>
                • <strong>Тема:</strong> Тестирование собственного SFU-сервера на Go.<br />
                • <strong>Задержка:</strong> Зафиксировано 18 мс RTT до сервера за $3.<br />
                • <strong>Качество:</strong> Потерь пакетов 0%, шумодав отсёк все клики механической клавиатуры.<br />
                • <strong>Решение:</strong> Развернуть сайт в Docker и опубликовать на GitHub.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
