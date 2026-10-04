import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { openNotificationImmediately } from '../openNotification';
import type { AppNotification } from '../notificationService';
const notification = { id:'n', sourceType:'office_document', sourceId:'doc-123', isRead:false } as AppNotification;
const swSource=readFileSync(new URL('../../public/sw.js',import.meta.url),'utf8');
describe('Office notification open',()=>{
 it('opens synchronously while read acknowledgement is pending',async()=>{
  const open=vi.fn(),markRead=vi.fn(()=>new Promise(()=>{}));
  openNotificationImmediately(notification,open,markRead);
  expect(open).toHaveBeenCalledWith('/office/documents/doc-123');
  await Promise.resolve();expect(markRead).toHaveBeenCalledWith('n');
 });
 it('still opens when marking as read fails and reports that failure',async()=>{
  const open=vi.fn(),onError=vi.fn(),error=new Error('offline');
  openNotificationImmediately(notification,open,()=>Promise.reject(error),onError);
  await vi.waitFor(()=>expect(onError).toHaveBeenCalledWith(error));
  expect(open).toHaveBeenCalledOnce();
 });
 for(const hasClient of [true,false]) it(`push click opens exact hash route with ${hasClient?'existing':'new'} window`,async()=>{
  const handlers=new Map<string,(e:any)=>void>(), focus=vi.fn(),navigate=vi.fn(async()=>({focus})),openWindow=vi.fn();
  runInNewContext(swSource,{URL,console,self:{location:{origin:'https://vioo.test'},addEventListener:(name:string,fn:any)=>handlers.set(name,fn),clients:{matchAll:async()=>hasClient?[{url:'https://vioo.test/#/settings',focus,navigate}]:[],openWindow}}});
  let done:Promise<void>|undefined;
  handlers.get('notificationclick')!({notification:{close:vi.fn(),data:{url:'/office/documents/doc-123'}},waitUntil:(p:Promise<void>)=>{done=p;}});
  await done;
  expect(hasClient?navigate:openWindow).toHaveBeenCalledWith('https://vioo.test/#/office/documents/doc-123');
 });
});
