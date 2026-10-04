import type {
  PermissionApplicationDefinition,
  PermissionScopeType,
} from "../permissions/permissionTypes";
export const OFFICE_ROUTES = [
  "/office",
  "/office/documents",
  "/office/new",
  "/office/documents/:id",
  "/office/documents/:id/edit",
  "/office/settings",
] as const;
const scopes: readonly PermissionScopeType[] = [
  "global",
  "own",
  "assigned",
  "department",
  "project",
  "construction_site",
];
export const OFFICE_PERMISSION_APPLICATION: PermissionApplicationDefinition = {
  code: "office",
  label: "Vioo Office",
  description: "Quản trị vòng đời văn bản chính thức",
  sortOrder: 66,
  modules: [
    {
      code: "office.module",
      label: "Vioo Office",
      routes: OFFICE_ROUTES,
      sortOrder: 10,
      actions: [
        {
          action: "access",
          label: "Truy cập Vioo Office",
          permissionCode: "office.module.access",
          scopeTypes: ["global"],
          sortOrder: 1,
        },
      ],
    },
    {
      code: "office.document",
      label: "Văn bản",
      routes: [],
      sortOrder: 20,
      actions: (
        [
          ["view", "Xem văn bản", scopes],
          [
            "view_restricted",
            "Xem văn bản hạn chế theo phạm vi",
            ["global", "department", "project", "construction_site"],
          ],
          [
            "create",
            "Soạn / tiếp nhận văn bản",
            ["global", "own", "department", "project", "construction_site"],
          ],
          [
            "edit",
            "Sửa bản nháp",
            ["global", "own", "department", "project", "construction_site"],
          ],
          [
            "submit",
            "Trình duyệt / đăng ký tiếp nhận",
            ["global", "own", "department", "project", "construction_site"],
          ],
          [
            "approve",
            "Duyệt nội dung",
            [
              "global",
              "assigned",
              "department",
              "project",
              "construction_site",
            ],
          ],
          [
            "issue_number",
            "Cấp số văn bản",
            ["global", "department", "project", "construction_site"],
          ],
          [
            "publish",
            "Phát hành / phân phối",
            ["global", "department", "project", "construction_site"],
          ],
          [
            "assign",
            "Giao xử lý văn bản đến",
            ["global", "own", "department", "project", "construction_site"],
          ],
          [
            "process",
            "Xử lý văn bản được giao",
            [
              "global",
              "assigned",
              "department",
              "project",
              "construction_site",
            ],
          ],
          [
            "revoke",
            "Thu hồi văn bản",
            ["global", "department", "project", "construction_site"],
          ],
          [
            "archive",
            "Lưu trữ văn bản",
            ["global", "own", "department", "project", "construction_site"],
          ],
        ] as [string, string, readonly PermissionScopeType[]][]
      ).map(([action, label, scopeTypes], i) => ({
        action,
        label,
        scopeTypes,
        permissionCode: `office.document.${action}`,
        sortOrder: (i + 1) * 10,
      })),
    },
    {
      code: "office.configuration",
      label: "Cấu hình Office",
      routes: [],
      sortOrder: 30,
      actions: [
        {
          action: "manage",
          label: "Quản lý loại, tuyến duyệt, cấp số, kho",
          permissionCode: "office.configuration.manage",
          scopeTypes: ["global"],
          sortOrder: 120,
        },
      ],
    },
  ],
};
