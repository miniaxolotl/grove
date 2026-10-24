/** An explicit Play action owns playback until another player takes over. */
let owner: HTMLAudioElement | null = null;
export function claimAudio(element: HTMLAudioElement) {
  if (owner !== element) owner?.pause();
  owner = element;
}
export function releaseAudio(element: HTMLAudioElement) {
  if (owner === element) owner = null;
}
