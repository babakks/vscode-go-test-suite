import assert = require("assert");

export interface Parsed {
    packageInfo: PackageInfo;
    imports: Import[];
    testFunctions: TestFunction[];
}

export interface PackageInfo {
    name: string;
    lineNumber: number;
}

export interface Import {
    moduleName: string;
    alias?: string;
    lineNumber: number;
}

export type SupportedTestFunctionKinds = 'gocheck' | 'quicktest';

export interface TestFunction {
    kind: SupportedTestFunctionKinds | undefined;
    receiverType?: string;
    functionName: string;
    argType?: {
        moduleName: string;
        typeName: string;
    }
    range: [startLine: number, startChar: number, endLine: number, endChar: number],
    lineNumber: number;
}

const _PACKAGE_STATEMENT_REGEXP = /^package (.+)\r?$/;
const _IMPORT_SINGLE_LINE_REGEXP = /^import (?:(.*?) )?"(.*?)"\r?$/;
const _IMPORT_MULTI_LINE_START_REGEXP = /^import \(\r?$/;
const _IMPORT_MULTI_LINE_END_REGEXP = /^\)\r?$/;
const _IMPORT_MULTI_LINE_ENTRY_REGEXP = /^\s*(?:(.*?) )?"(.*?)"\r?$/;
const _SUITE_TEST_FUNCTION_REGEXP = /^func \(.*? \*?(.*?)\) (Test.*?)\(.*? \*?(?:(.*?)\.)?(.*?)\) \{/;

const _GOCHECK_MODULE_NAME = 'gopkg.in/check.v1';
const _GOCHECK_PACKAGE_NAME = 'check';
const _QUICKTEST_MODULE_NAME = 'github.com/frankban/quicktest';
const _QUICKTEST_PACKAGE_NAME = 'quicktest';

/**
 * Partially parses Go files and extracts package/import/test data.
 */
export class GoParser {
    constructor(public readonly content: string = '') { }

    /**
     * @returns `undefined` on failure.
     */
    parse(lines?: string[]): Parsed | undefined {
        const ls = lines || this._getLines();
        const packageInfo = this.parsePackageName(ls);
        if (!packageInfo) {
            return;
        }
        const imports = this.parseImports(ls, 1 + packageInfo.lineNumber);
        const testFunctions = this.parseTestFunctions(imports, ls, 1 + packageInfo.lineNumber);
        return { packageInfo, imports, testFunctions };
    }

    private _getLines(): string[] {
        return this.content.split('\n'); // No need to include `\r` (See RegExp pattern definition at the top.)
    }

    public parsePackageName(lines?: string[]): PackageInfo | undefined {
        const ls = lines || this._getLines();
        for (let n = 0; n < ls.length; n++) {
            const line = ls[n];
            const match = _PACKAGE_STATEMENT_REGEXP.exec(line);
            if (match) {
                return { name: match[1], lineNumber: n };
            }
        }
    }

    public parseImports(lines?: string[], start: number = 0): Import[] {
        const ls = lines || this._getLines();
        const result: Import[] = [];
        const q = {
            _n: start,
            lineNumber: function (offset: number = 0) { return offset + this._n; },
            consume: function (n: number = 0) { this._n += 1 + n; },
            peek: function (offset: number = 0) { return ls[offset + this._n]; },
            empty: function () { return this.peek() === undefined; }
        };

        while (!q.empty()) {
            if (acceptSingleLineImport() || acceptMultiLineImport()) {
                continue;
            }
            q.consume();
        }
        return result;

        function acceptSingleLineImport(): boolean {
            const match = _IMPORT_SINGLE_LINE_REGEXP.exec(q.peek());
            if (!match) {
                return false;
            }
            const entry: Import = { moduleName: match[2], lineNumber: q.lineNumber() };
            if (match[1]) {
                entry.alias = match[1];
            }
            result.push(entry);
            q.consume();
            return true;
        }

        function acceptMultiLineImport(): boolean {
            if (!_IMPORT_MULTI_LINE_START_REGEXP.exec(q.peek())) {
                return false;
            }
            let n = 1;
            const imports = [];
            for (; q.peek(n) !== undefined; n++) {
                if (_IMPORT_MULTI_LINE_END_REGEXP.exec(q.peek(n))) {
                    result.push(...imports);
                    q.consume(n);
                    return true;
                }
                const match = _IMPORT_MULTI_LINE_ENTRY_REGEXP.exec(q.peek(n));
                if (match) {
                    const entry: Import = { moduleName: match[2], lineNumber: q.lineNumber(n) };
                    if (match[1]) {
                        entry.alias = match[1];
                    }
                    imports.push(entry);
                }
            }
            return false;
        }
    }

    public parseTestFunctions(imports: Import[], lines?: string[], start: number = 0): TestFunction[] {
        const ls = lines || this._getLines();
        const result: TestFunction[] = [];
        for (let n = start; n < ls.length; n++) {
            const line = ls[n];
            const match = _SUITE_TEST_FUNCTION_REGEXP.exec(line);
            if (match) {
                const argTypeModule = match[3];
                if (!argTypeModule) {
                    continue;
                }

                const importsWithSameAlias = imports.filter(x => x.alias && x.alias === argTypeModule);
                if (importsWithSameAlias.length > 1) {
                    // This shouldn't happen with a valid .go file.
                    return [];
                }

                let argType: TestFunction['argType'];
                if (!importsWithSameAlias.length) {
                    switch (argTypeModule) {
                        case _GOCHECK_PACKAGE_NAME:
                            if (!imports.some(x => x.moduleName === _GOCHECK_MODULE_NAME)) {
                                continue;
                            }
                            argType = { moduleName: _GOCHECK_MODULE_NAME, typeName: match[4] };
                            break;
                        case _QUICKTEST_PACKAGE_NAME:
                            if (!imports.some(x => x.moduleName === _QUICKTEST_MODULE_NAME)) {
                                continue;
                            }
                            argType = { moduleName: _QUICKTEST_MODULE_NAME, typeName: match[4] };
                            break;
                        default:
                            // Unknown module.
                            continue;
                    }
                } else {
                    argType = { moduleName: importsWithSameAlias[0]!.moduleName, typeName: match[4] };
                }
                result.push({
                    kind: argType.moduleName === _GOCHECK_MODULE_NAME ? 'gocheck' :
                        argType.moduleName === _QUICKTEST_MODULE_NAME ? 'quicktest' :
                            undefined,
                    receiverType: match[1],
                    functionName: match[2],
                    argType,
                    lineNumber: n,
                    range: [n, match.index, n, match.index + match[0].length]
                });
            }
        }
        return result;
    }
}

export interface ParsedTestSuiteFunction {
    index: number;
    entireMatch: string;

    /**
     * For example, "SomeSuite" in "func (s *SomeSuite) TestSomething(c *gocheck.C)"
     */
    receiverType: string;

    /**
     * For example, "TestSomething" in "func (s *SomeSuite) TestSomething(c *gocheck.C)"
     */
    functionName: string;

    /**
     * For example, "gocheck" in "func (s *SomeSuite) TestSomething(c *gocheck.C)"
     */
    argTypeModule: string;

    /**
     * For example, "C" in "func (s *SomeSuite) TestSomething(c *gocheck.C)"
     */
    argTypeName: string;
}

export function parseSuiteTestFunction(line: string): ParsedTestSuiteFunction | undefined {
    const match = _SUITE_TEST_FUNCTION_REGEXP.exec(line);
    if (!match) {
        return undefined;
    }
    return {
        index: match.index,
        entireMatch: match[0],
        receiverType: match[1],
        functionName: match[2],
        argTypeModule: match[3],
        argTypeName: match[4],
    };
}
