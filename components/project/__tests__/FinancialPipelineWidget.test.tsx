import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const reactState = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useEffect: vi.fn(),
    useState: vi.fn((initial: unknown) => {
      const configured = reactState.values[reactState.index++];
      const value = configured === undefined
        ? (typeof initial === 'function' ? (initial as () => unknown)() : initial)
        : configured;
      return [value, vi.fn()];
    }),
  };
});

vi.mock('../../../lib/paymentCertificateService', () => ({ paymentCertificateService: {} }));
vi.mock('../../../lib/advancePaymentService', () => ({ advancePaymentService: {} }));
vi.mock('../../../lib/quantityAcceptanceService', () => ({ quantityAcceptanceService: {} }));
vi.mock('../../../lib/contractItemService', () => ({ contractItemService: {} }));
vi.mock('../../../lib/projectFinancialService', () => ({ projectFinancialService: {} }));

import FinancialPipelineWidget from '../FinancialPipelineWidget';

const pipelineData = {
  contractValue: 1_000,
  revisedContractValue: 1_000,
  totalAccepted: 500,
  totalCertified: 400,
  totalPaid: 300,
  totalRetention: 20,
  advanceTotalAmount: 100,
  advanceTotalRecovered: 50,
  advanceTotalRemaining: 50,
  certCount: 1,
  paidCertCount: 0,
};

const siteKpis = {
  originalContractValue: 1_000,
  approvedVariationsValue: 0,
  revisedContractValue: 1_000,
  subcontractValue: 100,
  budgetTotal: 800,
  actualCost: 200,
  budgetVariance: 600,
  budgetVariancePercent: 75,
  committedCost: 300,
  forecastFinalCost: 500,
  contractMargin: 500,
  contractMarginPercent: 50,
  totalCertifiedRevenue: 400,
  totalPaidRevenue: 300,
  totalRetentionHeld: 20,
  totalAdvanceOutstanding: 50,
  certificationPercent: 40,
  cashIn: 300,
  cashOut: 100,
  cashPosition: 200,
  cashPositionPercent: 20,
  constructionSiteId: 'site-a',
  calculatedAt: '2026-09-19T00:00:00.000Z',
};

describe('FinancialPipelineWidget', () => {
  beforeEach(() => {
    reactState.values = [];
    reactState.index = 0;
  });

  it('shows that the current forecast has not excluded recognized cost', () => {
    reactState.values = [pipelineData, siteKpis, false, null, 'kpi', 0];

    const html = renderToStaticMarkup(
      <FinancialPipelineWidget contractId="contract-a" contractType="customer" constructionSiteId="site-a" />,
    );

    expect(html).toContain('Chưa loại trừ phần đã ghi nhận');
  });

  it('offers a retry action when a mandatory financial read fails', () => {
    reactState.values = [null, null, false, 'Mất kết nối', 'pipeline', 0];

    const html = renderToStaticMarkup(
      <FinancialPipelineWidget contractId="contract-a" contractType="customer" constructionSiteId="site-a" />,
    );

    expect(html).toContain('Lỗi tải dữ liệu: Mất kết nối');
    expect(html).toContain('Thử lại');
  });
});
