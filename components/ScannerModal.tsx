import React, { useEffect, useRef, useState } from 'react';
import { BrowserCodeReader, BrowserQRCodeReader, IScannerControls } from '@zxing/browser';
import { X, Camera, RefreshCw, Keyboard, Loader2 } from 'lucide-react';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (result: string) => void;
  title?: string;
  description?: string;
  manualPlaceholder?: string;
}

const getCameraErrorMessage = (error: unknown): string => {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError') return 'Trình duyệt chưa được cấp quyền camera. Vui lòng cho phép camera hoặc nhập mã thủ công.';
  if (name === 'NotFoundError') return 'Không tìm thấy camera trên thiết bị này.';
  if (name === 'NotReadableError') return 'Camera đang được ứng dụng khác sử dụng.';
  return 'Không thể khởi động camera. Bạn có thể nhập mã thủ công.';
};

const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
  title = 'Quét mã QR',
  description = 'Di chuyển camera đến mã QR để hệ thống nhận diện tự động.',
  manualPlaceholder = 'Nhập mã QR hoặc token...',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const handledRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [scanAttempt, setScanAttempt] = useState(0);

  const stopScanner = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    BrowserCodeReader.releaseAllStreams();
  };

  useEffect(() => {
    if (!isOpen) {
      stopScanner();
      setStarting(false);
      setCameraError(null);
      setManualValue('');
      handledRef.current = false;
      return;
    }

    let cancelled = false;
    const reader = new BrowserQRCodeReader(undefined, {
      delayBetweenScanAttempts: 350,
      delayBetweenScanSuccess: 500,
    });

    const startScanner = async () => {
      setStarting(true);
      setCameraError(null);
      handledRef.current = false;

      try {
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current || undefined, (result) => {
          if (!result || handledRef.current) return;
          handledRef.current = true;
          const text = result.getText().trim();
          stopScanner();
          if (text) onScan(text);
          onClose();
        });

        if (cancelled) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
      } catch (error) {
        if (!cancelled) setCameraError(getCameraErrorMessage(error));
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [isOpen, onClose, onScan, scanAttempt]);

  if (!isOpen) return null;

  const handleManualSubmit = () => {
    const value = manualValue.trim();
    if (!value) return;
    stopScanner();
    onScan(value);
    onClose();
  };

  const retryCamera = () => {
    stopScanner();
    setCameraError(null);
    setScanAttempt(prev => prev + 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white z-10 bg-black/20 hover:bg-black/40 p-1 rounded-full backdrop-blur-md"
        >
          <X size={24} />
        </button>

        <div className="relative h-80 bg-black flex flex-col items-center justify-center overflow-hidden">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
          <div className="absolute inset-0 bg-black/20" />

          <div className="relative z-10 w-48 h-48 border-2 border-accent rounded-lg flex items-center justify-center shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
            <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-accent -mt-1 -ml-1" />
            <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-accent -mt-1 -mr-1" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-accent -mb-1 -ml-1" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-accent -mb-1 -mr-1" />
            {!cameraError && <div className="w-full h-0.5 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-[scan_2s_ease-in-out_infinite]" />}
          </div>

          <div className="absolute bottom-8 z-10">
            {starting ? (
              <p className="text-white font-medium bg-black/50 px-3 py-1 rounded-full flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Đang mở camera...
              </p>
            ) : cameraError ? (
              <p className="text-red-100 font-medium bg-red-600/80 px-3 py-1 rounded-full text-xs max-w-[280px] text-center">
                {cameraError}
              </p>
            ) : (
              <p className="text-white font-medium bg-black/50 px-3 py-1 rounded-full">Đang quét mã QR...</p>
            )}
          </div>
        </div>

        <div className="p-6 bg-white">
          <h3 className="font-bold text-lg text-slate-800 mb-1">{title}</h3>
          <p className="text-slate-500 text-sm">{description}</p>

          <div className="mt-4 flex gap-2">
            <input
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleManualSubmit();
              }}
              placeholder={manualPlaceholder}
              className="min-w-0 flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              onClick={handleManualSubmit}
              disabled={!manualValue.trim()}
              className="px-3 bg-primary hover:bg-slate-800 py-3 rounded-lg text-sm font-bold text-white flex items-center justify-center disabled:opacity-50"
            >
              <Keyboard size={18} />
            </button>
          </div>

          <button
            onClick={retryCamera}
            className="mt-3 w-full bg-slate-100 hover:bg-slate-200 py-2.5 rounded-lg text-xs font-bold text-slate-700 flex items-center justify-center"
          >
            {cameraError ? <RefreshCw size={16} className="mr-2" /> : <Camera size={16} className="mr-2" />}
            {cameraError ? 'Thử lại camera' : 'Camera đang hoạt động'}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes scan {
          0% { transform: translateY(-90px); opacity: 0.5; }
          50% { opacity: 1; }
          100% { transform: translateY(90px); opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

export default ScannerModal;
