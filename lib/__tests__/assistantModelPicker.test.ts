import { describe, expect, it } from 'vitest';
import { modelForTurn } from '../../components/center/AssistantModelPicker';
import type { MyAiModel } from '../aiGateway';

const M = (id: string, vision: boolean, isDefault = false): MyAiModel => ({ id, name: id, model: id, blurb: '', icon: '', vision, isDefault });
const models = [M('claude', true, true), M('deepseek', false)];

describe('Chọn model ở ô hỏi', () => {
  it('dùng model đang chọn; chưa chọn / chọn model không còn được cấp → mặc định', () => {
    expect(modelForTurn(models, 'deepseek', false)).toEqual({ model: models[1], switched: false });
    expect(modelForTurn(models, null, false).model?.id).toBe('claude');
    expect(modelForTurn(models, 'cu-da-thu-hoi', false).model?.id).toBe('claude');
    expect(modelForTurn([], 'x', false)).toEqual({ model: null, switched: false });
  });
  it('câu có ảnh mà model không đọc ảnh → tự dùng model đọc ảnh được cấp; không có model nào đọc ảnh thì giữ nguyên', () => {
    expect(modelForTurn(models, 'deepseek', true)).toEqual({ model: models[0], switched: true });
    expect(modelForTurn(models, 'claude', true)).toEqual({ model: models[0], switched: false });
    expect(modelForTurn([M('deepseek', false, true)], 'deepseek', true)).toEqual({ model: M('deepseek', false, true), switched: false });
  });
});
