import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OfficePeoplePanel } from '../../pages/office/OfficePeople';
import { officeFolderPath } from '../../pages/office/OfficeDetail';
import type { OfficeCatalog } from '../../lib/office/officeTypes';
import type { OfficeService } from '../../lib/office/officeService';
describe('Office issued detail context',()=>{
 it('renders folder ancestry and handles unknown classification',()=>{
  const catalog={folders:[{id:'a',name:'Công ty',parent_id:null},{id:'b',name:'Hành chính',parent_id:'a'}]} as OfficeCatalog;
  expect(officeFolderPath(catalog,'b')).toBe('Công ty › Hành chính');
  expect(officeFolderPath(catalog,null)).toBe('Chưa phân loại');
  expect(officeFolderPath(catalog,'missing')).toBe('Không xác định thư mục');
 });
 it('keeps the initial list compact while showing the full count',()=>{
  const items=Array.from({length:6},(_,i)=>({user_id:String(i),name:`Người ${i}`,username:null,occurred_at:null}));
  const html=renderToStaticMarkup(<OfficePeoplePanel id="d" kind="recipients" initial={{total:6,items}} service={{} as OfficeService}/>);
  expect(html).toContain('Người 3');expect(html).not.toContain('Người 4');expect(html).toContain('Xem thêm (2)');
 });
 it('does not claim zero downloads when stats are unavailable',()=>{
  const html=renderToStaticMarkup(<OfficePeoplePanel id="d" kind="downloads" service={{} as OfficeService}/>);
  expect(html).not.toContain('Chưa ghi nhận lượt tải tệp.');expect(html).not.toContain('office-people-count');
 });
});
