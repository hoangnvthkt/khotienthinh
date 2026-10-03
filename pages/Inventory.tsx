import React, { useRef, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Loader2, QrCode, Warehouse } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import ReceivePurchaseOrderModal from '../components/ReceivePurchaseOrderModal';
import TransactionDetailModal from '../components/TransactionDetailModal';
import ReceiveFulfillmentBatchModal from '../components/ReceiveFulfillmentBatchModal';
import { MaterialRequest, MaterialRequestFulfillmentBatch, PurchaseOrder, Transaction } from '../types';
import { useModuleData } from '../hooks/useModuleData';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { poService } from '../lib/projectService';
import { extractPoToken, PO_QR_PARAM } from '../lib/poQr';
import { extractPurchaseDeliveryToken, PURCHASE_DELIVERY_QR_PARAM } from '../lib/purchaseDeliveryQr';
import { extractFulfillmentBatchToken, FULFILLMENT_BATCH_QR_PARAM } from '../lib/fulfillmentBatchQr';
import { materialRequestFulfillmentService } from '../lib/materialRequestFulfillmentService';
import { purchasePackageService } from '../lib/purchasePackageService';
import { materialRequestService } from '../lib/materialRequestService';
import { secondaryBtn } from '../components/procurement/hub/hubUi';
import { WmsStockView } from '../components/wms/WmsStockView';

const ScannerModal = React.lazy(() => import('../components/ScannerModal'));

