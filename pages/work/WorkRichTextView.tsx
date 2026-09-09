import React, { type ReactNode } from "react";
import type { WorkInlineNode, WorkTextDocument, WorkTextMark } from "../../lib/work/workTypes";

export function safeWorkHref(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function marked(content: ReactNode, marks: WorkTextMark[] = [], key: string) {
  return marks.reduce<ReactNode>((child, mark, index) => {
    const markKey = `${key}-${index}`;
    if (mark.type === "bold") return <strong key={markKey}>{child}</strong>;
    if (mark.type === "italic") return <em key={markKey}>{child}</em>;
    if (mark.type === "underline") return <u key={markKey}>{child}</u>;
    if (mark.type === "strike") return <s key={markKey}>{child}</s>;
    if (mark.type === "code") return <code key={markKey}>{child}</code>;
    const href = safeWorkHref("attrs" in mark ? mark.attrs.href : "");
    return href
      ? <a key={markKey} href={href} target="_blank" rel="noreferrer noopener">{child}</a>
      : child;
  }, content);
}

function inline(nodes: WorkInlineNode[], key: string) {
  return nodes.map((node, index) => node.type === "mention"
    ? <span className="work-rich-mention" key={`${key}-${index}`}>@{node.label}</span>
    : <React.Fragment key={`${key}-${index}`}>
        {marked(node.text, node.marks, `${key}-${index}`)}
      </React.Fragment>);
}

export function WorkRichTextView({ document, empty = "Chưa có nội dung." }: {
  document: WorkTextDocument;
  empty?: string;
}) {
  if (!document.content.length) return <p className="work-rich-empty">{empty}</p>;
  return <div className="work-rich-view">
    {document.content.map((block, index) => {
      const key = `block-${index}`;
      if (block.type === "heading") return block.level === 1
        ? <h4 key={key}>{inline(block.content, key)}</h4>
        : <h5 key={key}>{inline(block.content, key)}</h5>;
      if (block.type === "blockquote") return <blockquote key={key}>{inline(block.content, key)}</blockquote>;
      if (block.type === "code_block") return <pre key={key}><code>{inline(block.content, key)}</code></pre>;
      if (block.type === "bullet_list" || block.type === "ordered_list") {
        const items = block.content.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{inline(item.content, `${key}-${itemIndex}`)}</li>);
        return block.type === "bullet_list" ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>;
      }
      return <p key={key}>{inline(block.content as WorkInlineNode[], key)}</p>;
    })}
  </div>;
}
