import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../pages/wf/WorkflowTemplates.tsx', import.meta.url), 'utf8');

describe('workflow template deletion feedback contract', () => {
  it('reports successful and failed deletions through the shared toast UI', () => {
    expect(source).toMatch(/import \{ useToast \} from ['"]\.\.\/\.\.\/context\/ToastContext['"]/);
    expect(source).toMatch(/const toast = useToast\(\)/);
    expect(source).toMatch(/toast\.success\(['"]Đã xóa mẫu quy trình['"]/);
    expect(source).toMatch(/toast\.error\(\s*['"]Không thể xóa mẫu quy trình['"]/);
    expect(source).toMatch(/getApiErrorMessage\(error/);
  });

  it('prevents duplicate delete submissions while the request is running', () => {
    expect(source).toMatch(/const \[isDeleting, setIsDeleting\] = useState\(false\)/);
    expect(source).toMatch(/disabled=\{isDeleting\}/);
  });

  it('explains that only unused templates can be deleted', () => {
    expect(source).toContain('Chỉ xóa được mẫu chưa có phiếu, phiên bản hoặc liên kết sử dụng.');
  });
});
