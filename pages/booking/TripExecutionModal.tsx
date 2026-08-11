import React, { useEffect, useState } from 'react';
import { Camera, MapPin, Play, CheckSquare, Loader2 } from 'lucide-react';
import {
  fetchFleetSystemSettings,
  startVehicleTrip,
  finishVehicleTrip,
  getTripEvidenceValidationError,
  recordVehicleTripCheckpoint,
  uploadEvidenceImage
} from '../../lib/vehicleBookingService';
import { useToast } from '../../context/ToastContext';

interface TripExecutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookingId: string;
  bookingCode: string;
  mode: 'START' | 'CHECKPOINT' | 'FINISH';
  onSuccess: () => void;
}

const TripExecutionModal: React.FC<TripExecutionModalProps> = ({
  isOpen,
  onClose,
  bookingId,
  bookingCode,
  mode,
  onSuccess,
}) => {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [maxEvidenceImageMb, setMaxEvidenceImageMb] = useState(5);

  // Form Fields
  const [odometer, setOdometer] = useState<number | ''>('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Geolocation & Fallback
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [locationFailed, setLocationFailed] = useState(false);
  const [failureReason, setFailureReason] = useState('');

  // Finish trip fields
  const [condition, setCondition] = useState<'NORMAL' | 'ISSUE'>('NORMAL');
  const [issueNote, setIssueNote] = useState('');

  // Checkpoint Selection
  const [checkpointName, setCheckpointName] = useState<'DEPARTED_HOME_BASE' | 'PICKED_UP_PASSENGER'>('DEPARTED_HOME_BASE');

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void fetchFleetSystemSettings()
      .then(settings => {
        if (active) setMaxEvidenceImageMb(settings.max_evidence_image_mb);
      })
      .catch(() => {
        if (active) toast.error('Không tải được giới hạn ảnh; đang dùng mức mặc định 5 MB.');
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  if (!isOpen) return null;

  // HTML5 Geolocation Trigger
  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setLocationFailed(true);
      setFailureReason('Trình duyệt không hỗ trợ Geolocation HTML5');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setAcc(pos.coords.accuracy);
        setLocationFailed(false);
        setFailureReason('');
        toast.success('Đã lấy vị trí GPS thành công!');
      },
      (err) => {
        setLocationFailed(true);
        setFailureReason(err.message || 'Người dùng từ chối cấp vị trí GPS');
        toast.error('Không thể lấy vị trí GPS!');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (mode !== 'CHECKPOINT') {
        if (typeof odometer !== 'number' || odometer < 0) {
          toast.error(`Vui lòng nhập số kilomet ${mode === 'START' ? 'bắt đầu' : 'kết thúc'} hợp lệ!`);
          return;
        }
        const evidenceError = getTripEvidenceValidationError({
          mode,
          hasImage: Boolean(imageFile),
          latitude: lat,
          longitude: lng,
          locationCaptureFailed: locationFailed,
          locationFailureReason: failureReason,
        });
        const messages: Record<string, string> = {
          PHOTO_REQUIRED: 'Ảnh đồng hồ kilomet là bằng chứng bắt buộc.',
          LOCATION_REQUIRED: 'Vui lòng lấy vị trí GPS hoặc xác nhận thiết bị không lấy được vị trí.',
          LOCATION_FAILURE_REASON_REQUIRED: 'Vui lòng ghi rõ lý do không lấy được GPS.',
        };
        if (evidenceError) {
          toast.error(messages[evidenceError] || evidenceError);
          return;
        }
      }

      setLoading(true);

      if (mode === 'START') {
        const photoPath = await uploadEvidenceImage(imageFile!, `${bookingId}/trips`, maxEvidenceImageMb);

        await startVehicleTrip({
          booking_id: bookingId,
          start_odometer: Number(odometer),
          start_photo_path: photoPath,
          latitude: lat ?? undefined,
          longitude: lng ?? undefined,
          accuracy_m: acc ?? undefined,
          location_capture_failed: locationFailed,
          location_failure_reason: locationFailed ? failureReason : undefined,
        });

        toast.success('Đã bắt đầu chuyến xe thành công!');
      } else if (mode === 'CHECKPOINT') {
        await recordVehicleTripCheckpoint(bookingId, checkpointName);
        toast.success(`Đã ghi nhận mốc checkpoint: ${checkpointName}`);
      } else if (mode === 'FINISH') {
        const photoPath = await uploadEvidenceImage(imageFile!, `${bookingId}/trips`, maxEvidenceImageMb);

        await finishVehicleTrip({
          booking_id: bookingId,
          end_odometer: Number(odometer),
          end_photo_path: photoPath,
          latitude: lat ?? undefined,
          longitude: lng ?? undefined,
          accuracy_m: acc ?? undefined,
          location_capture_failed: locationFailed,
          location_failure_reason: locationFailed ? failureReason : undefined,
          vehicle_condition_end: condition,
          issue_note: condition === 'ISSUE' ? issueNote : undefined,
        });

        toast.success('Đã kết thúc chuyến xe thành công!');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Thao tác thất bại!');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              {mode === 'START' && <Play className="w-5 h-5 text-emerald-500" />}
              {mode === 'CHECKPOINT' && <MapPin className="w-5 h-5 text-amber-500" />}
              {mode === 'FINISH' && <CheckSquare className="w-5 h-5 text-indigo-500" />}
              <span>
                {mode === 'START' ? 'Bắt Đầu Chuyến Đi' : mode === 'CHECKPOINT' ? 'Ghi Checkpoint Chuyến' : 'Kết Thúc Chuyến Đi'}
              </span>
            </h3>
            <p className="text-xs text-slate-500">Mã đơn: {bookingCode}</p>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {mode === 'CHECKPOINT' ? (
            <div>
              <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">Chọn mốc Checkpoint:</label>
              <select
                value={checkpointName}
                onChange={(e) => setCheckpointName(e.target.value as 'DEPARTED_HOME_BASE' | 'PICKED_UP_PASSENGER')}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-xs"
              >
                <option value="DEPARTED_HOME_BASE">Đã xuất phát khỏi bãi xe (DEPARTED_HOME_BASE)</option>
                <option value="PICKED_UP_PASSENGER">Đã đón khách công tác (PICKED_UP_PASSENGER)</option>
              </select>
            </div>
          ) : (
            <>
              {/* ODOMETER INPUT */}
              <div>
                <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
                  {mode === 'START' ? 'Số Kilomet Đồng Hồ Đầu Chuyến (km) *' : 'Số Kilomet Đồng Hồ Cuối Chuyến (km) *'}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={odometer}
                  onChange={(e) => setOdometer(parseFloat(e.target.value) || '')}
                  placeholder="VD: 15450.5"
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3.5 text-sm font-bold text-slate-900 dark:text-white"
                  required
                />
              </div>

              {/* CAMERA PHOTO UPLOAD */}
              <div>
                <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
                  Chụp ảnh mặt đồng hồ kilomet * (tối đa {maxEvidenceImageMb} MB sau nén)
                </label>
                <div className="flex items-center space-x-3">
                  <label className="flex-1 cursor-pointer bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 rounded-xl p-3 flex items-center justify-center space-x-2 font-semibold">
                    <Camera className="w-5 h-5" />
                    <span>{imageFile ? 'Đã chọn ảnh' : 'Chụp / Chọn Ảnh Đồng Hồ'}</span>
                    <input type="file" accept="image/*" capture="environment" onChange={handleImageChange} className="hidden" />
                  </label>
                </div>
                {imagePreview && (
                  <div className="mt-2 relative w-32 h-32 rounded-xl overflow-hidden border">
                    <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>

              {/* GPS GEOLOCATION & FALLBACK */}
              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Vị trí GPS Check-in:</span>
                  <button
                    type="button"
                    onClick={handleGetLocation}
                    className="px-3 py-1 bg-amber-500 text-white rounded-lg font-semibold hover:bg-amber-600"
                  >
                    Lấy Vị Trí GPS
                  </button>
                </div>

                {lat !== null && lng !== null ? (
                  <p className="text-emerald-600 dark:text-emerald-400 font-mono">
                    ✓ GPS: {lat.toFixed(5)}, {lng.toFixed(5)} (Sai số ±{acc ? Math.round(acc) : 0}m)
                  </p>
                ) : locationFailed ? (
                  <div className="space-y-2 text-rose-500">
                    <p className="font-semibold">⚠️ Không lấy được GPS</p>
                    <label className="flex items-center space-x-2 text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={locationFailed}
                        onChange={(e) => setLocationFailed(e.target.checked)}
                        className="rounded text-amber-500"
                      />
                      <span>Xác nhận không lấy được GPS và tiếp tục chuyến</span>
                    </label>
                    <textarea
                      rows={2}
                      value={failureReason}
                      onChange={(event) => setFailureReason(event.target.value)}
                      placeholder="Ghi rõ lý do không lấy được vị trí GPS..."
                      className="w-full rounded-lg border border-rose-200 bg-white p-2 text-slate-700 dark:border-rose-900 dark:bg-slate-800 dark:text-slate-200"
                    />
                  </div>
                ) : (
                  <p className="text-slate-400 italic">Chưa lấy vị trí GPS</p>
                )}
              </div>

              {/* FINISH VEHICLE CONDITION */}
              {mode === 'FINISH' && (
                <div className="space-y-3">
                  <div>
                    <label className="block font-medium mb-1">Tình trạng xe sau chuyến:</label>
                    <div className="flex items-center space-x-4">
                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="condition"
                          value="NORMAL"
                          checked={condition === 'NORMAL'}
                          onChange={() => setCondition('NORMAL')}
                        />
                        <span>Bình thường</span>
                      </label>
                      <label className="flex items-center space-x-1.5 cursor-pointer text-rose-500">
                        <input
                          type="radio"
                          name="condition"
                          value="ISSUE"
                          checked={condition === 'ISSUE'}
                          onChange={() => setCondition('ISSUE')}
                        />
                        <span>Có sự cố / Xước xát / Hỏng hóc</span>
                      </label>
                    </div>
                  </div>

                  {condition === 'ISSUE' && (
                    <div>
                      <label className="block font-medium mb-1">Mô tả sự cố:</label>
                      <textarea
                        rows={2}
                        value={issueNote}
                        onChange={(e) => setIssueNote(e.target.value)}
                        placeholder="Mô tả xước xát, lốp non, hỏng thiết bị..."
                        className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
                        required
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* SUBMIT BUTTON (MIN 48PX HIGH FOR MOBILE ACCESSIBILITY) */}
          <div className="pt-3">
            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center space-x-2 disabled:opacity-50 transition"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <span>Xác Nhận Thao Tác Chuyến</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TripExecutionModal;
