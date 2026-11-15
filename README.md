# Squad Voice — Легковесный Self-Hosted WebRTC аналог Discord

> Современный голосовой мессенджер с ультранизкой задержкой (18 ms), чистым звуком Opus 128 kbps, бесплатным шерингом экрана 1080p 60fps и нейросетевым шумоподавлением RNNoise.

## Стек технологий
- **Backend:** Go (Golang) + Pion WebRTC (SFU топология) + WebSockets
- **Протокол:** Protocol Buffers (protobuf v3)
- **Frontend:** React + TypeScript + Tailwind CSS + PWA (Progressive Web App)
- **Аудио:** Opus Codec (48kHz Stereo, 128 kbps) + RNNoise (WebAssembly)
- **Инфраструктура:** Docker, Docker Compose, Coturn (STUN/TURN)

## Быстрый старт за 40 секунд
```bash
git clone https://github.com/squad-hq/webrtc-voice-web.git
cd webrtc-voice-web
docker compose up -d
```
Откройте в браузере: `https://localhost:8443`
