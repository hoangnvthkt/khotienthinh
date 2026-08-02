import { describe, expect, it } from 'vitest';
import {
  isMaterialRequestWorkflowTemplate,
  isRequestModuleWorkflowTemplate,
} from '../workflowVisibility';

describe('workflow visibility', () => {
  it('recognizes Request-owned workflow templates from their marker', () => {
    expect(isRequestModuleWorkflowTemplate({
      customFields: [{ _requestTemplateId: 'template-1' }],
    } as never)).toBe(true);
  });

  it('does not classify ordinary workflow templates as Request-owned', () => {
    expect(isRequestModuleWorkflowTemplate({ customFields: [] } as never)).toBe(false);
    expect(isRequestModuleWorkflowTemplate({
      customFields: [{ id: 'field-1', name: 'note', type: 'text' }],
    } as never)).toBe(false);
    expect(isRequestModuleWorkflowTemplate(null)).toBe(false);
  });

  it('keeps the material-request classifier independent', () => {
    expect(isMaterialRequestWorkflowTemplate({
      name: 'Quy trình cấp vật tư công trường',
    })).toBe(true);
    expect(isRequestModuleWorkflowTemplate({
      customFields: [{ _requestTemplateId: 'template-1' }],
    } as never)).toBe(true);
  });
});
