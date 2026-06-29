type SoundVariant = 'normal' | 'urgent' | 'success';

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;
let lastPlayedAt = 0;

const getAudioContext = async () => {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
  if (!AudioContextCtor) return null;

  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContextCtor();
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  return audioContext;
};

const playTone = (
  context: AudioContext,
  frequency: number,
  duration: number,
  delay = 0,
  volume = 0.055,
) => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startAt = context.currentTime + delay;
  const stopAt = startAt + duration;

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(stopAt + 0.02);
};

const getSequence = (variant: SoundVariant) => {
  if (variant === 'urgent') {
    return [
      { frequency: 880, duration: 0.09, delay: 0 },
      { frequency: 1175, duration: 0.11, delay: 0.12 },
      { frequency: 880, duration: 0.09, delay: 0.28 },
    ];
  }
  if (variant === 'success') {
    return [
      { frequency: 659, duration: 0.08, delay: 0 },
      { frequency: 988, duration: 0.12, delay: 0.1 },
    ];
  }
  return [
    { frequency: 740, duration: 0.08, delay: 0 },
    { frequency: 988, duration: 0.11, delay: 0.1 },
  ];
};

export const notificationSoundService = {
  async prime(): Promise<boolean> {
    try {
      return Boolean(await getAudioContext());
    } catch {
      return false;
    }
  },

  async play(variant: SoundVariant = 'normal', options: { force?: boolean } = {}): Promise<boolean> {
    if (!options.force && Date.now() - lastPlayedAt < 800) return false;

    try {
      const context = await getAudioContext();
      if (!context) return false;
      lastPlayedAt = Date.now();
      getSequence(variant).forEach((tone) => {
        playTone(context, tone.frequency, tone.duration, tone.delay);
      });
      return true;
    } catch {
      return false;
    }
  },
};
