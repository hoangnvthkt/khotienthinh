import { useState, useCallback, useRef, useEffect } from 'react';

// ══════════════════════════════════════════
//  useVoiceInput — Web Speech API wrapper
//  Ngôn ngữ mặc định: Tiếng Việt (vi-VN)
// ══════════════════════════════════════════

interface UseVoiceInputOptions {
  lang?: string;          // BCP 47 language code, default: 'vi-VN'
  continuous?: boolean;   // Keep listening after pause, default: true
  interimResults?: boolean; // Show partial results, default: true
  onResult?: (text: string) => void;
  onError?: (error: string) => void;
}

interface UseVoiceInputReturn {
  isListening: boolean;
  isSupported: boolean;
  transcript: string;
  interimTranscript: string;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
  resetTranscript: () => void;
}

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const {
    lang = 'vi-VN',
    continuous = true,
    interimResults = true,
    onResult,
    onError,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  // Check browser support
  const isSupported = typeof window !== 'undefined' && (
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  );

  // Initialize recognition
  const getRecognition = useCallback(() => {
    if (recognitionRef.current) return recognitionRef.current;
    if (!isSupported) return null;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let finalText = '';
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript + ' ';
        } else {
          interimText += result[0].transcript;
        }
      }

      if (finalText) {
        setTranscript(prev => {
          const newText = prev + finalText;
          onResult?.(newText.trim());
          return newText;
        });
      }
      setInterimTranscript(interimText);
    };

    recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        onError?.('Microphone access denied. Please allow microphone permission.');
      } else if (event.error === 'no-speech') {
        // Ignore no-speech errors, just continue
      } else {
        onError?.(`Speech recognition error: ${event.error}`);
      }
      if (event.error !== 'no-speech') {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (recognitionRef.current?._shouldContinue) {
        try {
          recognition.start();
        } catch {
          setIsListening(false);
        }
      } else {
        setIsListening(false);
      }
      setInterimTranscript('');
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [lang, continuous, interimResults, isSupported, onResult, onError]);

  const startListening = useCallback(() => {
    const recognition = getRecognition();
    if (!recognition) return;

    try {
      recognition._shouldContinue = true;
      recognition.start();
      setIsListening(true);
    } catch (err) {
      console.warn('Failed to start speech recognition:', err);
    }
  }, [getRecognition]);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    recognition._shouldContinue = false;
    try {
      recognition.stop();
    } catch {}
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current._shouldContinue = false;
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    toggleListening,
    resetTranscript,
  };
}
