import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(entryPath);
      }

      return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : [];
    }),
  );

  return nested.flat();
}

function moduleSpecifiers(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  const addLiteral = (node: ts.Expression, kind: string) => {
    if (!ts.isStringLiteralLike(node)) {
      throw new Error(`${file}: ${kind} 必须使用静态字符串模块路径。`);
    }
    specifiers.push(node.text);
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined) {
        addLiteral(node.moduleSpecifier, "import/export");
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined
    ) {
      addLiteral(node.moduleReference.expression, "import equals");
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      if (node.arguments.length !== 1 || node.arguments[0] === undefined) {
        throw new Error(`${file}: dynamic import/require 必须只有一个静态路径。`);
      }
      addLiteral(node.arguments[0], "dynamic import/require");
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

function assertImportsStayInsideFrontend(
  frontendRoot: string,
  file: string,
  source: string,
): void {
  for (const specifier of moduleSpecifiers(file, source)) {
    if (path.isAbsolute(specifier)) {
      throw new Error(`${file}: 禁止绝对模块路径 ${specifier}`);
    }
    if (!specifier.startsWith(".")) {
      continue;
    }

    const resolved = path.resolve(path.dirname(file), specifier);
    const relative = path.relative(frontendRoot, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`${file}: 模块路径越过前端边界 ${specifier}`);
    }
  }
}

describe("frontend import boundary", () => {
  it("does not import anything outside the frontend or reach forbidden backend data", async () => {
    const frontendRoot = process.cwd();
    const roots = ["app", "features", "lib"].map((directory) =>
      path.join(frontendRoot, directory),
    );
    const files = (await Promise.all(roots.map(sourceFiles))).flat();
    const sources = await Promise.all(
      files.map(async (file) => ({ file, source: await readFile(file, "utf8") })),
    );
    const source = sources.map(({ source: fileSource }) => fileSource).join("\n");

    for (const { file, source: fileSource } of sources) {
      expect(() =>
        assertImportsStayInsideFrontend(frontendRoot, file, fileSource),
      ).not.toThrow();
    }

    expect(source).not.toMatch(/notification-analysis-core-candidate/i);
    expect(source).not.toMatch(/preset-action-cards/i);
    expect(source).not.toMatch(/\.runtime\//i);
    expect(source).not.toMatch(/src\/v2/i);
  });

  it("rejects literal and computed dynamic imports that can escape the frontend", () => {
    const frontendRoot = process.cwd();
    const virtualFile = path.join(frontendRoot, "features", "probe.ts");

    expect(() =>
      assertImportsStayInsideFrontend(
        frontendRoot,
        virtualFile,
        "import(`../../src/v2/server.js`);",
      ),
    ).toThrow(/越过前端边界/);
    expect(() =>
      assertImportsStayInsideFrontend(
        frontendRoot,
        virtualFile,
        "require('../../src/server.js');",
      ),
    ).toThrow(/越过前端边界/);
    expect(() =>
      assertImportsStayInsideFrontend(
        frontendRoot,
        virtualFile,
        "const target = 'x'; import(`../${target}`);",
      ),
    ).toThrow(/静态字符串模块路径/);
  });
});
