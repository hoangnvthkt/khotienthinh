import { strict as assert } from 'node:assert';
import { zipSync } from 'fflate';
import { InvalidRequestFile, processRequestFile } from './processor.ts';

const bytes=(value:string)=>new TextEncoder().encode(value);
Deno.test('accepts structurally valid docx and xlsx containers',async()=>{
  const docx=zipSync({'[Content_Types].xml':bytes('<Types/>'),'word/document.xml':bytes('<document/>')});
  const xlsx=zipSync({'[Content_Types].xml':bytes('<Types/>'),'xl/workbook.xml':bytes('<workbook/>')});
  assert.equal((await processRequestFile(docx,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',docx.length))[0].name,'original');
  assert.equal((await processRequestFile(xlsx,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xlsx.length))[0].name,'original');
});
Deno.test('rejects renamed zip, macro and encrypted Office files',async()=>{
  const renamed=zipSync({'hello.txt':bytes('hello')});
  const macro=zipSync({'[Content_Types].xml':bytes('macroEnabled'),'word/document.xml':bytes('<document/>'),'word/vbaProject.bin':bytes('vba')});
  const encrypted=zipSync({'[Content_Types].xml':bytes('<Types/>'),'EncryptionInfo':bytes('x'),'word/document.xml':bytes('<document/>')});
  for(const file of [renamed,macro,encrypted])await assert.rejects(()=>processRequestFile(file,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',file.length),InvalidRequestFile);
});
Deno.test('rejects Office zip bombs before decompression',async()=>{
  const file=zipSync({'[Content_Types].xml':bytes('<Types/>'),'word/document.xml':bytes('<document/>')});
  const view=new DataView(file.buffer,file.byteOffset,file.byteLength);
  let central=-1;
  for(let offset=0;offset<=file.length-46;offset+=1){if(view.getUint32(offset,true)===0x02014b50){central=offset;break;}}
  assert.notEqual(central,-1);
  view.setUint32(central+24,101*1024*1024,true);
  await assert.rejects(()=>processRequestFile(file,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',file.length),InvalidRequestFile);
});
Deno.test('inherits safe text and PDF validation',async()=>{
  const text=bytes('Nội dung hợp lệ');assert.equal((await processRequestFile(text,'text/plain',text.length))[0].name,'original');
  const html=bytes('<html><script>alert(1)</script></html>');await assert.rejects(()=>processRequestFile(html,'text/plain',html.length),InvalidRequestFile);
});
