import React, { useState, useRef, useEffect } from 'react';
import { Camera, Monitor, Crop, Paintbrush, RotateCcw, X, Check, Trash2, Video, AlertCircle } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (file: File) => void;
  label: string;
}

type Step = 'select_source' | 'camera_active' | 'editing';
type Tool = 'crop' | 'brush';
type BrushColor = '#000000' | '#ef4444' | '#eab308'; // Black, Red, Yellow Highlighter

export const ImageCaptureEditorModal: React.FC<Props> = ({ isOpen, onClose, onConfirm, label }) => {
  const [step, setStep] = useState<Step>('select_source');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [tool, setTool] = useState<Tool>('crop');
  const [brushColor, setBrushColor] = useState<BrushColor>('#ef4444');
  const [brushSize, setBrushSize] = useState<number>(8);
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);

  // Canvas details
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imgDimensions, setImgDimensions] = useState({ width: 0, height: 0 });

  // Crop box dimensions (relative to canvas internal pixels)
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [dragMode, setDragMode] = useState<'move' | 'nw' | 'ne' | 'sw' | 'se' | null>(null);
  const [dragStart, setDragStart] = useState({ mouseX: 0, mouseY: 0, cropX: 0, cropY: 0, cropW: 0, cropH: 0 });

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);

  // Stop camera stream when unmounting or changing step
  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [cameraStream]);

  // If modal is closed, reset state
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setStep('select_source');
      setImageSrc(null);
      setUndoStack([]);
    }
  }, [isOpen]);

  // Initialize Canvas when imageSrc changes
  useEffect(() => {
    if (step === 'editing' && imageSrc && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        setImgDimensions({ width: img.width, height: img.height });

        // Set default crop: 10% margin all around
        const marginX = Math.round(img.width * 0.1);
        const marginY = Math.round(img.height * 0.1);
        setCrop({
          x: marginX,
          y: marginY,
          w: img.width - marginX * 2,
          h: img.height - marginY * 2,
        });

        // Initialize undo stack
        const initialData = ctx.getImageData(0, 0, img.width, img.height);
        setUndoStack([initialData]);
      };
      img.src = imageSrc;
    }
  }, [step, imageSrc]);

  // Screen Capture handler
  const handleScreenCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: false,
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;

      video.onloadedmetadata = () => {
        setTimeout(() => {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            setImageSrc(canvas.toDataURL('image/jpeg', 0.95));
            setStep('editing');
          }
          stream.getTracks().forEach(track => track.stop());
        }, 500);
      };
    } catch (err) {
      console.warn('Screen capture failed or cancelled:', err);
    }
  };

  // Webcam Capture handler
  const handleCameraInit = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      setCameraStream(stream);
      setStep('camera_active');
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (err) {
      alert('Không thể mở camera. Vui lòng cấp quyền truy cập camera cho trình duyệt.');
      console.error('Webcam access error:', err);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setImageSrc(canvas.toDataURL('image/jpeg', 0.95));
      setStep('editing');
    }
    stopCamera();
  };

  // Canvas interaction (Drawing)
  const saveState = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const state = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setUndoStack(prev => [...prev, state]);
    }
  };

  const handleUndo = () => {
    if (undoStack.length <= 1) return;
    const newStack = [...undoStack];
    newStack.pop(); // Remove current state
    const prevState = newStack[newStack.length - 1];
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx && prevState) {
      ctx.putImageData(prevState, 0, 0);
      setUndoStack(newStack);
    }
  };

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'brush') return;
    const coords = getCanvasCoords(e);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Yellow is highlighter
      if (brushColor === '#eab308') {
        ctx.globalAlpha = 0.4;
      } else {
        ctx.globalAlpha = 1.0;
      }

      ctx.beginPath();
      ctx.moveTo(coords.x, coords.y);
      setIsDrawing(true);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || tool !== 'brush') return;
    const coords = getCanvasCoords(e);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx) {
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
    }
  };

  const handleCanvasMouseUp = () => {
    if (isDrawing) {
      setIsDrawing(false);
      saveState();
    }
  };

  // Crop Box Drag & Resize handlers
  const handleCropMouseDown = (e: React.MouseEvent, mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => {
    e.stopPropagation();
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    setDragMode(mode);
    setDragStart({
      mouseX: e.clientX,
      mouseY: e.clientY,
      cropX: crop.x,
      cropY: crop.y,
      cropW: crop.w,
      cropH: crop.h,
    });
  };

  useEffect(() => {
    if (!dragMode || !canvasRef.current) return;
    const canvas = canvasRef.current;

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const dx = ((e.clientX - dragStart.mouseX) / rect.width) * imgDimensions.width;
      const dy = ((e.clientY - dragStart.mouseY) / rect.height) * imgDimensions.height;

      let x = dragStart.cropX;
      let y = dragStart.cropY;
      let w = dragStart.cropW;
      let h = dragStart.cropH;

      if (dragMode === 'move') {
        x = Math.max(0, Math.min(imgDimensions.width - w, dragStart.cropX + dx));
        y = Math.max(0, Math.min(imgDimensions.height - h, dragStart.cropY + dy));
      } else {
        if (dragMode.includes('n')) {
          const newY = dragStart.cropY + dy;
          const newH = dragStart.cropH - dy;
          if (newY >= 0 && newH >= 50) {
            y = newY;
            h = newH;
          }
        }
        if (dragMode.includes('s')) {
          const newH = dragStart.cropH + dy;
          if (y + newH <= imgDimensions.height && newH >= 50) {
            h = newH;
          }
        }
        if (dragMode.includes('w')) {
          const newX = dragStart.cropX + dx;
          const newW = dragStart.cropW - dx;
          if (newX >= 0 && newW >= 50) {
            x = newX;
            w = newW;
          }
        }
        if (dragMode.includes('e')) {
          const newW = dragStart.cropW + dx;
          if (x + newW <= imgDimensions.width && newW >= 50) {
            w = newW;
          }
        }
      }

      setCrop({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    };

    const onMouseUp = () => {
      setDragMode(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragMode, dragStart, imgDimensions]);

  // Export cropped and edited file
  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create a new canvas with crop dimensions
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = crop.w;
    finalCanvas.height = crop.h;
    const finalCtx = finalCanvas.getContext('2d');

    if (finalCtx) {
      // Draw cropped area from original canvas
      finalCtx.drawImage(
        canvas,
        crop.x,
        crop.y,
        crop.w,
        crop.h,
        0,
        0,
        crop.w,
        crop.h
      );

      finalCanvas.toBlob(blob => {
        if (blob) {
          const file = new File([blob], `cccd_${Date.now()}.jpg`, { type: 'image/jpeg' });
          onConfirm(file);
          onClose();
        }
      }, 'image/jpeg', 0.9);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
      <div className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4">
          <div>
            <h3 className="text-sm font-black text-slate-800 dark:text-white">Chụp &amp; Chỉnh sửa ảnh {label}</h3>
            <p className="text-[11px] font-bold text-slate-400 mt-0.5">Hỗ trợ chụp màn hình hoặc camera, cắt ảnh và che thông tin nhạy cảm.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 hover:text-slate-600 dark:hover:text-slate-200">
            <X size={18} />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-900 p-5 flex flex-col items-center justify-center relative min-h-[300px]">
          {step === 'select_source' && (
            <div className="max-w-md w-full text-center space-y-6">
              <div className="flex justify-center">
                <div className="w-14 h-14 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-500 rounded-2xl flex items-center justify-center border border-indigo-100 dark:border-indigo-900/30">
                  <Camera size={26} />
                </div>
              </div>
              <div>
                <h4 className="text-sm font-black text-slate-700 dark:text-slate-200">Chọn nguồn thu hình</h4>
                <p className="text-xs font-bold text-slate-400 mt-1">Vui lòng chọn cách lấy hình ảnh của thẻ CCCD dưới đây.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={handleScreenCapture}
                  className="flex flex-col items-center gap-3 p-5 rounded-2xl border border-slate-200 bg-white hover:border-indigo-400 hover:bg-indigo-50/20 transition-all text-slate-700 hover:text-indigo-600 dark:border-slate-800 dark:bg-slate-950 group"
                >
                  <Monitor size={24} className="text-slate-400 group-hover:text-indigo-500 transition-colors" />
                  <div className="text-left text-center">
                    <span className="block text-xs font-black">Chụp màn hình</span>
                    <span className="block text-[9px] font-bold text-slate-400 mt-0.5">Chụp cửa sổ khác</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleCameraInit}
                  className="flex flex-col items-center gap-3 p-5 rounded-2xl border border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/20 transition-all text-slate-700 hover:text-emerald-600 dark:border-slate-800 dark:bg-slate-950 group"
                >
                  <Video size={24} className="text-slate-400 group-hover:text-emerald-500 transition-colors" />
                  <div className="text-left text-center">
                    <span className="block text-xs font-black">Chụp từ Camera</span>
                    <span className="block text-[9px] font-bold text-slate-400 mt-0.5">Sử dụng webcam thiết bị</span>
                  </div>
                </button>
              </div>

              <div className="flex gap-2 p-3 bg-blue-50/50 dark:bg-blue-950/10 rounded-xl border border-blue-100/50 dark:border-blue-900/30 text-[10px] font-bold text-blue-500 text-left">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>Mẹo: Nếu hình ảnh CCCD đang mở trên máy tính, bạn hãy chọn "Chụp màn hình" và chọn tab/cửa sổ chứa hình ảnh đó để chụp cực kỳ sắc nét.</span>
              </div>
            </div>
          )}

          {step === 'camera_active' && (
            <div className="w-full max-w-lg flex flex-col gap-4 items-center">
              <div className="w-full aspect-[4/3] rounded-2xl overflow-hidden border-2 border-slate-200 dark:border-slate-800 bg-black relative flex items-center justify-center">
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                {/* Visual guidelines overlay */}
                <div className="absolute inset-8 border border-white/40 rounded-lg pointer-events-none flex items-center justify-center">
                  <div className="w-3/4 aspect-[85/54] border-2 border-dashed border-white/60 rounded-md flex items-center justify-center">
                    <span className="text-[10px] text-white/60 bg-black/40 px-2 py-0.5 rounded font-bold">Đặt CCCD vào khung này</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => { stopCamera(); setStep('select_source'); }}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-50 transition-colors dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                >
                  Quay lại
                </button>
                <button
                  type="button"
                  onClick={capturePhoto}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 active:scale-95"
                >
                  <Camera size={14} /> Chụp ảnh
                </button>
              </div>
            </div>
          )}

          {step === 'editing' && imageSrc && (
            <div className="relative w-full h-full flex items-center justify-center">
              <div className="relative border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-950/5 select-none" style={{ maxHeight: '60vh' }}>
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  className={`max-w-full block object-contain ${tool === 'brush' ? 'cursor-crosshair' : ''}`}
                  style={{ maxHeight: '60vh' }}
                />

                {/* Crop Box Overlay */}
                {tool === 'crop' && imgDimensions.width > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${(crop.x / imgDimensions.width) * 100}%`,
                      top: `${(crop.y / imgDimensions.height) * 100}%`,
                      width: `${(crop.w / imgDimensions.width) * 100}%`,
                      height: `${(crop.h / imgDimensions.height) * 100}%`,
                      border: '2px dashed #f97316',
                      boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.65)',
                    }}
                    className="absolute"
                    onMouseDown={(e) => handleCropMouseDown(e, 'move')}
                  >
                    {/* Resizing Handles */}
                    <div className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-orange-500 border border-white rounded-full cursor-nwse-resize" onMouseDown={(e) => handleCropMouseDown(e, 'nw')} />
                    <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-orange-500 border border-white rounded-full cursor-nesw-resize" onMouseDown={(e) => handleCropMouseDown(e, 'ne')} />
                    <div className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-orange-500 border border-white rounded-full cursor-nesw-resize" onMouseDown={(e) => handleCropMouseDown(e, 'sw')} />
                    <div className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-orange-500 border border-white rounded-full cursor-nwse-resize" onMouseDown={(e) => handleCropMouseDown(e, 'se')} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Toolbar & Footer for editing mode */}
        {step === 'editing' && (
          <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-5 py-3.5 flex flex-col sm:flex-row gap-3 items-center justify-between">
            {/* Toolbar controls */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
                <button
                  type="button"
                  onClick={() => setTool('crop')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-black transition-colors ${
                    tool === 'crop'
                      ? 'bg-orange-50 text-orange-600 dark:bg-orange-950/20'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                  }`}
                >
                  <Crop size={14} /> Cắt ảnh
                </button>
                <button
                  type="button"
                  onClick={() => setTool('brush')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-black transition-colors ${
                    tool === 'brush'
                      ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/20'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                  }`}
                >
                  <Paintbrush size={14} /> Vẽ / Che tin
                </button>
              </div>

              {tool === 'brush' && (
                <div className="flex items-center gap-2 px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <span className="text-[10px] font-black text-slate-400 uppercase mr-1">Màu:</span>
                  <button
                    type="button"
                    onClick={() => setBrushColor('#ef4444')}
                    className={`w-4 h-4 rounded-full bg-red-500 border transition-transform ${brushColor === '#ef4444' ? 'scale-125 ring-2 ring-red-500/20' : 'border-transparent'}`}
                  />
                  <button
                    type="button"
                    onClick={() => setBrushColor('#000000')}
                    className={`w-4 h-4 rounded-full bg-black border transition-transform ${brushColor === '#000000' ? 'scale-125 ring-2 ring-black/20' : 'border-transparent'}`}
                  />
                  <button
                    type="button"
                    onClick={() => setBrushColor('#eab308')}
                    className={`w-4 h-4 rounded-full bg-yellow-500 border transition-transform ${brushColor === '#eab308' ? 'scale-125 ring-2 ring-yellow-500/20' : 'border-transparent'}`}
                    title="Bút dạ quang (Highlighter)"
                  />
                  <div className="w-px h-3 bg-slate-200 mx-1" />
                  <span className="text-[10px] font-black text-slate-400 uppercase">Cỡ:</span>
                  <input
                    type="range"
                    min="3"
                    max="20"
                    value={brushSize}
                    onChange={e => setBrushSize(Number(e.target.value))}
                    className="w-14 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              )}

              {undoStack.length > 1 && (
                <button
                  type="button"
                  onClick={handleUndo}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-black text-slate-600 hover:text-slate-900 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-450 dark:hover:text-slate-200 rounded-lg transition-colors"
                >
                  <RotateCcw size={12} /> Hoàn tác
                </button>
              )}
            </div>

            {/* Save / Cancel */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep('select_source')}
                className="px-4 py-2 text-xs font-black text-slate-600 hover:text-slate-900 transition-colors"
              >
                Chụp lại
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-black transition-all flex items-center gap-1.5 shadow-lg shadow-orange-500/25 active:scale-95"
              >
                <Check size={14} /> Xác nhận
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
