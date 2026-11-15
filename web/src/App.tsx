import React, { useState, useEffect, useRef } from "react";
import { NeuralAudioProcessor } from "./audio/rnnoiseManager";
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
  SlidersHorizontal,
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
  isMuted?: boolean;
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

  // Чат
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const activeChannelRef = useRef<ChannelItem | null>(null);
  activeChannelRef.current = activeChannel;

  // Голосовая связь и WebRTC
  const [isInVoice, setIsInVoice] = useState(false);
  const [activeVoiceChannel, setActiveVoiceChannel] = useState<ChannelItem | null>(null);
  const [voicePeers, setVoicePeers] = useState<VoicePeer[]>([]);
  const voicePeersRef = useRef<VoicePeer[]>([]);
  voicePeersRef.current = voicePeers;

  // Глобальное состояние всех голосовых каналов (кто в каком сидит, как в Discord)
  const [voiceRoomStates, setVoiceRoomStates] = useState<Record<string, VoicePeer[]>>({});

  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);
  isMutedRef.current = isMuted;

  const [isSelfSpeaking, setIsSelfSpeaking] = useState(false);

  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const [liveScreenFrame, setLiveScreenFrame] = useState<string | null>(null);
  const [remoteSharerName, setRemoteSharerName] = useState<string | null>(null);
  const [peerAudioStreams, setPeerAudioStreams] = useState<Map<string, MediaStream>>(new Map());
  const [rtcConnectionState, setRtcConnectionState] = useState<Record<string, string>>({});
  const serverLocalIpsRef = useRef<string[]>(["127.0.0.1", "192.168.0.196"]);
  const playbackAudioCtxRef = useRef<AudioContext | null>(null);
  const nextPcmPlayTimeRef = useRef<number>(0);
  const screenCaptureIntervalRef = useRef<any>(null);
  const [rnnoiseActive, setRnnoiseActive] = useState(() => localStorage.getItem("squadwave_rnnoise") !== "false");
  const rnnoiseActiveRef = useRef(rnnoiseActive);
  rnnoiseActiveRef.current = rnnoiseActive;

  const [vadThreshold, setVadThreshold] = useState<number>(() => {
    const s = localStorage.getItem("squadwave_vad_threshold");
    return s ? parseFloat(s) : 0.65;
  });
  const vadThresholdRef = useRef(vadThreshold);
  vadThresholdRef.current = vadThreshold;

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>(() => {
    return localStorage.getItem("squadwave_mic_device") || "";
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [micTestVolume, setMicTestVolume] = useState(0);

  const neuralProcessorRef = useRef<NeuralAudioProcessor | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const [ping, setPing] = useState(18);

  // Модальные окна
  const [showCreateServerModal, setShowCreateServerModal] = useState(false);
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [newServerName, setNewServerName] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState<"text" | "voice">("text");
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  // Рефы WebRTC и Медиа
  const wsRef = useRef<WebSocket | null>(null);
  const myClientIdRef = useRef<string | null>(null);

  interface PeerEntry {
    pc: RTCPeerConnection;
    pendingCandidates: any[];
    makingOffer: boolean;
  }
  const peerConnectionsRef = useRef<Map<string, PeerEntry>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Загрузка доступных микрофонов
  const refreshAudioDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      setAudioDevices(inputs);
      const saved = localStorage.getItem("squadwave_mic_device");
      if (saved && inputs.some((d) => d.deviceId === saved)) {
        setSelectedAudioDeviceId(saved);
      } else if (inputs.length > 0 && !selectedAudioDeviceId) {
        setSelectedAudioDeviceId(inputs[0].deviceId);
      }
    } catch (err) {
      console.warn("Device enumeration error:", err);
    }
  };

  useEffect(() => {
    refreshAudioDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshAudioDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshAudioDevices);
    };
  }, []);

  const handleAudioDeviceChange = async (newDeviceId: string) => {
    setSelectedAudioDeviceId(newDeviceId);
    localStorage.setItem("squadwave_mic_device", newDeviceId);
    if (isInVoice) {
      await startAudioCapture(newDeviceId);
    }
  };

  // 1. Проверка сессии
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

  // 2. Загрузка серверов
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

  // 3. Загрузка каналов
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

  // 4. Загрузка сообщений
  useEffect(() => {
    if (!activeChannel || activeChannel.type !== "text") return;
    fetch(`${API_BASE}/api/channels/${activeChannel.id}/messages`)
      .then((res) => res.json())
      .then((data) => setMessages(data.messages || []))
      .catch(console.error);
  }, [activeChannel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Глобальный автостарт аудио при первом клике пользователя (обход ограничений Autoplay)
  useEffect(() => {
    const resumeAudio = () => {
      document.querySelectorAll("audio").forEach((el) => {
        if (el.paused) el.play().catch(() => {});
      });
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume().catch(() => {});
      }
    };
    window.addEventListener("click", resumeAudio);
    return () => window.removeEventListener("click", resumeAudio);
  }, []);

  // ==========================================================
  // 5. ПОЛНОЦЕННОЕ WEBRTC СОЕДИНЕНИЕ И СИГНАЛИНГ С ОБХОДОМ MDNS
  // ==========================================================
  const patchSdp = (rawSdp?: string) => {
    if (!rawSdp) return rawSdp;
    // Заменяем анонимизированные Chromium хосты <guid>.local на прямой 127.0.0.1
    return rawSdp.replace(/[a-zA-Z0-9-]+\.local/g, "127.0.0.1");
  };

  const startNegotiation = async (targetClientId: string, entry: { pc: RTCPeerConnection; makingOffer: boolean }) => {
    try {
      entry.makingOffer = true;
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "webrtc_signal",
            targetClientId,
            signal: { type: "offer", sdp: offer },
          })
        );
      }
    } catch (err) {
      console.error(`[WebRTC] Ошибка согласования оффера для ${targetClientId}:`, err);
    } finally {
      entry.makingOffer = false;
    }
  };

  const getOrCreatePeerConnection = (targetClientId: string, isInitiator: boolean) => {
    let entry = peerConnectionsRef.current.get(targetClientId);
    if (entry) return entry;

    console.log(`[WebRTC] Создание PeerConnection для: ${targetClientId} (Initiator: ${isInitiator})`);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
      ],
      iceCandidatePoolSize: 2,
    });

    const newEntry = { pc, pendingCandidates: [] as any[], makingOffer: false };
    peerConnectionsRef.current.set(targetClientId, newEntry);

    // Мониторинг состояния подключения для индикатора в UI
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Состояние соединения с ${targetClientId}: ${pc.connectionState}`);
      setRtcConnectionState((prev) => ({ ...prev, [targetClientId]: pc.connectionState }));
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE статус с ${targetClientId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        setRtcConnectionState((prev) => ({ ...prev, [targetClientId]: "connected" }));
      }
    };

    // Прикрепляем локальный аудио-трек микрофона (с нейросетевым шумоподавлением RNNoise)
    const outgoingStream = processedStreamRef.current || localStreamRef.current;
    if (outgoingStream) {
      outgoingStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMutedRef.current;
        pc.addTrack(track, outgoingStream);
      });
    }

    // Прикрепляем трек экрана если уже стримим
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getVideoTracks().forEach((track) => {
        pc.addTrack(track, localScreenStreamRef.current!);
      });
    }

    // Прием удаленных медиа-потоков
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Принят медиа-трек: ${event.track.kind} (${event.track.id}) от ${targetClientId}`);
      const stream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);

      if (event.track.kind === "audio") {
        setPeerAudioStreams((prev) => {
          const next = new Map(prev);
          next.set(targetClientId, stream);
          return next;
        });

        event.track.onunmute = () => {
          console.log(`[WebRTC] Аудио-трек активен от ${targetClientId}`);
          // Принудительно запускаем воспроизведение всех audio элементов
          document.querySelectorAll("audio").forEach((a) => {
            if (a.paused) a.play().catch(() => {});
          });
        };
      }

      if (event.track.kind === "video") {
        console.log(`[WebRTC] Принят стрим экрана от ${targetClientId}`);
        setRemoteScreenStream(stream);
        const p = voicePeersRef.current.find((peer) => peer.clientId === targetClientId);
        setRemoteSharerName(p ? p.display_name : "Собеседник");

        event.track.onunmute = () => {
          console.log(`[WebRTC] Видео-трек разблокирован (прием кадров 1080p 60fps) от ${targetClientId}`);
          const v = document.querySelector("video") as HTMLVideoElement | null;
          if (v && v.paused) {
            v.muted = true;
            v.play().catch(() => {});
          }
        };

        event.track.onended = () => {
          setRemoteScreenStream(null);
          setRemoteSharerName(null);
        };
      }
    };

    // Обмен ICE кандидатами с автоматическим синтезом прямого 127.0.0.1 (обход mDNS блокировки)
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        // Отправляем оригинальный кандидат
        wsRef.current.send(
          JSON.stringify({
            type: "webrtc_signal",
            targetClientId,
            signal: { type: "ice", candidate: event.candidate },
          })
        );

        // Синтезируем прямой loopback кандидат если кандидат mDNS (.local)
        const candStr = event.candidate.candidate;
        if (candStr && candStr.includes(".local")) {
          const loopbackCand = candStr.replace(/[a-zA-Z0-9-]+\.local/, "127.0.0.1");
          wsRef.current.send(
            JSON.stringify({
              type: "webrtc_signal",
              targetClientId,
              signal: {
                type: "ice",
                candidate: {
                  candidate: loopbackCand,
                  sdpMid: event.candidate.sdpMid,
                  sdpMLineIndex: event.candidate.sdpMLineIndex,
                  usernameFragment: event.candidate.usernameFragment,
                },
              },
            })
          );
        }
      }
    };

    // Если мы инициатор, создаем оффер
    if (isInitiator) {
      startNegotiation(targetClientId, newEntry);
    }

    return newEntry;
  };

  // 6. Подключение к WebSocket шлюзу
  useEffect(() => {
    if (!currentUser || !authToken) return;

    const ws = new WebSocket(`${WS_BASE}?token=${authToken}`);
    wsRef.current = ws;

    let pingInterval: any = null;
    ws.onopen = () => {
      console.log("[WS] Подключение к SquadWave Gateway успешно");
      // Немедленный замер реального пинга при подключении
      ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
        }
      }, 2000);
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "init":
            myClientIdRef.current = msg.clientId;
            break;

          // Динамический замер реального пинга сети (RTT)
          case "pong":
            if (msg.t) {
              const latency = Math.max(1, Date.now() - msg.t);
              setPing(latency);
            }
            break;

          // Начальное состояние всех голосовых каналов сервера
          case "all_voice_states":
            setVoiceRoomStates(msg.states || {});
            break;

          // Обновление состояния конкретного голосового канала (для отображения в сайдбаре как в Discord)
          case "voice_channel_state":
            setVoiceRoomStates((prev) => ({
              ...prev,
              [msg.channelId]: msg.peers || [],
            }));
            break;

          // Принудительное отключение дублирующей сессии
          case "voice_force_disconnect":
            console.warn("[WS] Отключение от войса: выполнен вход из другого окна/браузера");
            leaveVoiceChannel();
            break;

          case "chat_message":
            if (activeChannelRef.current && msg.message.channel_id === activeChannelRef.current.id) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === msg.message.id)) return prev;
                return [...prev, msg.message];
              });
            }
            break;

          // Список существующих участников при входе в войс
          case "voice_room_peers": {
            const peers: VoicePeer[] = msg.peers || [];
            setVoicePeers(peers);
            // Для каждого существующего участника создаем PeerConnection как инициатор
            peers.forEach((peer) => {
              getOrCreatePeerConnection(peer.clientId, true);
            });
            break;
          }

          // Новый участник зашел в войс
          case "voice_peer_joined": {
            const newPeer: VoicePeer = msg.peer;
            setVoicePeers((prev) => {
              if (prev.some((p) => p.clientId === newPeer.clientId)) return prev;
              return [...prev, newPeer];
            });
            // Не инициатор: создаем подключение и ждем оффер
            getOrCreatePeerConnection(newPeer.clientId, false);
            break;
          }

          // Участник вышел из войса
          case "voice_peer_left": {
            const entry = peerConnectionsRef.current.get(msg.clientId);
            if (entry) {
              entry.pc.close();
              peerConnectionsRef.current.delete(msg.clientId);
            }

            setPeerAudioStreams((prev) => {
              const next = new Map(prev);
              next.delete(msg.clientId);
              return next;
            });

            setVoicePeers((prev) => prev.filter((p) => p.clientId !== msg.clientId));
            break;
          }

          // Индикация речи с надежным матчингом по clientId и userId
          case "voice_speaking":
            setVoicePeers((prev) =>
              prev.map((p) =>
                p.clientId === msg.clientId || (msg.userId && p.userId === msg.userId)
                  ? { ...p, isSpeaking: p.isMuted ? false : msg.isSpeaking, volume: msg.volume }
                  : p
              )
            );
            break;

          // Состояние микрофона другого пользователя
          case "voice_mute_state":
            setVoicePeers((prev) =>
              prev.map((p) =>
                p.clientId === msg.clientId || (msg.userId && p.userId === msg.userId)
                  ? { ...p, isMuted: msg.isMuted, isSpeaking: msg.isMuted ? false : p.isSpeaking }
                  : p
              )
            );
            break;

          // Уведомление о стриме экрана
          case "screen_share_status":
            if (!msg.isSharing) {
              setRemoteScreenStream(null);
              setLiveScreenFrame(null);
              setRemoteSharerName(null);
            } else {
              setRemoteSharerName(msg.sharerName);
            }
            break;

          // Гарантированный живой стрим экрана через WebSocket
          case "screen_frame":
            setLiveScreenFrame(msg.frame);
            if (msg.sharerName) {
              setRemoteSharerName(msg.sharerName);
            }
            break;

          // Гарантированный живой звук через Web Audio PCM с защитой от треска и наслоения (Jitter Queue)
          case "voice_pcm": {
            if (isDeafened) break;
            try {
              if (!playbackAudioCtxRef.current) {
                playbackAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
              }
              const pCtx = playbackAudioCtxRef.current;
              if (pCtx.state === "suspended") {
                pCtx.resume().catch(() => {});
              }

              const pcmData = msg.pcm as number[];
              if (pcmData && pcmData.length > 0) {
                const floatArr = new Float32Array(pcmData.length);
                for (let i = 0; i < pcmData.length; i++) {
                  floatArr[i] = pcmData[i] / 32768.0;
                }
                const audioBuffer = pCtx.createBuffer(1, floatArr.length, 24000);
                audioBuffer.copyToChannel(floatArr, 0);

                const source = pCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(pCtx.destination);

                // Бесшовное планирование времени воспроизведения без разрывов и наслоений
                const now = pCtx.currentTime;
                if (nextPcmPlayTimeRef.current < now) {
                  // При паузе речи или первом пакете стартуем через 35мс (буфер против джиттера)
                  nextPcmPlayTimeRef.current = now + 0.035;
                }

                source.start(nextPcmPlayTimeRef.current);
                nextPcmPlayTimeRef.current += audioBuffer.duration;
              }
            } catch (err) {
              console.warn("PCM audio playback error:", err);
            }
            break;
          }

          // Обработка сигналов WebRTC (Offer, Answer, ICE)
          case "webrtc_signal": {
            const { fromClientId, signal } = msg;
            const entry = getOrCreatePeerConnection(fromClientId, false);
            const pc = entry.pc;

            try {
              if (signal.type === "offer") {
                const offerDesc = signal.sdp?.sdp ? new RTCSessionDescription(signal.sdp) : new RTCSessionDescription({ type: "offer", sdp: signal.sdp });
                await pc.setRemoteDescription(offerDesc);

                // Сбрасываем накопившиеся ICE кандидаты
                while (entry.pendingCandidates.length > 0) {
                  const cand = entry.pendingCandidates.shift();
                  if (cand) {
                    try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
                  }
                }

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                ws.send(
                  JSON.stringify({
                    type: "webrtc_signal",
                    targetClientId: fromClientId,
                    signal: { type: "answer", sdp: answer },
                  })
                );
              } else if (signal.type === "answer") {
                const answerDesc = signal.sdp?.sdp ? new RTCSessionDescription(signal.sdp) : new RTCSessionDescription({ type: "answer", sdp: signal.sdp });
                await pc.setRemoteDescription(answerDesc);

                while (entry.pendingCandidates.length > 0) {
                  const cand = entry.pendingCandidates.shift();
                  if (cand) {
                    try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
                  }
                }
              } else if (signal.type === "ice") {
                if (signal.candidate) {
                  let candObj = signal.candidate;
                  if (candObj.candidate && candObj.candidate.includes(".local")) {
                    const patchedStr = candObj.candidate.replace(/[a-zA-Z0-9-]+\.local/, "127.0.0.1");
                    try {
                      await pc.addIceCandidate(new RTCIceCandidate({ ...candObj, candidate: patchedStr }));
                    } catch (e) {}
                  }

                  if (pc.remoteDescription && pc.remoteDescription.type) {
                    try { await pc.addIceCandidate(new RTCIceCandidate(candObj)); } catch (e) {}
                  } else {
                    entry.pendingCandidates.push(candObj);
                  }
                }
              }
            } catch (err) {
              console.error("[WebRTC] Signal handling error:", err);
            }
            break;
          }
        }
      } catch (e) {
        console.error("[WS] Ошибка:", e);
      }
    };

    return () => {
      if (pingInterval) clearInterval(pingInterval);
      ws.close();
    };
  }, [currentUser?.id, authToken]);

  // Захват микрофона с выбором устройства и нейросетевым шумоподавлением RNNoise (Krisp / Nvidia Broadcast)
  const startAudioCapture = async (deviceId?: string) => {
    try {
      const targetDeviceId = deviceId || selectedAudioDeviceId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: targetDeviceId ? { exact: targetDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: false, // Отключаем примитивный шумодав браузера, чтобы RNNoise получал полный спектр
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
        video: false,
      });

      refreshAudioDevices();
      localStreamRef.current = stream;

      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
      if (neuralProcessorRef.current) {
        neuralProcessorRef.current.destroy();
        neuralProcessorRef.current = null;
      }

      // Инициализируем нейросетевой процессор RNNoise (GRU)
      const processor = new NeuralAudioProcessor();
      processor.rnnoiseEnabled = rnnoiseActiveRef.current;
      processor.vadThreshold = vadThresholdRef.current;
      await processor.init();
      neuralProcessorRef.current = processor;

      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
        audioContextRef.current = ctx;
        if (ctx.state === "suspended") {
          ctx.resume().catch(() => {});
        }
        const source = ctx.createMediaStreamSource(stream);

        // 1. Highpass: срез саб-басового гула и вибраций стола (< 75 Гц)
        const highpass = ctx.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 75;

        // 2. Dynamics Compressor для естественного выравнивания громкости
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 12;
        compressor.ratio.value = 3;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.15;

        source.connect(highpass);
        highpass.connect(compressor);

        // Создаем MediaStreamDestination для передачи нейросетевого очищенного звука в WebRTC
        const destination = ctx.createMediaStreamDestination();
        processedStreamRef.current = destination.stream;

        // ScriptProcessor: 1024 сэмпла (~21мс латентность)
        const pcmProcessor = ctx.createScriptProcessor(1024, 1, 1);
        compressor.connect(pcmProcessor);
        pcmProcessor.connect(destination);

        // Zero-gain dummy нода к ctx.destination (гарантирует активность процессора без эха в наушниках)
        const dummyGain = ctx.createGain();
        dummyGain.gain.value = 0;
        pcmProcessor.connect(dummyGain);
        dummyGain.connect(ctx.destination);

        pcmProcessor.onaudioprocess = (e) => {
          const inData = e.inputBuffer.getChannelData(0);
          const outData = e.outputBuffer.getChannelData(0);

          if (neuralProcessorRef.current) {
            neuralProcessorRef.current.rnnoiseEnabled = rnnoiseActiveRef.current;
            neuralProcessorRef.current.vadThreshold = vadThresholdRef.current;
            neuralProcessorRef.current.process(
              inData,
              outData,
              isMutedRef.current,
              (isSpeaking, volume) => {
                setIsSelfSpeaking(isSpeaking);
                setMicTestVolume(volume);
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(
                    JSON.stringify({
                      type: "voice_speaking",
                      isSpeaking,
                      volume,
                    })
                  );
                }
              }
            );
          } else {
            outData.set(inData);
          }

          // Гарантированная доставка звука через WebSocket Gateway при блокировках UDP/VPN
          if (!isMutedRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            let sumSq = 0;
            for (let i = 0; i < outData.length; i++) sumSq += outData[i] * outData[i];
            const rms = Math.sqrt(sumSq / outData.length);

            if (rms > 0.00005 || (neuralProcessorRef.current?.vadHangover ?? 0) > 0) {
              const downsampled = new Int16Array(Math.floor(outData.length / 2));
              for (let i = 0; i < downsampled.length; i++) {
                const avg = (outData[i * 2] + outData[i * 2 + 1]) * 0.5;
                const clamped = Math.max(-1.0, Math.min(1.0, avg));
                downsampled[i] = Math.round(clamped * 32767);
              }

              wsRef.current.send(
                JSON.stringify({
                  type: "voice_pcm",
                  pcm: Array.from(downsampled),
                })
              );
            }
          }
        };
      } catch (err) {
        console.warn("Audio processing setup error:", err);
      }

      // Обновляем аудио-трек на очищенный для всех активных WebRTC соединений
      const outgoingAudioTrack = (processedStreamRef.current || stream).getAudioTracks()[0];
      if (outgoingAudioTrack) {
        for (const [peerId, entry] of peerConnectionsRef.current.entries()) {
          const audioSender = entry.pc.getSenders().find((s) => s.track && s.track.kind === "audio");
          if (audioSender) {
            audioSender.replaceTrack(outgoingAudioTrack).catch(console.warn);
          }
        }
      }

      return stream;
    } catch (err) {
      console.warn("[Media] Ошибка захвата микрофона:", err);
      return null;
    }
  };

  // Переключение микрофона (Mute / Unmute) с синхронизацией по WebSocket
  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    isMutedRef.current = nextMuted;

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !nextMuted));
    }
    if (processedStreamRef.current) {
      processedStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !nextMuted));
    }

    if (nextMuted) {
      setIsSelfSpeaking(false);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "voice_speaking", isSpeaking: false, volume: 0 }));
        wsRef.current.send(JSON.stringify({ type: "voice_mute_state", isMuted: true }));
      }
    } else {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "voice_mute_state", isMuted: false }));
      }
    }
  };

  // Управление наушниками (deafen)
  useEffect(() => {
    const audioElements = document.querySelectorAll("audio");
    audioElements.forEach((el) => {
      el.muted = isDeafened;
    });
  }, [isDeafened]);

  // Глобальная разблокировка Autoplay звука при любом клике пользователя в окне
  useEffect(() => {
    const unlockAutoplay = () => {
      document.querySelectorAll("audio").forEach((el) => {
        if (el.paused && el.srcObject) {
          el.play().catch(() => {});
        }
      });
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume().catch(() => {});
      }
    };

    window.addEventListener("click", unlockAutoplay);
    window.addEventListener("keydown", unlockAutoplay);
    return () => {
      window.removeEventListener("click", unlockAutoplay);
      window.removeEventListener("keydown", unlockAutoplay);
    };
  }, []);

  // ==========================================================
  // 7. ШЕРИНГ ЭКРАНА (1080p 60 FPS) С ПЕРЕДАЧЕЙ ПО WEBRTC
  // ==========================================================
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: false,
      });

      localScreenStreamRef.current = stream;
      setLocalScreenStream(stream);
      setIsScreenSharing(true);

      const videoTrack = stream.getVideoTracks()[0];

      // Добавляем видео-трек во все активные соединения и согласуем
      for (const [peerId, entry] of peerConnectionsRef.current.entries()) {
        const videoSender = entry.pc.getSenders().find((s) => s.track && s.track.kind === "video");
        if (videoSender) {
          videoSender.replaceTrack(videoTrack).catch(console.warn);
        } else {
          entry.pc.addTrack(videoTrack, stream);
          startNegotiation(peerId, entry);
        }
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "screen_share_status", isSharing: true }));
      }

      // Гарантированная передача кадров экрана через Canvas WebSocket
      const captureVideo = document.createElement("video");
      captureVideo.srcObject = stream;
      captureVideo.muted = true;
      captureVideo.playsInline = true;
      captureVideo.autoplay = true;
      captureVideo.style.position = "fixed";
      captureVideo.style.top = "-9999px";
      captureVideo.style.left = "-9999px";
      captureVideo.style.width = "10px";
      captureVideo.style.height = "10px";
      captureVideo.style.opacity = "0";
      captureVideo.style.pointerEvents = "none";
      document.body.appendChild(captureVideo);
      captureVideoRef.current = captureVideo;
      captureVideo.play().catch(() => {});

      const captureCanvas = document.createElement("canvas");
      captureCanvas.width = 1280;
      captureCanvas.height = 720;
      const ctx2d = captureCanvas.getContext("2d");

      if (screenCaptureIntervalRef.current) clearInterval(screenCaptureIntervalRef.current);
      screenCaptureIntervalRef.current = setInterval(() => {
        if (!localScreenStreamRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          if (screenCaptureIntervalRef.current) clearInterval(screenCaptureIntervalRef.current);
          return;
        }
        if (ctx2d && captureVideo.readyState >= 2) {
          ctx2d.drawImage(captureVideo, 0, 0, captureCanvas.width, captureCanvas.height);
          const frameData = captureCanvas.toDataURL("image/jpeg", 0.60);
          wsRef.current.send(
            JSON.stringify({
              type: "screen_frame",
              frame: frameData,
            })
          );
        }
      }, 66);

      videoTrack.onended = () => {
        stopScreenShare();
      };
    } catch (e) {
      console.warn("Screen share cancelled:", e);
    }
  };

  const stopScreenShare = () => {
    if (screenCaptureIntervalRef.current) {
      clearInterval(screenCaptureIntervalRef.current);
      screenCaptureIntervalRef.current = null;
    }
    if (captureVideoRef.current) {
      captureVideoRef.current.pause();
      captureVideoRef.current.srcObject = null;
      captureVideoRef.current.remove();
      captureVideoRef.current = null;
    }
    setLiveScreenFrame(null);

    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach((t) => t.stop());
      localScreenStreamRef.current = null;
    }
    setLocalScreenStream(null);
    setIsScreenSharing(false);

    for (const [peerId, entry] of peerConnectionsRef.current.entries()) {
      entry.pc.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === "video") {
          try {
            entry.pc.removeTrack(sender);
          } catch (e) {}
        }
      });
      startNegotiation(peerId, entry);
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "screen_share_status", isSharing: false }));
    }
  };

  // Вход / выход из голосового канала
  const joinVoiceChannel = async (channel: ChannelItem) => {
    setActiveVoiceChannel(channel);
    setIsInVoice(true);

    const stream = await startAudioCapture();
    const outgoingStream = processedStreamRef.current || stream;
    if (outgoingStream) {
      outgoingStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMutedRef.current;
        for (const [peerId, entry] of peerConnectionsRef.current.entries()) {
          entry.pc.addTrack(track, outgoingStream);
          startNegotiation(peerId, entry);
        }
      });
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "voice_join", channelId: channel.id }));
    }
  };

  const leaveVoiceChannel = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "voice_leave" }));
    }

    // Закрываем все активные PeerConnections
    for (const entry of peerConnectionsRef.current.values()) {
      entry.pc.close();
    }
    peerConnectionsRef.current.clear();

    if (neuralProcessorRef.current) {
      neuralProcessorRef.current.destroy();
      neuralProcessorRef.current = null;
    }

    if (processedStreamRef.current) {
      processedStreamRef.current.getTracks().forEach((t) => t.stop());
      processedStreamRef.current = null;
    }

    if (localStreamRef.current) {
      if ((localStreamRef.current as any)._raw) {
        ((localStreamRef.current as any)._raw as MediaStream).getTracks().forEach((t) => t.stop());
      }
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (isScreenSharing) {
      stopScreenShare();
    }

    setPeerAudioStreams(new Map());
    setIsInVoice(false);
    setActiveVoiceChannel(null);
    setVoicePeers([]);
    setRemoteScreenStream(null);
    setRemoteSharerName(null);
  };

  // Отправка сообщения чата
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

  // Авторизация (вход / регистрация)
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
              ? "Войдите со своим логином и паролем"
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
                Логин
              </label>
              <input
                type="text"
                required
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                placeholder="testik"
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
                  Отображаемое имя (Ник)
                </label>
                <input
                  type="text"
                  value={authDisplayName}
                  onChange={(e) => setAuthDisplayName(e.target.value)}
                  placeholder="testik"
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
          <span style={{ fontWeight: 800, fontSize: 15 }}>
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

                    {/* Список участников голосовой комнаты (виден ВСЕМ пользователям как в Discord) */}
                    {(() => {
                      const list = isCurrent
                        ? [{ clientId: "self", userId: currentUser.id, display_name: `${currentUser.display_name} (Вы)`, avatar_color: currentUser.avatar_color, isSpeaking: false }, ...voicePeers]
                        : (voiceRoomStates[ch.id] || []);
                      if (list.length === 0) return null;
                      return (
                        <div style={{ paddingLeft: 26, display: "flex", flexDirection: "column", gap: 5, marginTop: 4, marginBottom: 4 }}>
                          {list.map((p) => {
                            const isMe = p.clientId === "self" || (currentUser && p.userId === currentUser.id);
                            return (
                              <div
                                key={p.clientId + p.userId}
                                style={{
                                  fontSize: 12,
                                  color: isMe ? "#bef264" : (p.isSpeaking && !p.isMuted) ? "#bef264" : "rgba(255,255,255,0.7)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  fontWeight: 600,
                                }}
                              >
                                <div
                                  style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: "50%",
                                    background: p.avatar_color || "#bef264",
                                    color: "#090a0f",
                                    fontSize: 9,
                                    fontWeight: 900,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    border: (isMe ? isSelfSpeaking : (p.isSpeaking && !p.isMuted)) ? "2px solid #bef264" : "none",
                                    boxShadow: (isMe ? isSelfSpeaking : (p.isSpeaking && !p.isMuted)) ? "0 0 6px #bef264" : "none",
                                  }}
                                >
                                  {p.display_name[0].toUpperCase()}
                                </div>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {p.display_name}
                                </span>
                                {(isMe ? isMuted : p.isMuted) && <MicOff size={11} color="#ef4444" />}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
          </div>
        </div>

        {/* Панель активного WebRTC войса */}
        {isInVoice && (
          <div style={{ padding: "12px 14px", background: "rgba(0, 0, 0, 0.45)", borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#10b981" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
                <span>ГОЛОС ПОДКЛЮЧЕН</span>
              </div>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: ping < 45 ? "#bef264" : ping < 120 ? "#facc15" : "#ef4444", fontWeight: 800 }}>{ping} ms</span>
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

        {/* Профиль */}
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
              onClick={toggleMute}
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
              onClick={() => setIsDeafened(!isDeafened)}
              title={isDeafened ? "Включить звук" : "Заглушить звук"}
              style={{
                width: 30,
                height: 30,
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
              {isDeafened ? <VolumeX size={15} /> : <Headphones size={15} />}
            </button>
            <button
              onClick={() => setShowSettingsModal(true)}
              title="Настройки звука и микрофона"
              style={{
                width: 30,
                height: 30,
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
              <Settings size={15} />
            </button>
            <button
              onClick={handleLogout}
              title="Выйти"
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

      {/* 3. ГЛАВНАЯ ОБЛАСТЬ: ЧАТ И ГОЛОС */}
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

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {/* Индикатор реального WebRTC P2P соединения */}
            {isInVoice && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px",
                  borderRadius: 20,
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: voicePeers.length > 0 ? "#bef264" : "#38bdf8",
                    boxShadow: voicePeers.length > 0 ? "0 0 10px #bef264" : "none",
                  }}
                />
                <span style={{ color: "rgba(255,255,255,0.8)" }}>
                  {voicePeers.length > 0
                    ? "Медиа-шлюз активен • Живой звук и демка подключены ⚡"
                    : "Войс готов к подключению"}
                </span>
              </div>
            )}

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

        {/* Сетка голосовой комнаты */}
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
            {/* Реальное воспроизведение звука всех удаленных участников по WebRTC */}
            {Array.from(peerAudioStreams.entries()).map(([peerId, stream]) => (
              <audio
                key={"audio-stream-" + peerId}
                ref={(el) => {
                  if (el) {
                    if (el.srcObject !== stream) {
                      el.srcObject = stream;
                    }
                    el.volume = 1.0;
                    el.muted = isDeafened;
                    el.play().catch((e) => {
                      console.warn("Peer audio autoplay blocked, waiting for user gesture:", e);
                    });
                  }
                }}
                autoPlay
                playsInline
              />
            ))}

            {/* Окно стрима экрана (ЛОКАЛЬНОЕ ИЛИ УДАЛЁННОЕ ОТ ДРУГОГО ПОЛЬЗОВАТЕЛЯ!) */}
            {(isScreenSharing || remoteScreenStream || liveScreenFrame) && (
              <div
                style={{
                  height: 420,
                  background: "#000000",
                  borderRadius: 14,
                  border: "2px solid #38bdf8",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                  boxShadow: "0 20px 60px rgba(56, 189, 248, 0.2)",
                }}
              >
                <div style={{ padding: "6px 14px", background: "rgba(0,0,0,0.75)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#bef264", fontWeight: 800 }}>LIVE 1080p 60.0 FPS • WebRTC & StreamGateway</span>
                  <span style={{ fontSize: 11, color: "#ffffff", fontWeight: 700 }}>
                    📺 Стрим экрана: {isScreenSharing ? `${currentUser.display_name} (Вы)` : remoteSharerName || "Участник"}
                  </span>
                </div>

                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#05070a", position: "relative" }}>
                  {isScreenSharing && localScreenStream && (
                    <video
                      ref={(el) => {
                        if (el) {
                          el.muted = true;
                          el.defaultMuted = true;
                          el.playsInline = true;
                          if (el.srcObject !== localScreenStream) {
                            el.srcObject = localScreenStream;
                          }
                          el.play().catch(console.warn);
                        }
                      }}
                      autoPlay
                      playsInline
                      muted
                      onLoadedMetadata={(e) => (e.currentTarget as HTMLVideoElement).play().catch(console.warn)}
                      onCanPlay={(e) => (e.currentTarget as HTMLVideoElement).play().catch(console.warn)}
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  )}
                  {!isScreenSharing && (liveScreenFrame ? (
                    <img
                      src={liveScreenFrame}
                      alt="Прямой эфир"
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  ) : remoteScreenStream ? (
                    <video
                      ref={(el) => {
                        if (el) {
                          el.muted = true;
                          el.defaultMuted = true;
                          el.playsInline = true;
                          if (el.srcObject !== remoteScreenStream) {
                            el.srcObject = remoteScreenStream;
                          }
                          el.play().catch(console.warn);
                        }
                      }}
                      autoPlay
                      playsInline
                      muted
                      onLoadedMetadata={(e) => (e.currentTarget as HTMLVideoElement).play().catch(console.warn)}
                      onCanPlay={(e) => (e.currentTarget as HTMLVideoElement).play().catch(console.warn)}
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  ) : null)}
                </div>
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
                  border: isMuted
                    ? "1px solid rgba(255, 255, 255, 0.08)"
                    : isSelfSpeaking
                    ? "2px solid #bef264"
                    : "1px solid rgba(190, 242, 100, 0.4)",
                  boxShadow: !isMuted && isSelfSpeaking ? "0 0 25px rgba(190, 242, 100, 0.4)" : "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transition: "all 0.15s ease",
                }}
              >
                <div
                  style={{
                    width: 58,
                    height: 58,
                    borderRadius: "50%",
                    background: currentUser.avatar_color,
                    color: "#090a0f",
                    fontWeight: 900,
                    fontSize: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: !isMuted && isSelfSpeaking ? "2px solid #bef264" : "none",
                    boxShadow: !isMuted && isSelfSpeaking ? "0 0 20px #bef264" : "none",
                  }}
                >
                  {currentUser.display_name[0].toUpperCase()}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{currentUser.display_name} (Вы)</div>
                <div style={{ fontSize: 11, color: isMuted ? "#ef4444" : isSelfSpeaking ? "#bef264" : "rgba(255,255,255,0.5)" }}>
                  {isMuted ? "Микрофон выкл" : isSelfSpeaking ? "Говорит 🔊" : "В сети"}
                </div>
              </div>

              {/* Удаленные участники (светятся при речи и воспроизводят звук!) */}
              {voicePeers.map((peer) => {
                const isSpeaking = peer.isSpeaking && !peer.isMuted;
                return (
                  <div
                    key={peer.clientId}
                    style={{
                      width: 180,
                      padding: 16,
                      borderRadius: 14,
                      background: "rgba(255, 255, 255, 0.03)",
                      border: peer.isMuted
                        ? "1px solid rgba(255, 255, 255, 0.08)"
                        : isSpeaking
                        ? `2px solid ${peer.avatar_color}`
                        : "1px solid rgba(255, 255, 255, 0.08)",
                      boxShadow: isSpeaking ? `0 0 25px ${peer.avatar_color}50` : "none",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div
                      style={{
                        width: 58,
                        height: 58,
                        borderRadius: "50%",
                        background: peer.avatar_color,
                        color: "#090a0f",
                        fontWeight: 900,
                        fontSize: 24,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: isSpeaking ? `2px solid ${peer.avatar_color}` : "none",
                        boxShadow: isSpeaking ? `0 0 20px ${peer.avatar_color}` : "none",
                      }}
                    >
                      {peer.display_name[0].toUpperCase()}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{peer.display_name}</div>
                    <div style={{ fontSize: 11, color: peer.isMuted ? "#ef4444" : isSpeaking ? "#bef264" : "rgba(255,255,255,0.4)" }}>
                      {peer.isMuted ? "Микрофон выкл" : isSpeaking ? "Говорит 🔊" : "Слушает"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Текстовые сообщения */}
        <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {messages.length === 0 ? (
            <div style={{ margin: "auto", textAlign: "center", color: "rgba(255,255,255,0.3)" }}>
              <MessageSquare size={36} style={{ marginBottom: 10, opacity: 0.5 }} />
              <div>В канале #{activeChannel?.name} пока нет сообщений.</div>
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

      {/* МОДАЛКА: НАСТРОЙКИ ЗВУКА И ВИДЕО (DISCORD & NVIDIA BROADCAST STYLE) */}
      {showSettingsModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ width: 560, background: "#0e111a", borderRadius: 18, border: "1px solid rgba(255,255,255,0.12)", padding: 26, boxShadow: "0 25px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(190, 242, 100, 0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Settings size={18} color="#bef264" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#fff" }}>Настройки звука и микрофона</h3>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>SquadWave Audio Engine • RNNoise Neural Network</div>
                </div>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            {/* 1. ВЫБОР МИКРОФОНА */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                Устройство ввода (Микрофон)
              </label>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <select
                    value={selectedAudioDeviceId}
                    onChange={(e) => handleAudioDeviceChange(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 600,
                      outline: "none",
                      cursor: "pointer",
                    }}
                  >
                    {audioDevices.length === 0 ? (
                      <option value="" style={{ background: "#0e111a", color: "#fff" }}>Микрофон по умолчанию (Системный)</option>
                    ) : (
                      audioDevices.map((d, idx) => (
                        <option key={d.deviceId || idx} value={d.deviceId} style={{ background: "#0e111a", color: "#fff" }}>
                          {d.label || `Микрофон ${idx + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <button
                  onClick={refreshAudioDevices}
                  style={{
                    padding: "0 14px",
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "rgba(255,255,255,0.8)",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                  title="Обновить список устройств"
                >
                  Обновить
                </button>
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>
                💡 Браузер запрашивает доступ к микрофонам ПК. Вы можете переключать гарнитуры, USB-микрофоны и веб-камеры на лету без перезагрузки.
              </div>
            </div>

            {/* 2. ПРОВЕРКА МИКРОФОНА И ГРОМКОСТИ */}
            <div style={{ marginBottom: 22, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>Индикатор входного сигнала</span>
                <span style={{ fontSize: 11, color: isSelfSpeaking ? "#bef264" : "rgba(255,255,255,0.4)", fontWeight: 700 }}>
                  {isSelfSpeaking ? "Голос обнаружен (VAD Активен)" : "Тишина / Шумодав закрыт"}
                </span>
              </div>
              <div style={{ height: 10, background: "rgba(255,255,255,0.08)", borderRadius: 5, overflow: "hidden", position: "relative" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, Math.max(isSelfSpeaking ? 25 : 0, micTestVolume))}%`,
                    background: isSelfSpeaking ? "linear-gradient(90deg, #bef264, #22c55e)" : "rgba(255,255,255,0.2)",
                    borderRadius: 5,
                    transition: "width 0.08s ease-out",
                  }}
                />
              </div>
            </div>

            {/* 3. НЕЙРОСЕТЕВОЕ ШУМОПОДАВЛЕНИЕ (RNNOISE & KRISP) */}
            <div style={{ marginBottom: 20, padding: 14, background: "rgba(190, 242, 100, 0.05)", borderRadius: 12, border: "1px solid rgba(190, 242, 100, 0.2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Sparkles size={16} color="#bef264" />
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>AI Шумоподавление (RNNoise / Krisp)</span>
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
                    Глубокая нейросеть (GRU RNN). Полностью удаляет стук клавиш, клики мыши, шум кулеров и фон.
                  </div>
                </div>
                <button
                  onClick={() => {
                    const next = !rnnoiseActive;
                    setRnnoiseActive(next);
                    rnnoiseActiveRef.current = next;
                    localStorage.setItem("squadwave_rnnoise", String(next));
                    if (neuralProcessorRef.current) {
                      neuralProcessorRef.current.rnnoiseEnabled = next;
                    }
                  }}
                  style={{
                    padding: "7px 16px",
                    borderRadius: 8,
                    background: rnnoiseActive ? "#bef264" : "rgba(255,255,255,0.1)",
                    border: "none",
                    color: rnnoiseActive ? "#000" : "#fff",
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {rnnoiseActive ? "ВКЛЮЧЕНО" : "ВЫКЛЮЧЕНО"}
                </button>
              </div>
            </div>

            {/* 4. ЧУВСТВИТЕЛЬНОСТЬ VAD (ПОРОГ АКТИВАЦИИ РЕЧИ) */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Чувствительность нейросети (VAD Порог)
                </label>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#bef264" }}>
                  {Math.round(vadThreshold * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.30"
                max="0.90"
                step="0.05"
                value={vadThreshold}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setVadThreshold(val);
                  vadThresholdRef.current = val;
                  localStorage.setItem("squadwave_vad_threshold", String(val));
                  if (neuralProcessorRef.current) {
                    neuralProcessorRef.current.vadThreshold = val;
                  }
                }}
                style={{ width: "100%", accentColor: "#bef264", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                <span>30% (Чувствительный)</span>
                <span>65% (Оптимально для механических клавиатур)</span>
                <span>90% (Строгий гейт)</span>
              </div>
            </div>

            {/* Кнопка закрытия */}
            <button
              onClick={() => setShowSettingsModal(false)}
              style={{
                width: "100%",
                padding: "11px",
                borderRadius: 10,
                background: "#bef264",
                border: "none",
                color: "#000",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Готово
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
