const TARGET_RMS = 0.1;
const SPEECH_GATE_RMS = 0.008;
const MIN_GAIN = 0.5;
const MAX_GAIN = 4;
const PEAK_LIMIT = 0.98;
const ATTACK = 0.18;
const RELEASE = 0.015;
const SILENCE_RELEASE = 0.01;

class TowkAutomaticGainControlProcessor extends AudioWorkletProcessor {
  currentGain = 1;

  /**
   * @param {Float32Array[][]} inputs
   * @param {Float32Array[][]} outputs
   */
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input?.length || !output?.length) return true;

    let sumSquares = 0;
    let peak = 0;
    let sampleCount = 0;
    for (const channel of input) {
      for (const sample of channel) {
        sumSquares += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
        sampleCount += 1;
      }
    }

    const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
    let desiredGain = 1;
    let smoothing = SILENCE_RELEASE;
    if (rms >= SPEECH_GATE_RMS) {
      desiredGain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET_RMS / rms));
      if (peak > 0) desiredGain = Math.min(desiredGain, PEAK_LIMIT / peak);
      smoothing = desiredGain < this.currentGain ? ATTACK : RELEASE;
    }
    this.currentGain += (desiredGain - this.currentGain) * smoothing;

    for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
      const inputChannel = input[Math.min(channelIndex, input.length - 1)];
      const outputChannel = output[channelIndex];
      if (!inputChannel) {
        outputChannel.fill(0);
        continue;
      }
      for (let sampleIndex = 0; sampleIndex < outputChannel.length; sampleIndex += 1) {
        const amplified = inputChannel[sampleIndex] * this.currentGain;
        outputChannel[sampleIndex] = Math.max(-PEAK_LIMIT, Math.min(PEAK_LIMIT, amplified));
      }
    }

    return true;
  }
}

registerProcessor('towk-automatic-gain-control', TowkAutomaticGainControlProcessor);
