import { createClient } from '@supabase/supabase-js';
import { InvalidRequestFile, processRequestFile } from './processor.ts';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return response({error:'Method not allowed'},405);
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const internal=request.headers.get('x-web-push-secret');
  if(internal){if(!Deno.env.get('SEND_WEB_PUSH_SECRET')||internal!==Deno.env.get('SEND_WEB_PUSH_SECRET'))return response({error:'Unauthorized'},401);}
  else if(!token||(await admin.auth.getUser(token)).error)return response({error:'Unauthorized'},401);
  let body:{attachmentId?:string;action?:string;variant?:string};try{body=await request.json();}catch{return response({error:'Invalid request'},400);}
  if(body.action==='cleanup'){
    if(!internal)return response({error:'Forbidden'},403);
    const claimed=await admin.rpc('claim_request_attachment_cleanup',{p_limit:30});
    if(claimed.error)throw claimed.error;
    let removed=0;
    for(const job of claimed.data as Array<{id:string;path:string;token:string;variantPaths:string[]}>){
      const paths=[job.path,...job.variantPaths]; const result=await admin.storage.from('request-attachments').remove(paths);
      const done=await admin.rpc('finish_request_attachment_cleanup',{p_id:job.id,p_token:job.token,p_success:!result.error});
      if(!result.error&&!done.error)removed++;
    }
    return response({claimed:(claimed.data as unknown[]).length,removed});
  }
  if(!body?.attachmentId || !/^[0-9a-f-]{36}$/i.test(body.attachmentId))return response({error:'Invalid request'},400);
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  if(body.action==='read'){
    const authorized=await client.rpc('authorize_request_attachment',{p_attachment_id:body.attachmentId,p_variant:body.variant||'original'});
    if(authorized.error)return response({error:authorized.error.message},authorized.error.code==='42501'?403:409);
    const item=authorized.data as {path:string;fileName:string;download:boolean};
    const signed=await admin.storage.from('request-attachments').createSignedUrl(item.path,300,{download:item.download?item.fileName:false});
    if(signed.error)return response({error:'REQUEST_ATTACHMENT_SIGN_FAILED'},500);
    const fence=await client.rpc('authorize_request_attachment',{p_attachment_id:body.attachmentId,p_variant:body.variant||'original'});
    if(fence.error || (fence.data as {path?:string})?.path!==item.path)return response({error:'REQUEST_ATTACHMENT_ACCESS_REVOKED'},403);
    return response({signedUrl:signed.data.signedUrl,expiresIn:300});
  }
  const claimResult=await client.rpc('claim_request_attachment',{p_attachment_id:body.attachmentId});
  if(claimResult.error)return response({error:claimResult.error.message},claimResult.error.code==='42501'?403:409);
  const claim=claimResult.data as {id:string;status:string;sourcePath?:string;outputPrefix?:string;mimeType?:string;sizeBytes?:number};
  if(claim.status==='ready')return response({id:claim.id,status:'ready'});
  try{
    const source=await admin.storage.from('request-attachments').download(claim.sourcePath!);
    if(source.error||!source.data)throw new Error('REQUEST_SOURCE_UNAVAILABLE');
    const outputs=await processRequestFile(new Uint8Array(await source.data.arrayBuffer()),claim.mimeType!,claim.sizeBytes!,Number(Deno.env.get('REQUEST_IMAGE_MAX_EDGE')||1920));
    const variants:Record<string,unknown>={};
    for(const output of outputs){
      const isOriginal=output.name==='original'; const path=isOriginal?claim.sourcePath!:claim.outputPrefix!+output.name;
      if(!isOriginal){const uploaded=await admin.storage.from('request-attachments').upload(path,output.bytes,{contentType:output.mimeType,cacheControl:'60',upsert:false});if(uploaded.error)throw new Error('REQUEST_OUTPUT_UPLOAD_FAILED');}
      variants[output.name.split('.')[0]]={path,mimeType:output.mimeType,sizeBytes:output.bytes.length,...(output.width?{width:output.width,height:output.height}:{})};
    }
    const finished=await admin.rpc('finalize_request_attachment',{p_attachment_id:claim.id,p_success:true,p_variants:variants,p_failure_code:null});
    if(finished.error)throw finished.error;
    return response({id:claim.id,status:'ready'});
  }catch(error){
    await admin.rpc('finalize_request_attachment',{p_attachment_id:claim.id,p_success:false,p_variants:{},p_failure_code:error instanceof InvalidRequestFile?'invalid_file':'processing_failed'});
    return response({error:error instanceof InvalidRequestFile?'REQUEST_INVALID_FILE':'REQUEST_ATTACHMENT_PROCESSING_FAILED'},error instanceof InvalidRequestFile?422:500);
  }
});
