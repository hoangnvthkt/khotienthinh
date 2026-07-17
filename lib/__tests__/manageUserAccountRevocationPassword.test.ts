import { describe, expect, it } from 'vitest';
import { buildRevocationPassword } from '../../supabase/functions/_shared/accountLifecyclePassword.ts';

describe('manage-user-account revocation password', () => {
  it('generates unique strong passwords within the Supabase Auth length limit', () => {
    const samples = Array.from({ length: 32 }, buildRevocationPassword);

    expect(new Set(samples).size).toBe(samples.length);
    for (const password of samples) {
      expect(password.length).toBeGreaterThanOrEqual(8);
      expect(password.length).toBeLessThanOrEqual(72);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
    }
  });
});
