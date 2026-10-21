import { describe, expect, it } from "vitest";
import { customPeriod, periodLabel, periodQuery, periodShort, presetPeriod, prevPeriod, prevShort, restorePeriod, storePeriod } from "../work/workPeriod";

const today = "2026-10-21"; // thứ 4, tuần 43

describe("Vioo Work Đợt 2 · kỳ xem số", () => {
  it("kỳ có sẵn theo hôm nay", () => {
    expect(presetPeriod("week", today)).toEqual({ preset: "week", from: "2026-10-19", to: "2026-10-25" });
    expect(presetPeriod("last_week", today)).toEqual({ preset: "last_week", from: "2026-10-12", to: "2026-10-18" });
    expect(presetPeriod("2weeks", today)).toEqual({ preset: "2weeks", from: "2026-10-08", to: "2026-10-21" });
    expect(presetPeriod("month", today)).toEqual({ preset: "month", from: "2026-10-01", to: "2026-10-31" });
    expect(presetPeriod("quarter", today)).toEqual({ preset: "quarter", from: "2026-10-01", to: "2026-12-31" });
    expect(presetPeriod("month", "2028-02-10").to).toBe("2028-02-29");
    expect(presetPeriod("week", "2026-10-25").from).toBe("2026-10-19"); // chủ nhật vẫn thuộc tuần bắt đầu thứ 2
  });

  it("kỳ trước: tuần / tháng / quý theo lịch, còn lại cùng số ngày liền trước", () => {
    expect(prevPeriod(presetPeriod("week", today))).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(prevPeriod(presetPeriod("month", "2026-03-15"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(prevPeriod(presetPeriod("quarter", "2026-01-05"))).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(prevPeriod(presetPeriod("2weeks", today))).toEqual({ from: "2026-09-24", to: "2026-10-07" });
    expect(prevPeriod({ preset: "custom", from: "2026-10-10", to: "2026-10-12" })).toEqual({ from: "2026-10-07", to: "2026-10-09" });
  });

  it("gửi máy chủ: kỳ đang chạy chỉ tính đến hôm nay", () => {
    expect(periodQuery(presetPeriod("month", today), today)).toEqual({ from: "2026-10-01", to: "2026-10-21", prevFrom: "2026-09-01", prevTo: "2026-09-30" });
    expect(periodQuery(presetPeriod("last_week", today), today)).toEqual({ from: "2026-10-12", to: "2026-10-18", prevFrom: "2026-10-05", prevTo: "2026-10-11" });
  });

  it("tùy chọn: sắp lại, cắt đến hôm nay, tối đa 400 ngày, ngày tương lai bị từ chối", () => {
    expect(customPeriod("2026-10-15", "2026-10-01", today)).toEqual({ preset: "custom", from: "2026-10-01", to: "2026-10-15" });
    expect(customPeriod("2026-10-15", "2026-11-30", today)?.to).toBe(today);
    expect(customPeriod("2026-10-22", "2026-10-30", today)).toBeNull();
    expect(customPeriod("2024-01-01", today, today)?.from).toBe("2025-09-16");
    expect(customPeriod("", today, today)).toBeNull();
  });

  it("nhãn ngắn gọn", () => {
    expect(periodLabel(presetPeriod("last_week", today))).toBe("Tuần 42 · 12–18/10");
    expect(periodLabel(presetPeriod("month", today))).toBe("Tháng 10/2026");
    expect(periodLabel(presetPeriod("quarter", today))).toBe("Quý 4/2026");
    expect(periodLabel({ preset: "custom", from: "2026-10-06", to: "2026-10-21" })).toBe("06/10 – 21/10");
    expect(periodLabel({ preset: "custom", from: "2025-12-20", to: "2026-01-05" })).toBe("20/12 – 05/01/2026");
    expect(periodShort(presetPeriod("month", today))).toBe("tháng 10");
    expect(prevShort(presetPeriod("last_week", today))).toBe("tuần 41");
    expect(prevShort(presetPeriod("quarter", today))).toBe("quý 3");
    expect(prevShort(presetPeriod("2weeks", today))).toBe("kỳ trước");
  });

  it("nhớ kỳ: kỳ có sẵn tính lại theo hôm nay, dữ liệu hỏng thì về Tuần trước", () => {
    expect(restorePeriod(storePeriod(presetPeriod("month", "2026-09-03")), today)).toEqual(presetPeriod("month", today));
    expect(restorePeriod(storePeriod({ preset: "custom", from: "2026-10-01", to: "2026-10-10" }), today)).toEqual({ preset: "custom", from: "2026-10-01", to: "2026-10-10" });
    expect(restorePeriod("{hỏng", today)).toEqual(presetPeriod("last_week", today));
    expect(restorePeriod(JSON.stringify({ preset: "year" }), today)).toEqual(presetPeriod("last_week", today));
  });
});

describe("Vioo Work PR-7 · kỳ theo hình dạng + link bản tin", () => {
  it("tùy chọn trọn tháng / tuần / quý được gọi tên và so đúng kỳ trước", async () => {
    const { periodShape, periodFromRange } = await import("../work/workPeriod");
    const sep = { preset: "custom" as const, from: "2026-09-01", to: "2026-09-30" };
    expect(periodShape(sep)).toBe("month");
    expect(periodLabel(sep)).toBe("Tháng 9/2026");
    expect(prevPeriod(sep)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(prevShort(sep)).toBe("tháng 8");
    expect(periodShape({ from: "2026-10-12", to: "2026-10-18" })).toBe("week");
    expect(periodShape({ from: "2026-07-01", to: "2026-09-30" })).toBe("quarter");
    expect(periodShape(presetPeriod("2weeks", today))).toBeNull();
    expect(periodFromRange("2026-10-12", "2026-10-18", today)).toEqual(presetPeriod("last_week", today));
    expect(periodFromRange("2026-09-01", "2026-09-30", today)).toEqual(sep);
    expect(periodFromRange("2026-10-30", "2026-11-05", today)).toBeNull();
    expect(periodFromRange(null, "2026-10-01", today)).toBeNull();
  });
});
