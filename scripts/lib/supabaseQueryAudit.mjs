import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx)$/;
const IGNORED_PATH = /(?:^|\/)(?:node_modules|dist|coverage|\.git|\.worktrees|__tests__|fixtures)(?:\/|$)|\.(?:test|spec)\.[^.]+$/;
const RESULT_POLICY_METHODS = new Set(['limit', 'range', 'single', 'maybeSingle']);
const CURSOR_METHODS = new Set(['or', 'lt', 'lte', 'gt', 'gte', 'range']);
const MUTATION_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);

const propertyName = expression => {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
    return expression.argumentExpression.text;
  }
  return null;
};

const callMethodName = node => ts.isCallExpression(node) ? propertyName(node.expression) : null;

const walk = (node, visit) => {
  visit(node);
  ts.forEachChild(node, child => walk(child, visit));
};

const findChainRoot = node => {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      current = parent;
      continue;
    }
    if (ts.isElementAccessExpression(parent) && parent.expression === current) {
      current = parent;
      continue;
    }
    if (ts.isCallExpression(parent) && parent.expression === current) {
      current = parent;
      continue;
    }
    if (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) {
      current = parent;
      continue;
    }
    break;
  }
  return current;
};

const getMethods = node => {
  const methods = new Set();
  walk(node, candidate => {
    const method = callMethodName(candidate);
    if (method) methods.add(method);
  });
  return methods;
};

const getVariableDeclaration = node => {
  let current = node;
  while (current.parent && !ts.isSourceFile(current.parent)) {
    if (ts.isVariableDeclaration(current.parent) && current.parent.initializer === current) {
      return current.parent;
    }
    current = current.parent;
  }
  return null;
};

const getContainingScope = node => {
  let current = node;
  while (current.parent) {
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return current;
    current = current.parent;
  }
  return node.getSourceFile();
};

const expressionStartsWithIdentifier = (expression, identifier) => {
  let current = expression;
  while (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = ts.isCallExpression(current) ? current.expression : current.expression;
  }
  return ts.isIdentifier(current) && current.text === identifier;
};

const getAssignedQueryMethods = root => {
  const declaration = getVariableDeclaration(root);
  if (!declaration || !ts.isIdentifier(declaration.name)) return new Set();
  const variableName = declaration.name.text;
  const scope = getContainingScope(declaration);
  const methods = new Set();

  walk(scope, candidate => {
    if (!ts.isCallExpression(candidate)) return;
    const method = callMethodName(candidate);
    if (!method || !expressionStartsWithIdentifier(candidate.expression, variableName)) return;
    methods.add(method);
  });
  return methods;
};

const getFunctionName = node => {
  let current = node;
  while (current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) {
      return current.name.getText();
    }
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current))
      && ts.isVariableDeclaration(current.parent)
      && ts.isIdentifier(current.parent.name)) {
      return current.parent.name.text;
    }
    current = current.parent;
  }
  return '(module)';
};

const getTable = selectCall => {
  let table = '(dynamic)';
  walk(selectCall.expression, candidate => {
    if (!ts.isCallExpression(candidate) || callMethodName(candidate) !== 'from') return;
    const argument = candidate.arguments[0];
    if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
      table = argument.text;
    }
  });
  return table;
};

const getProjection = selectCall => {
  const argument = selectCall.arguments[0];
  if (!argument) return '*';
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text.trim();
  return '(dynamic)';
};

const hasHeadTrue = selectCall => {
  const options = selectCall.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  return options.properties.some(property => ts.isPropertyAssignment(property)
    && property.name.getText() === 'head'
    && property.initializer.kind === ts.SyntaxKind.TrueKeyword);
};

const lineOf = (sourceFile, node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

const fingerprint = input => createHash('sha256')
  .update(JSON.stringify(input))
  .digest('hex')
  .slice(0, 20);

const finding = ({ file, functionName, table, projection, methods, line, rule, severity, classification }) => ({
  fingerprint: fingerprint({ file, functionName, table, projection, methods: [...methods].sort(), rule }),
  file,
  line,
  table,
  projection,
  modifiers: [...methods].sort(),
  classification,
  owner: null,
  rule,
  severity,
});

export function analyzeSource(source, filePath) {
  const scriptKind = filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
    ? ts.ScriptKind.TSX
    : filePath.endsWith('.js') || filePath.endsWith('.mjs')
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const findings = [];

  walk(sourceFile, node => {
    if (!ts.isCallExpression(node) || callMethodName(node) !== 'select') return;
    const root = findChainRoot(node);
    const methods = getMethods(root);
    getAssignedQueryMethods(root).forEach(method => methods.add(method));
    const projection = getProjection(node);
    const table = getTable(node);
    const functionName = getFunctionName(node);
    const line = lineOf(sourceFile, node);
    const head = hasHeadTrue(node);
    const singleton = methods.has('single') || methods.has('maybeSingle');
    const mutationReturn = [...MUTATION_METHODS].some(method => methods.has(method));
    const bounded = head || [...RESULT_POLICY_METHODS].some(method => methods.has(method));
    const cursor = [...CURSOR_METHODS].some(method => methods.has(method));
    const classification = head
      ? 'count'
      : mutationReturn && singleton
        ? 'mutation_return'
        : singleton
          ? 'detail'
          : bounded && methods.has('order') && cursor
            ? 'page'
            : null;

    if (projection === '*' && !head && !singleton) {
      findings.push(finding({
        file: filePath,
        functionName,
        table,
        projection,
        methods,
        line,
        rule: 'wildcard-list',
        severity: 'error',
        classification,
      }));
    }

    if (!bounded) {
      findings.push(finding({
        file: filePath,
        functionName,
        table,
        projection,
        methods,
        line,
        rule: 'missing-result-policy',
        severity: 'error',
        classification,
      }));
    }
  });

  return findings;
}

const collectSourceFiles = rootDir => {
  const roots = ['components', 'context', 'hooks', 'lib', 'pages', 'services', 'supabase/functions'];
  const files = [];

  const visitDirectory = directory => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(rootDir, absolutePath).replaceAll('\\', '/');
      if (IGNORED_PATH.test(relativePath)) continue;
      if (entry.isDirectory()) visitDirectory(absolutePath);
      else if (SOURCE_EXTENSIONS.test(entry.name)) files.push(relativePath);
    }
  };

  roots.forEach(root => visitDirectory(resolve(rootDir, root)));
  return files.sort();
};

export function scanWorkspace(rootDir, policy = { allowlist: [] }) {
  const allowlist = new Map((policy.allowlist || []).map(entry => [entry.fingerprint, entry]));
  const findings = collectSourceFiles(rootDir).flatMap(file => {
    const rows = analyzeSource(readFileSync(resolve(rootDir, file), 'utf8'), file);
    return rows.map(row => {
      const allowed = allowlist.get(row.fingerprint);
      return allowed ? { ...row, classification: allowed.classification, owner: allowed.owner } : row;
    });
  }).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));

  return {
    version: 1,
    summary: {
      findings: findings.length,
      errors: findings.filter(row => row.severity === 'error').length,
      wildcardLists: findings.filter(row => row.rule === 'wildcard-list').length,
      missingResultPolicies: findings.filter(row => row.rule === 'missing-result-policy').length,
      unclassified: findings.filter(row => !row.classification).length,
    },
    findings,
  };
}

