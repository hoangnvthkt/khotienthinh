/**
 * The four legacy module columns retired by Task 13. They are no longer part of `User`;
 * tests attach them to prove that an old row carrying them never grants access.
 */
export interface RetiredUserFields {
  allowedModules?: string[];
  adminModules?: string[];
  allowedSubModules?: Record<string, string[]>;
  adminSubModules?: Record<string, string[]>;
}
