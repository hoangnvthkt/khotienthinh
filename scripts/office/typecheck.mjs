// Check application code without unrelated reference prototypes or nested checkouts.
// The standard `npm run lint` remains unchanged and should also be reported.
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
config.exclude = [...(config.exclude || []), 'docs/references/**', '.claude/**'];
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n',
}));
console.log(`Application typecheck: ${diagnostics.length} diagnostic(s); docs/references and .claude checkouts excluded.`);
process.exitCode = diagnostics.length ? 1 : 0;
