let activeAudio: HTMLAudioElement | null = null;

export function claimVoiceMessagePlayback(audio: HTMLAudioElement): void {
  if (activeAudio && activeAudio !== audio) activeAudio.pause();
  activeAudio = audio;
}

export function releaseVoiceMessagePlayback(audio: HTMLAudioElement): void {
  if (activeAudio === audio) activeAudio = null;
}
