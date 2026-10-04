/** Office rich text stores an allowlisted tree, never executable HTML. */
export type OfficeMark =
  | {
      type:
        | "bold"
        | "italic"
        | "underline"
        | "strike"
        | "code"
        | "superscript"
        | "subscript";
    }
  | { type: "link"; attrs: { href: string } }
  | {
      type: "color" | "highlight" | "fontSize" | "fontFamily";
      attrs: { value: string };
    };
export type OfficeInline =
  | { type: "text"; text: string; marks?: OfficeMark[] }
  | { type: "mention"; userId: string; label: string };
export type OfficeAlignment = "left" | "center" | "right" | "justify";
export type OfficeBlock =
  | {
      type: "paragraph" | "heading" | "blockquote" | "code_block";
      level?: 1 | 2 | 3;
      align?: OfficeAlignment;
      content: OfficeInline[];
    }
  | {
      type: "bullet_list" | "ordered_list";
      content: { type: "list_item"; content: OfficeInline[] }[];
    }
  | {
      type: "table";
      content: {
        type: "table_row";
        content: { type: "table_cell"; content: OfficeInline[] }[];
      }[];
    }
  | { type: "image"; attachmentId: string; alt: string };
export interface OfficeTextDocument {
  version: 1;
  type: "doc";
  content: OfficeBlock[];
}
export const EMPTY_OFFICE_CONTENT: OfficeTextDocument = {
  version: 1,
  type: "doc",
  content: [],
};
export function officePlainText(value: OfficeTextDocument): string {
  const walk = (n: unknown): string => {
    if (!n || typeof n !== "object") return "";
    const node = n as Record<string, unknown>;
    if (node.type === "text") return String(node.text || "");
    if (node.type === "mention") return `@${node.label || ""}`;
    if (node.type === "image") return String(node.alt || "");
    return Array.isArray(node.content)
      ? node.content
          .map(walk)
          .join(
            ["doc", "table", "table_row"].includes(String(node.type))
              ? "\n"
              : "",
          )
      : "";
  };
  return walk(value);
}
