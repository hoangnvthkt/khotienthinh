import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveNotificationPath } from '../notificationRoutes';

const projectServiceSource = readFileSync(
  new URL('../projectService.ts', import.meta.url),
  'utf8',
);

describe('purchase order approval notifications', () => {
  it('hydrates delivery approval state from the canonical Cloud projection', () => {
    expect(projectServiceSource).toContain(
      "const PO_DELIVERY_BATCH_SELECT = getSupabaseProjection('purchase_order_delivery_batches');",
    );
  });

  it('opens a delivery batch approval notification on the exact purchase order', () => {
    expect(resolveNotificationPath({
      sourceType: 'purchase_order_delivery_batch',
      sourceId: 'batch-1',
      link: '/da',
      constructionSiteId: 'site-1',
      metadata: {
        projectId: 'project-1',
        purchaseOrderId: 'po-1',
        deliveryBatchId: 'batch-1',
      },
    } as any)).toBe(
      '/procurement/project-po?projectId=project-1&siteId=site-1&poId=po-1',
    );
  });

  it('opens a purchase order notification on the project PO screen in Mua hàng', () => {
    expect(resolveNotificationPath({
      sourceType: 'purchase_order',
      sourceId: 'po-1',
      metadata: { projectId: 'project-1' },
    } as any)).toBe(
      '/procurement/project-po?projectId=project-1&poId=po-1',
    );
  });

  it('falls back to the Mua hàng drawer when the notification has no project', () => {
    expect(resolveNotificationPath({
      sourceType: 'purchase_order',
      sourceId: 'po-9',
      metadata: {},
    } as any)).toBe('/procurement?po=po-9');
  });
});
