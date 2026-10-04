import React, { useEffect, useRef, useState } from "react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Link2,
  Table2,
  ImagePlus,
  Undo2,
  Redo2,
  RemoveFormatting,
  ChevronDown,
} from "lucide-react";
import type {
  OfficeAlignment,
  OfficeBlock,
  OfficeInline,
  OfficeMark,
  OfficeTextDocument,
} from "../../lib/office/officeContent";
import { officePlainText } from "../../lib/office/officeContent";
import type { OfficeAttachment } from "../../lib/office/officeTypes";
import type { OfficeService } from "../../lib/office/officeService";
import { safeWorkHref } from "../work/WorkRichTextView";
import { OfficeError, useOfficeQuery } from "./OfficeShared";
const SIZES = ["10", "12", "14", "16", "18", "20", "24", "28", "32", "36"];
const FONTS = ["Arial", "Times New Roman", "Calibri"];
function color(value: string): string | null {
  if (/^#[a-f\d]{6}$/i.test(value)) return value;
  const parts = value.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
  return parts
    ? `#${parts
        .slice(1)
        .map((n) => Number(n).toString(16).padStart(2, "0"))
        .join("")}`
    : null;
}
function inlineFrom(node: Node, marks: OfficeMark[] = []): OfficeInline[] {
  if (node.nodeType === Node.TEXT_NODE)
    return node.textContent
      ? [
          {
            type: "text",
            text: node.textContent,
            ...(marks.length ? { marks } : {}),
          },
        ]
      : [];
  if (!(node instanceof HTMLElement)) return [];
  if (
    ["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG", "IMG"].includes(node.tagName)
  )
    return [];
  if (node.tagName === "BR") return [{ type: "text", text: "\n", marks }];
  const active = [...marks];
  const tags: Record<string, OfficeMark["type"]> = {
    B: "bold",
    STRONG: "bold",
    I: "italic",
    EM: "italic",
    U: "underline",
    S: "strike",
    STRIKE: "strike",
    CODE: "code",
    SUP: "superscript",
    SUB: "subscript",
  };
  if (tags[node.tagName])
    active.push({ type: tags[node.tagName] } as OfficeMark);
  const href =
    node.tagName === "A" ? safeWorkHref(node.getAttribute("href") || "") : null;
  if (href) active.push({ type: "link", attrs: { href } });
  const fg = color(node.style.color || node.getAttribute("color") || "");
  const bg = color(node.style.backgroundColor);
  if (fg) active.push({ type: "color", attrs: { value: fg } });
  if (bg) active.push({ type: "highlight", attrs: { value: bg } });
  const size = node.style.fontSize.replace("px", "");
  if (SIZES.includes(size))
    active.push({ type: "fontSize", attrs: { value: size } });
  const family = (
    node.style.fontFamily ||
    node.getAttribute("face") ||
    ""
  ).replace(/["']/g, "");
  if (FONTS.includes(family))
    active.push({ type: "fontFamily", attrs: { value: family } });
  return [...node.childNodes].flatMap((child) => inlineFrom(child, active));
}
const childrenInline = (node: Element) =>
  [...node.childNodes].flatMap((n) => inlineFrom(n));
export function officeDocumentFromEditor(
  root: HTMLElement,
): OfficeTextDocument {
  const blocks: OfficeBlock[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent)
        blocks.push({ type: "paragraph", content: inlineFrom(node) });
      return;
    }
    if (
      !(node instanceof HTMLElement) ||
      ["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG"].includes(node.tagName)
    )
      return;
    if (node.tagName === "TABLE") {
      blocks.push({
        type: "table",
        content: [...node.querySelectorAll("tr")].slice(0, 50).map((row) => ({
          type: "table_row",
          content: [...row.children]
            .filter((c) => ["TD", "TH"].includes(c.tagName))
            .slice(0, 12)
            .map((cell) => ({
              type: "table_cell",
              content: childrenInline(cell),
            })),
        })),
      });
      return;
    }
    if (node.dataset.officeImage) {
      blocks.push({
        type: "image",
        attachmentId: node.dataset.officeImage,
        alt: node.dataset.alt || "",
      });
      return;
    }
    if (["UL", "OL"].includes(node.tagName)) {
      blocks.push({
        type: node.tagName === "UL" ? "bullet_list" : "ordered_list",
        content: [...node.children]
          .filter((n) => n.tagName === "LI")
          .map((n) => ({ type: "list_item", content: childrenInline(n) })),
      });
      return;
    }
    if (node.querySelector("table,ul,ol,[data-office-image]")) {
      [...node.childNodes].forEach(visit);
      return;
    }
    const align = ["left", "center", "right", "justify"].includes(
      node.style.textAlign,
    )
      ? (node.style.textAlign as OfficeAlignment)
      : undefined;
    if (/^H[1-3]$/.test(node.tagName))
      blocks.push({
        type: "heading",
        level: Number(node.tagName[1]) as 1 | 2 | 3,
        align,
        content: childrenInline(node),
      });
    else
      blocks.push({
        type:
          node.tagName === "BLOCKQUOTE"
            ? "blockquote"
            : node.tagName === "PRE"
              ? "code_block"
              : "paragraph",
        align,
        content: childrenInline(node),
      });
  };
  [...root.childNodes].forEach(visit);
  return { version: 1, type: "doc", content: blocks };
}
function appendInline(root: HTMLElement, nodes: OfficeInline[]) {
  for (const n of nodes) {
    let current: Node = document.createTextNode(
      n.type === "mention" ? `@${n.label}` : n.text,
    );
    for (const mark of n.type === "text" ? n.marks || [] : []) {
      const tags = {
        bold: "strong",
        italic: "em",
        underline: "u",
        strike: "s",
        code: "code",
        superscript: "sup",
        subscript: "sub",
      };
      const el = document.createElement(
        mark.type in tags
          ? tags[mark.type as keyof typeof tags]
          : mark.type === "link"
            ? "a"
            : "span",
      );
      if (mark.type === "link") {
        const href = safeWorkHref(mark.attrs.href);
        if (!href) continue;
        el.setAttribute("href", href);
      }
      if (mark.type === "color" && color(mark.attrs.value))
        el.style.color = mark.attrs.value;
      if (mark.type === "highlight" && color(mark.attrs.value))
        el.style.backgroundColor = mark.attrs.value;
      if (mark.type === "fontSize" && SIZES.includes(mark.attrs.value))
        el.style.fontSize = `${mark.attrs.value}px`;
      if (mark.type === "fontFamily" && FONTS.includes(mark.attrs.value))
        el.style.fontFamily = mark.attrs.value;
      el.append(current);
      current = el;
    }
    root.append(current);
  }
}
function contentDOM(value: OfficeTextDocument) {
  const root = document.createElement("div");
  for (const b of value.content) {
    if (b.type === "image") {
      // An image is an atomic editing node in both Safari and Chromium.
      // Safari flattens non-editable divs inserted through insertHTML.
      const el = document.createElement("img");
      el.dataset.officeImage = b.attachmentId;
      el.dataset.alt = b.alt;
      el.alt = `Ảnh đính kèm: ${b.alt || "Ảnh"}`;
      el.title = el.alt;
      const ns = "http://www.w3.org/2000/svg";
      const preview = document.createElementNS(ns, "svg");
      preview.setAttribute("width", "640");
      preview.setAttribute("height", "64");
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", "16");
      text.setAttribute("y", "38");
      text.setAttribute("font-family", "Arial, sans-serif");
      text.setAttribute("font-size", "18");
      text.setAttribute("fill", "#0f766e");
      text.textContent = el.alt;
      preview.append(text);
      el.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(preview))}`;
      el.className = "office-inline-image-placeholder";
      root.append(el);
      continue;
    }
    if (b.type === "table") {
      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      for (const r of b.content) {
        const row = document.createElement("tr");
        for (const c of r.content) {
          const cell = document.createElement("td");
          appendInline(cell, c.content);
          if (!cell.textContent) cell.append(document.createElement("br"));
          row.append(cell);
        }
        tbody.append(row);
      }
      table.append(tbody);
      root.append(table);
      continue;
    }
    if (b.type === "bullet_list" || b.type === "ordered_list") {
      const list = document.createElement(
        b.type === "bullet_list" ? "ul" : "ol",
      );
      for (const c of b.content) {
        const li = document.createElement("li");
        appendInline(li, c.content);
        list.append(li);
      }
      root.append(list);
      continue;
    }
    const el = document.createElement(
      b.type === "heading"
        ? `h${b.level || 2}`
        : b.type === "blockquote"
          ? "blockquote"
          : b.type === "code_block"
            ? "pre"
            : "p",
    );
    if ("align" in b && b.align) el.style.textAlign = b.align;
    appendInline(el, b.content as OfficeInline[]);
    if (!el.childNodes.length) el.append(document.createElement("br"));
    root.append(el);
  }
  return root;
}
export function OfficeRichTextEditor({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  images = [],
  onImageUpload,
}: {
  label: string;
  value: OfficeTextDocument;
  onChange: (value: OfficeTextDocument) => void;
  disabled?: boolean;
  placeholder: string;
  images?: OfficeAttachment[];
  onImageUpload?: (file: File) => Promise<OfficeAttachment>;
}) {
  const editor = useRef<HTMLDivElement>(null),
    selection = useRef<Range | null>(null),
    rendered = useRef("");
  const [advanced, setAdvanced] = useState(false),
    [tool, setTool] = useState<"link" | "table" | "image" | null>(null),
    [url, setUrl] = useState(""),
    [rows, setRows] = useState(3),
    [cols, setCols] = useState(3),
    [imageBusy, setImageBusy] = useState(false),
    [pendingImage, setPendingImage] = useState<OfficeAttachment | null>(null),
    [error, setError] = useState<unknown>(null);
  const signature = JSON.stringify(value);
  useEffect(() => {
    if (editor.current && rendered.current !== signature) {
      editor.current.replaceChildren(...contentDOM(value).childNodes);
      rendered.current = signature;
    }
  }, [signature]);
  const remember = () => {
    const s = window.getSelection();
    if (s?.rangeCount && editor.current?.contains(s.anchorNode))
      selection.current = s.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    editor.current?.focus();
    const s = window.getSelection();
    if (selection.current && s) {
      s.removeAllRanges();
      s.addRange(selection.current);
    }
  };
  const change = () => {
    if (!editor.current) return;
    const doc = officeDocumentFromEditor(editor.current);
    rendered.current = JSON.stringify(doc);
    onChange(doc);
    remember();
  };
  const command = (name: string, arg?: string) => {
    restore();
    document.execCommand(name, false, arg);
    change();
  };
  const insert = (doc: OfficeTextDocument) =>
    command("insertHTML", contentDOM(doc).innerHTML);
  const style = (property: string, v: string) => {
    restore();
    if (property === "fontSize") {
      document.execCommand("fontSize", false, "7");
      editor.current?.querySelectorAll('font[size="7"]').forEach((el) => {
        el.removeAttribute("size");
        (el as HTMLElement).style.fontSize = `${v}px`;
      });
      change();
    } else command(property, v);
  };
  const insertImage = (image: OfficeAttachment) => {
    insert({
      version: 1,
      type: "doc",
      content: [
        { type: "image", attachmentId: image.id, alt: image.file_name },
        { type: "paragraph", content: [] },
      ],
    });
    setTool(null);
  };
  useEffect(() => {
    // Upload also locks the parent form. Insert after React has made the
    // editing host editable again, preserving its saved caret and content.
    if (!pendingImage || disabled || imageBusy) return;
    insertImage(pendingImage);
    setPendingImage(null);
  }, [pendingImage, disabled, imageBusy]);
  const button = (name: string, icon: React.ReactNode, action: () => void) => (
    <button
      key={name}
      type="button"
      aria-label={name}
      title={name}
      disabled={disabled || imageBusy}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
    >
      {icon}
    </button>
  );
  return (
    <div className="office-rich-editor work-rich-editor">
      <div
        className="office-rich-toolbar"
        role="toolbar"
        aria-label={`Định dạng ${label}`}
      >
        {button("Hoàn tác", <Undo2 size={16} />, () => command("undo"))}
        {button("Làm lại", <Redo2 size={16} />, () => command("redo"))}
        {button("Đậm", <Bold size={16} />, () => command("bold"))}
        {button("Nghiêng", <Italic size={16} />, () => command("italic"))}
        {button("Gạch chân", <Underline size={16} />, () =>
          command("underline"),
        )}
        {button("Căn trái", <AlignLeft size={16} />, () =>
          command("justifyLeft"),
        )}
        {button("Căn giữa", <AlignCenter size={16} />, () =>
          command("justifyCenter"),
        )}
        {button("Căn phải", <AlignRight size={16} />, () =>
          command("justifyRight"),
        )}
        {button("Căn đều", <AlignJustify size={16} />, () =>
          command("justifyFull"),
        )}
        {button("Danh sách", <List size={16} />, () =>
          command("insertUnorderedList"),
        )}
        {button("Danh sách số", <ListOrdered size={16} />, () =>
          command("insertOrderedList"),
        )}
        <button
          type="button"
          aria-expanded={advanced}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setAdvanced(!advanced)}
        >
          Thêm <ChevronDown size={14} />
        </button>
      </div>
      {advanced && (
        <div
          className="office-rich-toolbar office-rich-advanced"
          role="toolbar"
          aria-label="Định dạng mở rộng"
        >
          <select
            aria-label="Phông chữ"
            disabled={disabled}
            defaultValue="Arial"
            onFocus={remember}
            onChange={(e) => style("fontName", e.target.value)}
          >
            {FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <select
            aria-label="Cỡ chữ"
            disabled={disabled}
            defaultValue="16"
            onFocus={remember}
            onChange={(e) => style("fontSize", e.target.value)}
          >
            {SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Kiểu đoạn"
            disabled={disabled}
            defaultValue="P"
            onFocus={remember}
            onChange={(e) => command("formatBlock", e.target.value)}
          >
            {[
              ["P", "Văn bản"],
              ["H1", "Tiêu đề 1"],
              ["H2", "Tiêu đề 2"],
              ["H3", "Tiêu đề 3"],
              ["BLOCKQUOTE", "Trích dẫn"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <label>
            Màu chữ{" "}
            <input
              type="color"
              aria-label="Màu chữ"
              defaultValue="#172033"
              disabled={disabled}
              onFocus={remember}
              onChange={(e) => command("foreColor", e.target.value)}
            />
          </label>
          <label>
            Tô nền{" "}
            <input
              type="color"
              aria-label="Tô nền chữ"
              defaultValue="#fef08a"
              disabled={disabled}
              onFocus={remember}
              onChange={(e) => command("hiliteColor", e.target.value)}
            />
          </label>
          {button("Gạch ngang", <Strikethrough size={16} />, () =>
            command("strikeThrough"),
          )}
          {button("Chỉ số trên", <>x²</>, () => command("superscript"))}
          {button("Chỉ số dưới", <>x₂</>, () => command("subscript"))}
          {button("Liên kết", <Link2 size={16} />, () => {
            remember();
            setTool(tool === "link" ? null : "link");
          })}
          {button("Chèn bảng", <Table2 size={16} />, () => {
            remember();
            setTool(tool === "table" ? null : "table");
          })}
          {(images.length > 0 || onImageUpload) &&
            button("Chèn ảnh", <ImagePlus size={16} />, () => {
              remember();
              setTool(tool === "image" ? null : "image");
            })}
          {button("Xóa định dạng", <RemoveFormatting size={16} />, () =>
            command("removeFormat"),
          )}
        </div>
      )}
      {tool && (
        <div className="office-editor-tool">
          {tool === "link" && (
            <>
              <input
                type="url"
                aria-label="Địa chỉ liên kết"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
              <button
                type="button"
                className="office-secondary"
                disabled={!safeWorkHref(url)}
                onClick={() => {
                  command("createLink", url);
                  setTool(null);
                  setUrl("");
                }}
              >
                Chèn liên kết
              </button>
            </>
          )}
          {tool === "table" && (
            <>
              <label>
                Số hàng
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={rows}
                  onChange={(e) => setRows(Number(e.target.value))}
                />
              </label>
              <label>
                Số cột
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={cols}
                  onChange={(e) => setCols(Number(e.target.value))}
                />
              </label>
              <button
                type="button"
                className="office-secondary"
                disabled={rows < 1 || rows > 50 || cols < 1 || cols > 12}
                onClick={() => {
                  insert({
                    version: 1,
                    type: "doc",
                    content: [
                      {
                        type: "table",
                        content: Array.from({ length: rows }, () => ({
                          type: "table_row",
                          content: Array.from({ length: cols }, () => ({
                            type: "table_cell",
                            content: [],
                          })),
                        })),
                      },
                      { type: "paragraph", content: [] },
                    ],
                  });
                  setTool(null);
                }}
              >
                Chèn bảng
              </button>
            </>
          )}
          {tool === "image" && (
            <>
              <p>
                Ảnh được lưu cùng tệp đính kèm và giữ quyền xem của văn bản.
              </p>
              {images.map((i) => (
                <button
                  type="button"
                  className="office-secondary"
                  key={i.id}
                  onClick={() => insertImage(i)}
                >
                  {i.file_name}
                </button>
              ))}
              {onImageUpload && (
                <label className="office-secondary">
                  {imageBusy ? "Đang tải ảnh…" : "Tải ảnh từ thiết bị"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    disabled={imageBusy || disabled}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setImageBusy(true);
                      setError(null);
                      try {
                        setPendingImage(await onImageUpload(f));
                      } catch (err) {
                        setError(err);
                      } finally {
                        setImageBusy(false);
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
              )}
            </>
          )}
          <button
            type="button"
            className="office-text-button"
            onClick={() => setTool(null)}
          >
            Đóng
          </button>
        </div>
      )}
      {error && <OfficeError error={error} />}
      <div
        ref={editor}
        className="work-rich-canvas office-rich-canvas"
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        contentEditable={!disabled && !imageBusy}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={change}
        onKeyUp={remember}
        onMouseUp={remember}
        onTouchEnd={remember}
        onBlur={remember}
        onPaste={(e) => {
          e.preventDefault();
          const html = e.clipboardData.getData("text/html");
          if (html) {
            const parsed = new DOMParser().parseFromString(html, "text/html");
            parsed
              .querySelectorAll("[data-office-image]")
              .forEach((n) => n.removeAttribute("data-office-image"));
            insert(officeDocumentFromEditor(parsed.body));
          } else command("insertText", e.clipboardData.getData("text/plain"));
        }}
      />
      <p className="office-editor-footnote">
        {new Intl.NumberFormat("vi-VN").format(officePlainText(value).length)}{" "}
        ký tự · Tối đa 100.000 ký tự nội dung
      </p>
    </div>
  );
}
function marked(text: string, marks: OfficeMark[] = []): React.ReactNode {
  return marks.reduce<React.ReactNode>((child, m, i) => {
    const tags = {
      bold: "strong",
      italic: "em",
      underline: "u",
      strike: "s",
      code: "code",
      superscript: "sup",
      subscript: "sub",
    };
    if (m.type in tags)
      return React.createElement(
        tags[m.type as keyof typeof tags],
        { key: i },
        child,
      );
    if (m.type === "link") {
      const href = safeWorkHref(m.attrs.href);
      return href ? (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer">
          {child}
        </a>
      ) : (
        child
      );
    }
    const style: React.CSSProperties = {};
    if (m.type === "color" && color(m.attrs.value)) style.color = m.attrs.value;
    if (m.type === "highlight" && color(m.attrs.value))
      style.backgroundColor = m.attrs.value;
    if (m.type === "fontSize" && SIZES.includes(m.attrs.value))
      style.fontSize = `${m.attrs.value}px`;
    if (m.type === "fontFamily" && FONTS.includes(m.attrs.value))
      style.fontFamily = m.attrs.value;
    return (
      <span key={i} style={style}>
        {child}
      </span>
    );
  }, text);
}
const renderInline = (nodes: OfficeInline[]) =>
  nodes.map((n, i) => (
    <React.Fragment key={i}>
      {n.type === "mention" ? `@${n.label}` : marked(n.text, n.marks)}
    </React.Fragment>
  ));
function EmbeddedImage({
  file,
  service,
  alt,
}: {
  file: OfficeAttachment;
  service: OfficeService;
  alt: string;
}) {
  const image = useOfficeQuery(() => service.fileUrl(file), [service, file.id]);
  const [failed, setFailed] = useState(false);
  return image.error || failed ? (
    <OfficeError
      error={
        image.error || { message: "Không tải được ảnh đính kèm. Hãy thử lại." }
      }
      retry={() => {
        setFailed(false);
        image.refresh();
      }}
    />
  ) : image.data ? (
    <figure>
      <img
        src={image.data}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
      />
      <figcaption>{alt}</figcaption>
    </figure>
  ) : (
    <p>Đang tải ảnh…</p>
  );
}
export function OfficeRichTextView({
  document: value,
  attachments = [],
  service,
}: {
  document: OfficeTextDocument;
  attachments?: OfficeAttachment[];
  service?: OfficeService;
}) {
  return (
    <div className="work-rich-view office-rich-view">
      {value.content.map((b, i) => {
        if (b.type === "image") {
          const file = attachments.find(
            (f) => f.id === b.attachmentId && f.status === "READY",
          );
          return file && service ? (
            <EmbeddedImage key={i} file={file} service={service} alt={b.alt} />
          ) : (
            <p key={i}>Ảnh đính kèm: {b.alt}</p>
          );
        }
        if (b.type === "table")
          return (
            <div
              key={i}
              className="office-rich-table"
              role="region"
              aria-label="Bảng trong văn bản"
              tabIndex={0}
            >
              <table>
                <tbody>
                  {b.content.map((r, j) => (
                    <tr key={j}>
                      {r.content.map((c, k) => (
                        <td key={k}>{renderInline(c.content)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        if (b.type === "bullet_list" || b.type === "ordered_list")
          return React.createElement(
            b.type === "bullet_list" ? "ul" : "ol",
            { key: i },
            b.content.map((c, j) => <li key={j}>{renderInline(c.content)}</li>),
          );
        return React.createElement(
          b.type === "heading"
            ? `h${Math.min(6, (b.level || 1) + 2)}`
            : b.type === "blockquote"
              ? "blockquote"
              : b.type === "code_block"
                ? "pre"
                : "p",
          { key: i, style: { textAlign: "align" in b ? b.align : undefined } },
          renderInline(b.content as OfficeInline[]),
        );
      })}
    </div>
  );
}
