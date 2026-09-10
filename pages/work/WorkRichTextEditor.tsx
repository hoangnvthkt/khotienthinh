import React, { useEffect, useMemo, useRef } from "react";
import {
  Bold, Code2, Italic, Link2, List, ListOrdered, Quote,
  Strikethrough, Underline,
} from "lucide-react";
import type { WorkInlineNode, WorkTextDocument, WorkTextMark } from "../../lib/work/workTypes";
import { safeWorkHref } from "./WorkRichTextView";

const EMPTY: WorkTextDocument = { version: 1, type: "doc", content: [] };

function markFor(element: Element): WorkTextMark | null {
  const tag = element.tagName.toLowerCase();
  if (tag === "strong" || tag === "b") return { type: "bold" };
  if (tag === "em" || tag === "i") return { type: "italic" };
  if (tag === "u") return { type: "underline" };
  if (tag === "s" || tag === "strike") return { type: "strike" };
  if (tag === "code") return { type: "code" };
  if (tag === "a") {
    const href = safeWorkHref(element.getAttribute("href") || "");
    return href ? { type: "link", attrs: { href } } : null;
  }
  return null;
}

function inlineFrom(node: Node, marks: WorkTextMark[] = []): WorkInlineNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    return text ? [{ type: "text", text, ...(marks.length ? { marks } : {}) }] : [];
  }
  if (!(node instanceof Element)) return [];
  if (node.tagName.toLowerCase() === "br") return [{ type: "text", text: "\n", ...(marks.length ? { marks } : {}) }];
  const next = markFor(node);
  const active = next ? [...marks, next] : marks;
  return [...node.childNodes].flatMap((child) => inlineFrom(child, active));
}

function childInline(element: Element) {
  return [...element.childNodes].flatMap((child) => inlineFrom(child));
}

export function documentFromEditor(root: HTMLElement): WorkTextDocument {
  const content: WorkTextDocument["content"] = [];
  for (const child of [...root.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent) content.push({ type: "paragraph", content: inlineFrom(child) });
      continue;
    }
    if (!(child instanceof Element)) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      const items = [...child.children]
        .filter((item) => item.tagName.toLowerCase() === "li")
        .map((item) => ({ type: "list_item" as const, content: childInline(item) }));
      if (items.length) content.push({ type: tag === "ul" ? "bullet_list" : "ordered_list", content: items });
      continue;
    }
    const nodes = childInline(child);
    if (tag === "h1") content.push({ type: "heading", level: 1, content: nodes });
    else if (tag === "h2") content.push({ type: "heading", level: 2, content: nodes });
    else if (tag === "blockquote") content.push({ type: "blockquote", content: nodes });
    else if (tag === "pre") content.push({ type: "code_block", content: nodes });
    else content.push({ type: "paragraph", content: nodes });
  }
  return content.length ? { version: 1, type: "doc", content } : EMPTY;
}

function appendInline(target: HTMLElement, nodes: WorkInlineNode[]) {
  for (const node of nodes) {
    let current: Node = document.createTextNode(node.type === "mention" ? `@${node.label}` : node.text);
    if (node.type === "text") for (const mark of node.marks || []) {
      const tag = mark.type === "bold" ? "strong" : mark.type === "italic" ? "em" : mark.type === "underline" ? "u" : mark.type === "strike" ? "s" : mark.type === "code" ? "code" : "a";
      const wrapper = document.createElement(tag);
      if (mark.type === "link") {
        const href = safeWorkHref(mark.attrs.href);
        if (!href) continue;
        wrapper.setAttribute("href", href);
      }
      wrapper.append(current);
      current = wrapper;
    }
    target.append(current);
  }
}

