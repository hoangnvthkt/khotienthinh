import { unzipSync } from 'fflate';
import { InvalidFile as WorkInvalidFile, processFile as processWorkFile, type Output } from '../work-attachments/processor.ts';

export class InvalidRequestFile extends Error { constructor() { super('REQUEST_INVALID_FILE'); } }
const compoundTypes = new Set(['application/msword','application/vnd.ms-excel']);
const openXmlTypes = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const ascii = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

const inspectZipDirectory = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new InvalidRequestFile();
  const entries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entries < 1 || entries > 2000 || centralOffset + centralSize > eocd) throw new InvalidRequestFile();
  let offset = centralOffset;
  let total = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new InvalidRequestFile();
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if ((flags & 1) !== 0 || ![0, 8].includes(method) || compressed > 25 * 1024 * 1024) throw new InvalidRequestFile();
    total += uncompressed;
    if (total > 100 * 1024 * 1024) throw new InvalidRequestFile();
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw new InvalidRequestFile();
};

const validateCompoundOffice = (bytes: Uint8Array, mime: string) => {
  const signature=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1];
  if (bytes.length<512 || !signature.every((value,index)=>bytes[index]===value)) throw new InvalidRequestFile();
  const raw=ascii(bytes).toLowerCase();
  if (/vba|macros|encryptedpackage|encryptioninfo|_vba_project/.test(raw)) throw new InvalidRequestFile();
  const utf16=new TextDecoder('utf-16le').decode(bytes).toLowerCase();
  if (mime==='application/msword' && !utf16.includes('worddocument')) throw new InvalidRequestFile();
  if (mime==='application/vnd.ms-excel' && !utf16.includes('workbook') && !utf16.includes('book')) throw new InvalidRequestFile();
};

const validateOpenXml = (bytes: Uint8Array, mime: string) => {
  if (bytes.length<22 || bytes[0]!==0x50 || bytes[1]!==0x4b || bytes[2]!==0x03 || bytes[3]!==0x04) throw new InvalidRequestFile();
  inspectZipDirectory(bytes);
  const binary=ascii(bytes).toLowerCase();
  if (/vbaproject\.bin|encryptedpackage|encryptioninfo|activex\//.test(binary)) throw new InvalidRequestFile();
  let files: Record<string,Uint8Array>;
  try { files=unzipSync(bytes); } catch { throw new InvalidRequestFile(); }
  const names=Object.keys(files); let total=0;
  if (names.length>2000) throw new InvalidRequestFile();
  for(const name of names){total+=files[name].length;if(total>100*1024*1024 || /(?:^|\/)vbaproject\.bin$|activex\//i.test(name))throw new InvalidRequestFile();}
  const types=files['[Content_Types].xml'];
  const required=mime.includes('wordprocessingml')?'word/document.xml':'xl/workbook.xml';
  if(!types || !files[required]) throw new InvalidRequestFile();
  const contentTypes=new TextDecoder().decode(types).toLowerCase();
  if(/macroenabled|vba|activex|encrypted/.test(contentTypes)) throw new InvalidRequestFile();
};

export async function processRequestFile(bytes:Uint8Array,mime:string,expectedSize:number,maxEdge=1920):Promise<Output[]> {
  if(bytes.length!==expectedSize || bytes.length<1 || bytes.length>26214400) throw new InvalidRequestFile();
  try {
    if(openXmlTypes.has(mime)){validateOpenXml(bytes,mime);return [{name:'original',mimeType:mime,bytes}];}
    if(compoundTypes.has(mime)){validateCompoundOffice(bytes,mime);return [{name:'original',mimeType:mime,bytes}];}
    return await processWorkFile(bytes,mime,expectedSize,false,maxEdge);
  } catch(error){if(error instanceof InvalidRequestFile)throw error;if(error instanceof WorkInvalidFile)throw new InvalidRequestFile();throw error;}
}
