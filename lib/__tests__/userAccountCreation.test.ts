import { describe, expect, it } from 'vitest';
import { Role } from '../../types';
import {
  buildCreateUserFunctionPayload,
  readFunctionInvokeErrorMessage,
} from '../userAccountCreation';

describe('buildCreateUserFunctionPayload', () => {
  it('sends the full app profile with the auth account request', () => {
    const payload = buildCreateUserFunctionPayload({
      email: '  New.User@Example.COM ',
      password: 'secret123',
      profile: {
        name: 'Nguyen Van A',
        username: 'nva',
        phone: '0909000000',
        role: Role.WAREHOUSE_KEEPER,
        avatar: 'https://example.com/avatar.png',
        assignedWarehouseId: 'warehouse-1',
        allowedModules: ['WMS'],
        adminModules: ['TS'],
        allowedSubModules: { WMS: ['/inventory'] },
        adminSubModules: { TS: ['/ts/assets'] },
        isActive: true,
      },
    });

    expect(payload).toEqual({
      email: 'new.user@example.com',
      password: 'secret123',
      profile: {
        name: 'Nguyen Van A',
        username: 'nva',
        phone: '0909000000',
        role: Role.WAREHOUSE_KEEPER,
        avatar: 'https://example.com/avatar.png',
        assignedWarehouseId: 'warehouse-1',
        allowedModules: ['WMS'],
        adminModules: ['TS'],
        allowedSubModules: { WMS: ['/inventory'] },
        adminSubModules: { TS: ['/ts/assets'] },
        isActive: true,
      },
    });
  });
});

describe('readFunctionInvokeErrorMessage', () => {
  it('reads the JSON error body from a non-2xx Edge Function response', async () => {
    const response = new Response(JSON.stringify({ error: 'Email already exists' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    const error = new Error('Edge Function returned a non-2xx status code') as Error & { context: Response };
    error.context = response;

    await expect(readFunctionInvokeErrorMessage(error)).resolves.toBe('Email already exists');
  });
});
