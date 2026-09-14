import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, FileText, Image, Loader2, MessageCircle, Paperclip, Pencil, Reply, Send, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { mapRequestRpcError, requestRuntimeService, type RequestComment, type RequestMentionCandidatePage } from '../../lib/requestRuntimeService';
import { requestAttachmentService } from '../../lib/requestAttachmentService';
import { buildRequestCommentDocument } from '../../lib/requestDiscussionModel';

const key = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const date = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const orderThread = (items: RequestComment[]) => {
  const roots=items.filter(item=>!item.parentCommentId);
  const known=new Set(roots.map(item=>item.id));
  return roots.flatMap(root=>[root,...items.filter(item=>item.parentCommentId===root.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))])
    .concat(items.filter(item=>item.parentCommentId&&!known.has(item.parentCommentId)));
};

type Mention = RequestMentionCandidatePage['items'][number];
type DraftFile = { id: string; file: File; status: 'uploading'|'ready'|'error'; attachmentId?: string; error?: string };

const CommentContent = ({ comment, previews }: { comment: RequestComment; previews: Record<string,string> }) => <>
  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200">{comment.content.content.flatMap(paragraph => paragraph.content).map((node, index) => node.type === 'mention' ? <span key={index} className="rounded bg-violet-50 px-1 font-semibold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">@{node.label}</span> : <React.Fragment key={index}>{node.text}</React.Fragment>)}</p>
  {comment.attachments.length>0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{comment.attachments.map(item => item.kind==='discussion_image' ? <button type="button" key={item.id} onClick={()=>void requestAttachmentService.open(item.id,'display')} className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-800"><div className="flex aspect-[16/7] items-center justify-center overflow-hidden bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">{previews[item.id]?<img src={previews[item.id]} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.02]"/>:<Image size={26}/>}</div><span className="block truncate px-3 py-2 text-xs font-semibold" title={item.fileName}>{item.fileName}</span></button> : <button type="button" key={item.id} onClick={()=>void requestAttachmentService.open(item.id)} className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left hover:border-violet-300 dark:border-slate-700 dark:bg-slate-800"><FileText className="shrink-0 text-violet-600" size={20}/><span className="min-w-0"><span className="block truncate text-xs font-semibold" title={item.fileName}>{item.fileName}</span><span className="text-[11px] text-slate-400">{Math.ceil(item.sizeBytes/1024)} KB</span></span></button>)}</div>}
</>;

export const RequestDiscussion: React.FC<{ requestId: string; canComment: boolean; canAttach: boolean }> = ({ requestId, canComment, canAttach }) => {
  const { user } = useApp();
  const [comments, setComments] = useState<RequestComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [candidates, setCandidates] = useState<Mention[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [replyTo, setReplyTo] = useState<RequestComment|null>(null);
  const [editing, setEditing] = useState<RequestComment|null>(null);
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [sending, setSending] = useState(false);
  const [previews,setPreviews]=useState<Record<string,string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(0);
  const commandRef = useRef<{ payload: string; key: string } | null>(null);

  const load = async (session = sessionRef.current) => {
    setLoading(true); setError(null);
    try {
      const target=new URLSearchParams(window.location.search).get('comment');
      const anchor=target?await requestRuntimeService.getCommentAnchor(requestId,target).catch(()=>null):null;
      const page=await requestRuntimeService.listComments(requestId,anchor?.cursor);
      if (session !== sessionRef.current) return;
      setComments(orderThread(page.items));
      if(target)window.setTimeout(()=>{if(session===sessionRef.current)document.getElementById(`request-comment-${target}`)?.scrollIntoView({behavior:'smooth',block:'center'});},0);
    }
    catch (cause) { if(session===sessionRef.current)setError(mapRequestRpcError(cause).message); }
    finally { if(session===sessionRef.current)setLoading(false); }
  };
  useEffect(() => {
    const session=++sessionRef.current;
    commandRef.current=null;
    setComments([]); setText(''); setMentions([]); setFiles([]); setReplyTo(null); setEditing(null); setPreviews({});
    void load(session);
    return ()=>{sessionRef.current+=1;};
  }, [requestId,user.id]);
  useEffect(()=>{let active=true;const images=comments.flatMap(comment=>comment.attachments).filter(item=>item.kind==='discussion_image'&&!previews[item.id]);for(const item of images)requestAttachmentService.signedUrl(item.id,'thumbnail').then(url=>{if(active)setPreviews(current=>({...current,[item.id]:url}));}).catch(()=>undefined);return()=>{active=false;};},[comments,previews]);

  const mentionQuery = useMemo(() => text.match(/(?:^|\s)@([^\s@]{0,40})$/)?.[1], [text]);
  useEffect(() => {
    let active=true;
    if (mentionQuery===undefined || !canComment) { setCandidates([]); return; }
    const timer=window.setTimeout(()=>requestRuntimeService.listMentionCandidates(requestId,mentionQuery).then(page=>{if(active){setCandidates(page.items);setCandidateIndex(0);}}).catch(()=>{if(active)setCandidates([]);}),180);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[mentionQuery,requestId,canComment]);

  const chooseMention = (candidate: Mention) => {
    setText(current=>current.replace(/(?:^|\s)@([^\s@]{0,40})$/, match=>`${match.startsWith(' ')?' ':''}@${candidate.name} `));
    setMentions(current=>current.some(item=>item.userId===candidate.userId)?current:[...current,candidate]); setCandidates([]);
  };
  const addFiles = async (selected: FileList | File[]) => {
    const session=sessionRef.current;
    const incoming=Array.from(selected).slice(0,Math.max(0,10-files.length));
    const drafts=incoming.map(file=>({id:key(),file,status:'uploading' as const})); setFiles(current=>[...current,...drafts]);
    for (const draft of drafts) {
      try { const attachmentId=await requestAttachmentService.upload(requestId,draft.file,key()); if(session===sessionRef.current)setFiles(current=>current.map(item=>item.id===draft.id?{...item,status:'ready',attachmentId}:item)); }
      catch(cause){if(session===sessionRef.current)setFiles(current=>current.map(item=>item.id===draft.id?{...item,status:'error',error:(cause as Error).message}:item));}
    }
  };
  const send = async () => {
    const session=sessionRef.current;
    const attachmentIds=files.filter(item=>item.status==='ready'&&item.attachmentId).map(item=>item.attachmentId!);
    if ((!text.trim()&&!attachmentIds.length)||files.some(item=>item.status==='uploading')) return;
    setSending(true);setError(null);
    try {
      const payload=editing
        ? {requestId,commentId:editing.id,expectedLockVersion:editing.lockVersion,content:buildRequestCommentDocument(text.trim(),mentions)}
        : {requestId,content:buildRequestCommentDocument(text.trim(),mentions),parentCommentId:replyTo?.id??null,attachmentIds};
      const serialized=JSON.stringify({command:editing?'edit':replyTo?'reply':'create',payload});
      if(commandRef.current?.payload!==serialized)commandRef.current={payload:serialized,key:key()};
      await requestRuntimeService.comment(editing?'edit':replyTo?'reply':'create',payload,commandRef.current.key);
      if(session!==sessionRef.current)return;
      commandRef.current=null;
      setText('');setMentions([]);setFiles([]);setReplyTo(null);setEditing(null);await load();
    }
    catch(cause){if(session===sessionRef.current)setError(mapRequestRpcError(cause).message);} finally{if(session===sessionRef.current)setSending(false);}
  };

  return <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-labelledby="discussion-title">
    <header className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-violet-50 px-4 py-4 dark:border-slate-800 dark:from-emerald-950/30 dark:to-violet-950/20 sm:px-6"><div><h2 id="discussion-title" className="flex items-center gap-2 text-base font-extrabold text-slate-900 dark:text-white"><MessageCircle className="text-emerald-600" size={19}/>Thảo luận</h2><p className="mt-1 text-xs text-slate-500">Trao đổi, nhắc người liên quan và chia sẻ tài liệu ngay trên đề xuất.</p></div><span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-bold text-slate-600 shadow-sm dark:bg-slate-900/70 dark:text-slate-300">{comments.length}</span></header>
    {canComment && <div className="border-b border-slate-100 p-4 dark:border-slate-800 sm:p-6" onDragOver={event=>{if(canAttach)event.preventDefault();}} onDrop={event=>{if(canAttach&&event.dataTransfer.files.length){event.preventDefault();void addFiles(event.dataTransfer.files);}}}><div className="flex min-w-0 gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">{user.avatar?<img src={user.avatar} alt="" className="h-full w-full object-cover"/>:user.name.slice(0,2).toUpperCase()}</div><div className="relative min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 focus-within:border-emerald-400 focus-within:ring-4 focus-within:ring-emerald-100/60 dark:border-slate-700 dark:bg-slate-950/50 dark:focus-within:ring-emerald-950">
      {replyTo&&<div className="mb-2 flex min-w-0 items-center justify-between rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:bg-violet-950/40 dark:text-violet-200"><span className="truncate">Đang trả lời {replyTo.author.name}: {replyTo.contentText}</span><button type="button" onClick={()=>setReplyTo(null)} className="ml-2 shrink-0"><X size={14}/></button></div>}
      {editing&&<div className="mb-2 flex min-w-0 items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><span className="truncate">Đang sửa bình luận của bạn</span><button type="button" onClick={()=>{setEditing(null);setText('');setMentions([]);}} className="ml-2 shrink-0"><X size={14}/></button></div>}
      <textarea value={text} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(!candidates.length)return;if(event.key==='ArrowDown'){event.preventDefault();setCandidateIndex(index=>(index+1)%candidates.length);}else if(event.key==='ArrowUp'){event.preventDefault();setCandidateIndex(index=>(index-1+candidates.length)%candidates.length);}else if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();chooseMention(candidates[candidateIndex]);}else if(event.key==='Escape'){event.preventDefault();setCandidates([]);}}} onPaste={event=>{const images=Array.from(event.clipboardData.files).filter(file=>file.type.startsWith('image/'));if(images.length){event.preventDefault();void addFiles(images);}}} rows={3} placeholder="Viết thảo luận của bạn… Dùng @ để nhắc người" aria-expanded={candidates.length>0} aria-controls="request-mention-list" className="w-full resize-none bg-transparent text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 dark:text-white"/>
      {candidates.length>0&&<div id="request-mention-list" role="listbox" className="absolute left-3 top-full z-20 mt-2 max-h-56 w-[min(340px,calc(100vw-4rem))] overflow-y-auto rounded-2xl border border-violet-200 bg-white p-1.5 shadow-xl dark:border-violet-900 dark:bg-slate-900">{candidates.map((candidate,index)=><button type="button" role="option" aria-selected={index===candidateIndex} key={candidate.userId} onClick={()=>chooseMention(candidate)} className={`flex w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left ${index===candidateIndex?'bg-violet-50 dark:bg-violet-950/40':'hover:bg-violet-50 dark:hover:bg-violet-950/40'}`}><AtSign className="shrink-0 text-violet-600" size={16}/><span className="min-w-0"><span className="block truncate text-sm font-semibold">{candidate.name}</span>{candidate.position&&<span className="block truncate text-xs text-slate-400">{candidate.position}</span>}</span></button>)}</div>}
      {files.length>0&&<div className="mt-2 grid gap-2 sm:grid-cols-2">{files.map(item=><div key={item.id} className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 ${item.status==='error'?'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30':'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>{item.status==='uploading'?<Loader2 className="shrink-0 animate-spin text-emerald-600" size={16}/>:<Paperclip className="shrink-0 text-violet-600" size={16}/>}<span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold" title={item.file.name}>{item.file.name}</span>{item.error&&<span className="block break-words text-[11px] text-rose-600">{item.error}</span>}</span><button type="button" onClick={()=>setFiles(current=>current.filter(file=>file.id!==item.id))} className="shrink-0 text-slate-400 hover:text-rose-600"><X size={14}/></button></div>)}</div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700"><div className="flex items-center gap-1">{canAttach&&!editing&&<><input ref={inputRef} type="file" multiple className="hidden" accept="image/jpeg,image/png,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={event=>{if(event.target.files)void addFiles(event.target.files);event.target.value='';}}/><button type="button" onClick={()=>inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-white hover:text-violet-700 dark:text-slate-300 dark:hover:bg-slate-800"><Paperclip size={16}/>Đính kèm</button></>}</div><button type="button" onClick={()=>void send()} disabled={sending||files.some(item=>item.status==='uploading')||(!text.trim()&&!files.some(item=>item.status==='ready'))} className="inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-40">{sending?<Loader2 className="animate-spin" size={15}/>:<Send size={15}/>} {editing?'Lưu sửa':'Đăng'}</button></div>
    </div></div></div>}
    <div className="divide-y divide-slate-100 dark:divide-slate-800">{loading?<div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"><Loader2 className="animate-spin text-emerald-600" size={18}/>Đang tải thảo luận…</div>:error?<div className="p-6 text-sm text-rose-600"><p className="break-words">{error}</p><button type="button" onClick={()=>void load()} className="mt-2 font-semibold underline">Thử lại</button></div>:comments.length===0?<div className="p-10 text-center"><MessageCircle className="mx-auto text-slate-300" size={30}/><p className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Chưa có thảo luận</p><p className="mt-1 text-xs text-slate-400">Hãy bắt đầu trao đổi về đề xuất này.</p></div>:comments.map(comment=><article id={`request-comment-${comment.id}`} key={comment.id} className={`${comment.parentCommentId?'ml-8 border-l-2 border-violet-100 sm:ml-14 dark:border-violet-950':''} p-4 sm:p-6`}><div className="flex min-w-0 gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800">{comment.author.avatarUrl?<img src={comment.author.avatarUrl} alt="" className="h-full w-full object-cover"/>:comment.author.name.slice(0,2).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><strong className="break-words text-sm text-slate-900 dark:text-white">{comment.author.name}</strong><time className="text-[11px] text-slate-400">{date(comment.createdAt)}</time>{comment.editedAt&&<span className="text-[11px] italic text-slate-400">đã sửa</span>}</div><div className="mt-2"><CommentContent comment={comment} previews={previews}/></div>{canComment&&<div className="mt-3 flex items-center gap-3"><button type="button" onClick={()=>{setEditing(null);setReplyTo(comment);}} className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-800"><Reply size={14}/>Trả lời</button>{comment.canEdit&&<button type="button" onClick={()=>{setReplyTo(null);setEditing(comment);setText(comment.contentText);setMentions(comment.content.content.flatMap(paragraph=>paragraph.content).filter((node):node is Extract<typeof node,{type:'mention'}>=>node.type==='mention').map(node=>({userId:node.userId,name:node.label})));setFiles([]);}} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-900"><Pencil size={13}/>Sửa</button>}</div>}</div></div></article>)}</div>
  </section>;
};
