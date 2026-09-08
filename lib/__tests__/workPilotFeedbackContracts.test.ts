import { describe, expect, it } from "vitest";
import {
  documentText,
  mentionedUserIds,
  validateWorkSchedule,
  workDocument,
} from "../work/workForm";

describe("Work pilot feedback contracts", () => {
  it("keeps planned schedule distinct from actual execution", () => {
    expect(
      validateWorkSchedule(
        "2026-09-08T08:00:00Z",
        "2026-09-10T10:00:00Z",
      ),
    ).toEqual({
      plannedStartAt: "2026-09-08T08:00:00.000Z",
      deadlineAt: "2026-09-10T10:00:00.000Z",
    });
    expect(() =>
      validateWorkSchedule(
        "2026-09-11T08:00:00Z",
        "2026-09-10T10:00:00Z",
      ),
    ).toThrow("WORK_INVALID_SCHEDULE");
  });

  it("supports open-ended schedules without inventing dates", () => {
    expect(validateWorkSchedule(null, undefined)).toEqual({
      plannedStartAt: null,
      deadlineAt: null,
    });
    expect(() => validateWorkSchedule("not-a-date", null)).toThrow(
      "WORK_INVALID_SCHEDULE",
    );
  });

  it("extracts stable mention ids from inline nodes", () => {
    const document = workDocument("Nhờ ");
    document.content[0].content.push({
      type: "mention",
      userId: "user-1",
      label: "Phạm Ngọc Sơn",
    });
    document.content[0].content.push({
      type: "mention",
      userId: "user-1",
      label: "Tên mới không tạo ID mới",
    });
    expect(documentText(document)).toBe(
      "Nhờ @Phạm Ngọc Sơn@Tên mới không tạo ID mới",
    );
    expect(mentionedUserIds(document)).toEqual(["user-1"]);
  });
});
