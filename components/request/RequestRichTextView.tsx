import React from 'react';
import { parseRichText, richTextSizeCss, type RichTextRun } from '../../lib/requestRichText';

const Run: React.FC<{ run: RichTextRun }> = ({ run }) => {
  let node: React.ReactNode = run.text;
  if (run.color || run.size) node = <span style={{ color: run.color, fontSize: richTextSizeCss(run.size) }}>{node}</span>;
  if (run.s) node = <s>{node}</s>;
  if (run.u) node = <u>{node}</u>;
  if (run.i) node = <em>{node}</em>;
  if (run.b) node = <strong>{node}</strong>;
  return <>{node}</>;
};

/** Renders stored request rich text (or legacy plain text) as React elements — never as raw HTML. */
export const RequestRichTextView: React.FC<{ value: unknown; className?: string; emptyText?: string }> = ({ value, className = '', emptyText }) => {
  const doc = parseRichText(value);
  if (!doc.blocks.length) return emptyText ? <span className="italic text-slate-400">{emptyText}</span> : null;
  return <div className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${className}`}>
    {doc.blocks.map((block, index) => {
      const style: React.CSSProperties = { textAlign: block.align, marginLeft: block.indent ? `${block.indent * 2.5}rem` : undefined };
      if (block.type === 'paragraph') return <p key={index} style={style} className="min-h-[1.5em]">{(block.lines[0] ?? []).map((run, runIndex) => <Run key={runIndex} run={run} />)}</p>;
      const List = block.type === 'bullet' ? 'ul' : 'ol';
      return <List key={index} style={style} className={`${block.type === 'bullet' ? 'list-disc' : 'list-decimal'} pl-6`}>
        {block.lines.map((line, lineIndex) => <li key={lineIndex}>{line.map((run, runIndex) => <Run key={runIndex} run={run} />)}</li>)}
      </List>;
    })}
  </div>;
};

export default RequestRichTextView;
