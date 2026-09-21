import { describe, expect, it } from 'vitest';
import { parseProcurementQuery, serializeProcurementQuery } from '../procurement/queryState';

describe('procurement query state', () => {
  it('keeps supported filters and Vietnamese search text across navigation', () => {
    const parsed = parseProcurementQuery(new URLSearchParams(
      'view=demand&stage=receiving&projectId=p-1&siteId=s-1&assigneeId=u-1&search=Th%C3%A9p&neededFrom=2026-09-01&neededTo=2026-09-30&demandId=d-1',
    ));
    expect(parsed).toEqual({
      view: 'demand', stage: 'receiving', projectId: 'p-1', constructionSiteId: 's-1',
      assigneeId: 'u-1', search: 'Thép', neededFrom: '2026-09-01', neededTo: '2026-09-30', demandId: 'd-1',
    });
    expect(serializeProcurementQuery(parsed).toString()).toContain('search=Th%C3%A9p');
  });

  it('drops unsupported views, malformed dates and whitespace-only filters', () => {
    expect(parseProcurementQuery(new URLSearchParams(
      'view=admin&stage=hack&projectId=%20&neededFrom=21-09-2026&neededTo=2026-02-31&search=%20%20',
    ))).toEqual({ view: 'work' });
  });

  it('uses a canonical parameter order and omits the default view', () => {
    const params = serializeProcurementQuery({ view: 'work', search: 'xi măng', projectId: 'p-1' });
    expect(params.toString()).toBe('projectId=p-1&search=xi+m%C4%83ng');
  });
});
