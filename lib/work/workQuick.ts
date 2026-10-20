/** Giao nhanh (Vioo Work Đợt 1): hạn gợi ý, đầu vào lệnh tạo việc, danh sách người làm — dùng chung cho Giao nhanh và Giao từ biên bản. */
import type { WorkAssignablePeople, WorkAssignablePerson, WorkLevel } from "./workBoardService";
import { priorityOfLevel } from "./workBoardService";
import { workDocument } from "./workForm";
import type { CreateWorkTaskInput } from "./workTypes";

const pad = (n: number) => String(n).padStart(2, "0");
const at17 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17, 0, 0);

/** Ngày (YYYY-MM-DD) + giờ (HH:MM) theo giờ máy → Date; sai thì null. */
export const dateAt = (date: string, time = "17:00") => {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = (/^\d{2}:\d{2}$/.test(time) ? time : "17:00").split(":").map(Number);
  const out = new Date(y, (m || 1) - 1, d || 1, h, min, 0);
  return date && !Number.isNaN(out.getTime()) ? out : null;
};

/** Hạn gợi ý: hôm nay / mai / thứ 7 tuần này (chốt tuần), đều 17:00; hết giờ thì bỏ "hôm nay". */
export function quickDuePresets(now: Date = new Date()) {
  const today = at17(now);
  const tomorrow = at17(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const toSaturday = (6 - now.getDay() + 7) % 7;
  const saturday = at17(new Date(now.getFullYear(), now.getMonth(), now.getDate() + toSaturday));
  const presets = [
    { id: "today", label: "Hôm nay", at: today },
    { id: "tomorrow", label: "Mai", at: tomorrow },
    { id: "saturday", label: `Thứ 7 ${pad(saturday.getDate())}/${pad(saturday.getMonth() + 1)}`, at: saturday },
  ];
  return presets.filter((p, i, all) => p.at.getTime() > now.getTime() && all.findIndex((q) => q.at.getTime() === p.at.getTime()) === i);
}

/** Dựng đầu vào tạo việc (phạm vi trực tiếp). Bằng chứng khi nộp ghi vào cuối yêu cầu để người làm thấy. */
export function quickTaskInput(form: {
  title: string; assigneeId: string; deadline: Date; level: WorkLevel; description: string; checklist: string; tags: string;
  evidence: { photo: boolean; file: boolean };
}): CreateWorkTaskInput {
  const evidence = [form.evidence.photo && "ảnh", form.evidence.file && "tệp"].filter(Boolean).join(" + ");
  const description = [form.description.trim(), evidence ? `Bằng chứng khi nộp: ${evidence}.` : ""].filter(Boolean).join("\n");
  return {
    title: form.title.trim(),
    description: workDocument(description),
    scope: { type: "direct" },
    recipientSources: [{ type: "user", id: form.assigneeId }],
    watcherUserIds: [],
    priority: priorityOfLevel(form.level),
    privacy: "standard",
    labels: [...new Set(form.tags.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 20),
    checklist: form.checklist.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 50).map((title) => ({ title })),
    deadlineAt: form.deadline.toISOString(),
  };
}

/** Người có thể chọn ở ô Người làm: giao cho người khác cần quyền giao; mình lên đầu, rồi người trong đơn vị mình làm trưởng. */
export const quickChoices = (people: WorkAssignablePeople | null) => {
  if (!people) return [];
  const list = people.canAssignOthers ? people.people.filter((p) => p.canReceive || p.isMe) : people.people.filter((p) => p.isMe);
  return [...list].sort((a, b) => Number(b.isMe) - Number(a.isMe) || Number(b.myTeam) - Number(a.myTeam) || a.name.localeCompare(b.name, "vi"));
};
export const personOption = (p: WorkAssignablePerson, actorName: string) =>
  p.isMe ? `Tôi (${actorName})` : `${p.name}${p.unit?.code ? ` · ${p.unit.code}` : ""}`;