// Kho vật tư → Tồn kho (V1): số lấy thẳng từ sổ kho. Thêm / sửa / xóa vật tư chuyển về Danh mục vật tư (một cửa cấp mã).
// Giữ nguyên nhận hàng bằng QR vì mã QR in trên đơn mua / đợt giao / phiếu xuất nội bộ đều trỏ về /inventory.
const Inventory: React.FC = () => {
  const location = useLocation();
  const { requests, transactions, user, refreshWmsRecords } = useApp();
  useModuleData('wms');
  const toast = useToast();
  const [isScannerOpen, setScannerOpen] = useState(false);
  const [receivingPo, setReceivingPo] = useState<PurchaseOrder | null>(null);
  const [viewingPurchaseReceiptTx, setViewingPurchaseReceiptTx] = useState<Transaction | null>(null);
  const [receivingFulfillmentBatch, setReceivingFulfillmentBatch] = useState<MaterialRequestFulfillmentBatch | null>(null);
  const [receivingFulfillmentRequest, setReceivingFulfillmentRequest] = useState<MaterialRequest | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const lastLoadedQrTokenRef = useRef<string | null>(null);

  const loadDocumentFromQr = async (raw: string) => {
    const deliveryToken = extractPurchaseDeliveryToken(raw);
    const fulfillmentToken = extractFulfillmentBatchToken(raw);
    const poToken = extractPoToken(raw);
    if (!deliveryToken && !fulfillmentToken && !poToken) {
      toast.error('QR không hợp lệ', 'Mã QR không phải phiếu NCC hoặc phiếu xuất kho nội bộ hợp lệ.');
      return;
    }

    setLoadingQr(true);
    try {
      if (deliveryToken) {
        const lookup = await purchasePackageService.getDeliveryByQrToken(deliveryToken);
        if (!lookup) {
          toast.error('Không tìm thấy đợt giao', 'Mã QR không phải đợt giao NCC hợp lệ.');
          return;
        }
        if (user.assignedWarehouseId && lookup.purchaseOrder.targetWarehouseId && user.assignedWarehouseId !== lookup.purchaseOrder.targetWarehouseId) {
          toast.warning('Sai kho nhận', 'Tài khoản của bạn không được phân công kho nhận của đợt giao này.');
          return;
        }
        if (!lookup.deliveryBatch.wmsTransactionId) {
          toast.warning('Đợt giao chưa có WMS', 'Vui lòng kiểm tra lại đợt giao trong Cung ứng dự án.');
          return;
        }
        let transaction = transactions.find(item => item.id === lookup.deliveryBatch.wmsTransactionId) || null;
        if (!transaction) {
          transaction = await purchasePackageService.getWmsTransactionById(lookup.deliveryBatch.wmsTransactionId);
          if (!transaction) {
            toast.warning('Chưa tải phiếu WMS', 'Đợt giao tồn tại nhưng phiếu WMS chưa có trong dữ liệu hiện tại. Vui lòng tải lại dữ liệu WMS.');
            return;
          }
          await refreshWmsRecords({ transactionIds: [transaction.id] });
        }
        setViewingPurchaseReceiptTx(transaction);
        return;
      }

      if (fulfillmentToken) {
        const batch = await materialRequestFulfillmentService.getByQrToken(fulfillmentToken);
        if (!batch) {
          toast.error('Không tìm thấy phiếu xuất', 'Mã QR không phải phiếu xuất kho nội bộ hợp lệ.');
          return;
        }
        const request = requests.find(item => item.id === batch.materialRequestId)
          || await materialRequestService.getById(batch.materialRequestId);
        if (!request) {
          toast.error('Không tìm thấy đề xuất', 'Phiếu xuất tồn tại nhưng chưa tải được phiếu đề xuất liên quan.');
          return;
        }
        setReceivingFulfillmentRequest(request);
        setReceivingFulfillmentBatch(batch);
        return;
      }

      if (poToken) {
        const po = await poService.getByQrToken(poToken);
        if (!po) {
          toast.error('Không tìm thấy PO', 'Mã QR không phải phiếu nhập NCC hợp lệ.');
          return;
        }
        if (['cancelled', 'returned', 'closed', 'delivered'].includes(po.status)) {
          toast.warning('PO không còn chờ nhận', 'Không thể nhận thêm từ PO đã huỷ, hoàn hàng, đóng hoặc giao đủ.');
          return;
        }
        if (!['in_transit', 'partial'].includes(po.status)) {
          toast.warning('PO chưa ở trạng thái Đang giao', 'Vui lòng chuyển PO sang Đang giao để hệ thống tạo phiếu chờ Duyệt SL/CL trước khi quét QR.');
          return;
        }
        setReceivingPo(po);
      }
    } catch (err: any) {
      logApiError('inventory.loadDocumentQr', err);
      toast.error('Không thể tải phiếu QR', getApiErrorMessage(err, 'Không thể tải phiếu từ Supabase.'));
    } finally {
      setLoadingQr(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get(PURCHASE_DELIVERY_QR_PARAM) || params.get(FULFILLMENT_BATCH_QR_PARAM) || params.get(PO_QR_PARAM);
    const loadKey = `${token || ''}:${requests.length}`;
    if (!token || lastLoadedQrTokenRef.current === loadKey) return;
    lastLoadedQrTokenRef.current = loadKey;
    void loadDocumentFromQr(token);
  }, [location.search, requests]);

  return (
    <main className="min-h-screen space-y-4 bg-slate-50 px-3 py-4 text-foreground dark:bg-slate-950 sm:px-5 md:py-5">
      {isScannerOpen && (
        <React.Suspense fallback={null}>
          <ScannerModal
            isOpen={isScannerOpen}
            onClose={() => setScannerOpen(false)}
            onScan={loadDocumentFromQr}
            title="Quét QR phiếu nhập kho"
            description="Quét mã QR trên phiếu NCC hoặc phiếu xuất kho nội bộ để xác nhận thực nhận."
            manualPlaceholder="Nhập token PO hoặc phiếu xuất..."
          />
        </React.Suspense>
      )}
      <ReceivePurchaseOrderModal
        isOpen={!!receivingPo}
        po={receivingPo}
        onClose={() => setReceivingPo(null)}
        onReceived={setReceivingPo}
      />
      <TransactionDetailModal
        isOpen={!!viewingPurchaseReceiptTx}
        transaction={viewingPurchaseReceiptTx}
        onClose={() => setViewingPurchaseReceiptTx(null)}
        onUpdated={setViewingPurchaseReceiptTx}
      />
      <ReceiveFulfillmentBatchModal
        isOpen={!!receivingFulfillmentBatch}
        request={receivingFulfillmentRequest}
        batch={receivingFulfillmentBatch}
        onClose={() => {
          setReceivingFulfillmentBatch(null);
          setReceivingFulfillmentRequest(null);
        }}
        onReceived={() => {
          setReceivingFulfillmentBatch(null);
          setReceivingFulfillmentRequest(null);
        }}
      />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-700 to-mint-500 text-white shadow-sm"><Warehouse size={22} /></span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight md:text-2xl">Tồn kho</h1>
            <p className="text-sm text-muted-foreground">Tồn kho toàn công ty lấy thẳng từ sổ kho. Bấm một vật tư để xem thẻ kho.</p>
          </div>
        </div>
        <button type="button" onClick={() => setScannerOpen(true)} disabled={loadingQr} className={`${secondaryBtn} bg-card`}>
          {loadingQr ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />}Quét QR phiếu</button>
      </header>
      <WmsStockView />
    </main>
  );
};

export default Inventory;
