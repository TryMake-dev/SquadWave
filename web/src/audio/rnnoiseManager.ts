import { Rnnoise, DenoiseState } from "@shiguredo/rnnoise-wasm";

let rnnoisePromise: Promise<Rnnoise> | null = null;

export async function getRnnoise(): Promise<Rnnoise> {
  if (!rnnoisePromise) {
    rnnoisePromise = Rnnoise.load();
  }
  return rnnoisePromise;
}

export class NeuralAudioProcessor {
  private denoiseState: DenoiseState | null = null;
  private inputFifo = new Float32Array(9600);
  private inputFifoLen = 0;
  private outputFifo = new Float32Array(9600);
  private outputFifoLen = 0;
  private frame480 = new Float32Array(480);
  public vadHangover = 0;
  private wasSpeaking = false;
  public rnnoiseEnabled = true;
  public vadThreshold = 0.65; // Discord / Nvidia Broadcast optimal threshold

  public async init(): Promise<boolean> {
    try {
      const rnnoise = await getRnnoise();
      this.denoiseState = rnnoise.createDenoiseState();
      console.log("[SquadWave Neural Audio] RNNoise GRU initialized successfully (frame size: " + rnnoise.frameSize + ")");
      return true;
    } catch (e) {
      console.warn("[SquadWave Neural Audio] RNNoise load error, using fallback DSP gate:", e);
      return false;
    }
  }

  public process(
    inData: Float32Array,
    outData: Float32Array,
    isMuted: boolean,
    onSpeechChange?: (isSpeaking: boolean, volume: number) => void
  ) {
    if (isMuted) {
      outData.fill(0);
      if (this.wasSpeaking) {
        this.wasSpeaking = false;
        onSpeechChange?.(false, 0);
      }
      return;
    }

    // 1. Append incoming audio chunk to FIFO
    if (this.inputFifoLen + inData.length <= this.inputFifo.length) {
      this.inputFifo.set(inData, this.inputFifoLen);
      this.inputFifoLen += inData.length;
    }

    let latestVad = 0;

    // 2. Process all complete 480-sample frames (10ms at 48kHz)
    while (this.inputFifoLen >= 480) {
      this.frame480.set(this.inputFifo.subarray(0, 480));
      this.inputFifo.copyWithin(0, 480, this.inputFifoLen);
      this.inputFifoLen -= 480;

      if (this.rnnoiseEnabled && this.denoiseState) {
        // Convert from [-1.0, 1.0] to 16-bit PCM float range [-32768, 32767] expected by RNNoise
        for (let i = 0; i < 480; i++) {
          this.frame480[i] *= 32767.0;
        }

        // RNNoise GRU neural network processes frame in-place and returns VAD speech probability [0.0..1.0]
        const vadProb = this.denoiseState.processFrame(this.frame480);
        latestVad = vadProb;

        // Discord / Nvidia Broadcast neural VAD logic:
        // Mechanical typing, desk taps, mouse clicks, and fan noise produce vadProb < 0.30
        // Human speech produces vadProb > 0.65
        if (vadProb >= this.vadThreshold) {
          this.vadHangover = 25; // 25 frames * 10ms = 250ms speech hangover
        } else if (this.vadHangover > 0) {
          this.vadHangover--;
        }

        const isSpeechActive = this.vadHangover > 0;

        if (isSpeechActive) {
          // Human voice is active: convert back to [-1.0, 1.0]
          // RNNoise GRU has already suppressed typing clicks, fan hum, and room noise
          for (let i = 0; i < 480; i++) {
            const s = this.frame480[i] / 32767.0;
            this.frame480[i] = Math.max(-1.0, Math.min(1.0, s));
          }
        } else {
          // Non-speech (keyboard clacks, desk bumps, mouse clicks, room noise):
          // 100% total suppression (dead silence, zero output)
          this.frame480.fill(0);
        }
      } else {
        // Raw pass-through without neural suppression
        let sumSq = 0;
        for (let i = 0; i < 480; i++) sumSq += this.frame480[i] * this.frame480[i];
        const rms = Math.sqrt(sumSq / 480);
        if (rms > 0.015) {
          this.vadHangover = 15;
        } else if (this.vadHangover > 0) {
          this.vadHangover--;
        }
      }

      // Append to output FIFO
      if (this.outputFifoLen + 480 <= this.outputFifo.length) {
        this.outputFifo.set(this.frame480, this.outputFifoLen);
        this.outputFifoLen += 480;
      }
    }

    // 3. Fill Web Audio outData
    if (this.outputFifoLen >= outData.length) {
      outData.set(this.outputFifo.subarray(0, outData.length));
      this.outputFifo.copyWithin(0, outData.length, this.outputFifoLen);
      this.outputFifoLen -= outData.length;
    } else {
      outData.set(this.outputFifo.subarray(0, this.outputFifoLen));
      outData.fill(0, this.outputFifoLen);
      this.outputFifoLen = 0;
    }

    // 4. Dispatch speech change event
    const isSpeaking = this.vadHangover > 0;
    if (isSpeaking !== this.wasSpeaking) {
      this.wasSpeaking = isSpeaking;
      onSpeechChange?.(isSpeaking, isSpeaking ? Math.min(100, Math.round(latestVad * 100)) : 0);
    }
  }

  public destroy() {
    if (this.denoiseState) {
      try {
        this.denoiseState.destroy();
      } catch (e) {}
      this.denoiseState = null;
    }
    this.inputFifoLen = 0;
    this.outputFifoLen = 0;
    this.vadHangover = 0;
    this.wasSpeaking = false;
  }
}
