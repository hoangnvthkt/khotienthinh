import {expect,it,vi} from 'vitest';
vi.mock('./cloud.mjs',()=>({
  branchConfig:()=>{throw new Error('synthetic CLI diagnostic with fixture-secret');},
  query:()=>{throw new Error('No Cloud request is permitted after configuration failure');},
  ref:'oymkraihhqahqvzahhtx',
}));
import {createUxFixture} from './ux-test-sessions.mjs';

it('suppresses sensitive CLI diagnostics before any acceptance fixture can be created',async()=>{
  await expect(createUxFixture()).rejects.toThrow('Unable to resolve authorized test Cloud configuration; diagnostic output suppressed');
});