function fillEditor(root: HTMLElement, value: WorkTextDocument) {
  root.replaceChildren();
  for (const block of value.content) {
    if (block.type === "bullet_list" || block.type === "ordered_list") {
      const list = document.createElement(block.type === "bullet_list" ? "ul" : "ol");
      block.content.forEach((item) => {
        const li = document.createElement("li");
        appendInline(li, item.content);
        list.append(li);
      });
      root.append(list);
      continue;
    }
    const tag = block.type === "heading" ? `h${block.level}` : block.type === "blockquote" ? "blockquote" : block.type === "code_block" ? "pre" : "p";
    const element = document.createElement(tag);
    appendInline(element, block.content as WorkInlineNode[]);
    if (!element.childNodes.length) element.append(document.createElement("br"));
    root.append(element);
  }
}

export function WorkRichTextEditor({ label, value, onChange, disabled, placeholder }: {
  label: string;
  value: WorkTextDocument;
  onChange: (value: WorkTextDocument) => void;
  disabled?: boolean;
  placeholder: string;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const rendered = useRef("");
  const signature = useMemo(() => JSON.stringify(value), [value]);
  useEffect(() => {
    if (editor.current && rendered.current !== signature) {
      fillEditor(editor.current, value);
      rendered.current = signature;
    }
  }, [signature]);
  const change = () => {
    if (!editor.current) return;
    const next = documentFromEditor(editor.current);
    rendered.current = JSON.stringify(next);
    onChange(next);
  };
  const command = (name: string, argument?: string) => {
    editor.current?.focus();
    document.execCommand(name, false, argument);
    change();
  };
  const link = () => {
    const raw = window.prompt("Dán liên kết http, https hoặc mailto");
    if (!raw) return;
    const href = safeWorkHref(raw.trim());
    if (!href) return window.alert("Liên kết chưa hợp lệ.");
    command("createLink", href);
  };
  return <div className="work-rich-editor" data-disabled={disabled || undefined}>
    <div className="work-rich-canvas" ref={editor} role="textbox" aria-label={label} aria-multiline="true"
      contentEditable={!disabled} suppressContentEditableWarning data-placeholder={placeholder}
      onInput={change} onPaste={(event) => {
        event.preventDefault();
        document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
      }} />
    <div className="work-rich-toolbar" role="toolbar" aria-label={`Định dạng ${label}`} onMouseDown={(event) => event.preventDefault()}>
      <button type="button" title="Đậm" aria-label="Đậm" disabled={disabled} onClick={() => command("bold")}><Bold /></button>
      <button type="button" title="Nghiêng" aria-label="Nghiêng" disabled={disabled} onClick={() => command("italic")}><Italic /></button>
      <button type="button" title="Gạch chân" aria-label="Gạch chân" disabled={disabled} onClick={() => command("underline")}><Underline /></button>
      <button type="button" title="Gạch ngang" aria-label="Gạch ngang" disabled={disabled} onClick={() => command("strikeThrough")}><Strikethrough /></button>
      <span aria-hidden="true" />
      <button type="button" title="Tiêu đề lớn" aria-label="Tiêu đề lớn" disabled={disabled} onClick={() => command("formatBlock", "H1")}>H1</button>
      <button type="button" title="Tiêu đề nhỏ" aria-label="Tiêu đề nhỏ" disabled={disabled} onClick={() => command("formatBlock", "H2")}>H2</button>
      <button type="button" title="Danh sách" aria-label="Danh sách" disabled={disabled} onClick={() => command("insertUnorderedList")}><List /></button>
      <button type="button" title="Danh sách số" aria-label="Danh sách số" disabled={disabled} onClick={() => command("insertOrderedList")}><ListOrdered /></button>
      <button type="button" title="Trích dẫn" aria-label="Trích dẫn" disabled={disabled} onClick={() => command("formatBlock", "BLOCKQUOTE")}><Quote /></button>
      <button type="button" title="Mã" aria-label="Mã" disabled={disabled} onClick={() => command("formatBlock", "PRE")}><Code2 /></button>
      <button type="button" title="Liên kết" aria-label="Liên kết" disabled={disabled} onClick={link}><Link2 /></button>
    </div>
  </div>;
}
