import { suite, test } from 'mocha';
import * as assert from 'assert';

import { GoParser, Import, PackageInfo, TestFunction } from '../../goParser';

suite('GoParser', () => {
    suite('parsePackageName', function () {
        test('should use content property if no lines given as args', function () {
            assert.deepStrictEqual(
                new GoParser('package given-via-constructor-args').parsePackageName(),
                <PackageInfo>{ name: 'given-via-constructor-args', lineNumber: 0 }
            );
        });

        test('should accept content lines as argument', function () {
            assert.deepStrictEqual(
                new GoParser('package given-via-constructor-args').parsePackageName(['package given-via-args']),
                <PackageInfo>{ name: 'given-via-args', lineNumber: 0 }
            );
        });

        suite('should handle various args', function () {
            type Case = {
                name: string;
                content: string;
                expected: ReturnType<GoParser['parsePackageName']>;
            };
            const cases: Case[] = [
                {
                    name: 'should return `undefined` for empty content',
                    content: '',
                    expected: undefined
                },
                {
                    name: 'should return `undefined` if no package statement',
                    content: 'a:=0',
                    expected: undefined
                },
                {
                    name: 'should work with one package statement',
                    content: 'package p',
                    expected: { name: 'p', lineNumber: 0 }
                },
                {
                    name: 'should work with one package statement at second line',
                    content: '\npackage p',
                    expected: { name: 'p', lineNumber: 1 }
                },
                {
                    name: 'should pick the first package statement',
                    content: 'package p1\npackage p2',
                    expected: { name: 'p1', lineNumber: 0 }
                }
            ];

            for (const x of cases) {
                test(x.name, function () {
                    assert.deepStrictEqual(
                        new GoParser(x.content).parsePackageName(),
                        x.expected
                    );
                });
            }
        });
    });

    suite('parseImports', function () {
        test('should use content property if no lines given as args', function () {
            assert.deepStrictEqual(
                new GoParser('import "given-via-constructor-args"').parseImports(),
                <Import[]>[{ moduleName: 'given-via-constructor-args', lineNumber: 0 }]
            );
        });

        test('should accept content lines as argument', function () {
            assert.deepStrictEqual(
                new GoParser('import "given-via-constructor-args"').parseImports(['import "given-via-args"']),
                <Import[]>[{ moduleName: 'given-via-args', lineNumber: 0 }]
            );
        });

        suite('should handle various args', function () {
            type Case = {
                name: string;
                content: string;
                expected: ReturnType<GoParser['parseImports']>;
            };
            const cases: Case[] = [
                {
                    name: 'should return `[]` for empty content',
                    content: '',
                    expected: []
                },
                {
                    name: 'should return `[]` if no import statement',
                    content: 'a:=0',
                    expected: []
                },
                {
                    name: 'should work with single line import statement',
                    content: 'import "package"',
                    expected: [{ moduleName: 'package', lineNumber: 0 }]
                },
                {
                    name: 'should work with single line import statement with alias',
                    content: 'import alias "package"',
                    expected: [{ moduleName: 'package', lineNumber: 0, alias: 'alias' }]
                },
                {
                    name: 'should work with multiple single line import statements',
                    content: 'import alias1 "package1"\nimport alias2 "package2"',
                    expected: [
                        { moduleName: 'package1', lineNumber: 0, alias: 'alias1' },
                        { moduleName: 'package2', lineNumber: 1, alias: 'alias2' }
                    ]
                },
                {
                    name: 'should work with multiline import statement with single entry',
                    content: 'import (\n\t"package1"\n)',
                    expected: [{ moduleName: 'package1', lineNumber: 1 }]
                },
                {
                    name: 'should work with multiline import statement with multiple entry',
                    content: 'import (\n\t"package1"\n\t"package2"\n)',
                    expected: [
                        { moduleName: 'package1', lineNumber: 1 },
                        { moduleName: 'package2', lineNumber: 2 }
                    ]
                },
                {
                    name: 'should work with multiline import statement with multiple entry with alias',
                    content: 'import (\n\talias1 "package1"\n\talias2 "package2"\n)',
                    expected: [
                        { moduleName: 'package1', lineNumber: 1, alias: 'alias1' },
                        { moduleName: 'package2', lineNumber: 2, alias: 'alias2' }
                    ]
                },
                {
                    name: 'should work with multiple multiline import statements',
                    content: 'import (\n\talias1 "package1"\n\talias2 "package2"\n)\n\nimport (\n\talias3 "package3"\n\talias4 "package4"\n)',
                    expected: [
                        { moduleName: 'package1', lineNumber: 1, alias: 'alias1' },
                        { moduleName: 'package2', lineNumber: 2, alias: 'alias2' },
                        { moduleName: 'package3', lineNumber: 6, alias: 'alias3' },
                        { moduleName: 'package4', lineNumber: 7, alias: 'alias4' }
                    ]
                },
                {
                    name: 'should work with mixed import statements',
                    content: 'import "package1"\nimport alias2 "package2"\nimport (\n\talias3 "package3"\n\t"package4"\n)\nimport "package5"',
                    expected: [
                        { moduleName: 'package1', lineNumber: 0 },
                        { moduleName: 'package2', lineNumber: 1, alias: 'alias2' },
                        { moduleName: 'package3', lineNumber: 3, alias: 'alias3' },
                        { moduleName: 'package4', lineNumber: 4 },
                        { moduleName: 'package5', lineNumber: 6 }
                    ]
                }
            ];

            for (const x of cases) {
                test(x.name, function () {
                    assert.deepStrictEqual(
                        new GoParser(x.content).parseImports(),
                        x.expected
                    );
                });
            }
        });
    });

    suite('parseTestFunctions', function () {
        test('should use content property if no lines given as args', function () {
            assert.deepStrictEqual(
                new GoParser('package p\nimport "gopkg.in/check.v1"\nfunc (s *SomeSuite) TestSomething(c *check.C) {').parseTestFunctions([{ lineNumber: 1, moduleName: 'gopkg.in/check.v1' }]),
                <TestFunction[]>[{
                    kind:'gocheck',
                    functionName: 'TestSomething',
                    lineNumber: 2,
                    range: [2, 0, 2, 47],
                    receiverType: 'SomeSuite',
                    argType: { moduleName: 'gopkg.in/check.v1', typeName: 'C' }
                }]
            );
        });

        test('should accept content lines as argument', function () {
            assert.deepStrictEqual(
                new GoParser('package p\nimport "gopkg.in/check.v1"\nfunc (s *SomeSuite) TestSomething(c *check.C) {').parseTestFunctions([{ lineNumber: 1, moduleName: 'gopkg.in/check.v1' }]),
                <TestFunction[]>[{
                    kind:'gocheck',
                    functionName: 'TestSomething',
                    lineNumber: 2,
                    range: [2, 0, 2, 47],
                    receiverType: 'SomeSuite',
                    argType: { moduleName: 'gopkg.in/check.v1', typeName: 'C' }
                }]
            );
        });

        suite('should handle various args', function () {
            type Case = {
                name: string;
                content: string;
                imports: Import[];
                expected: ReturnType<GoParser['parseTestFunctions']>;
            };
            const cases: Case[] = [
                {
                    name: 'should return `[]` for empty content',
                    content: '',
                    imports: [],
                    expected: []
                },
                {
                    name: 'should return `[]` if no import statement',
                    content: 'a:=0',
                    imports: [],
                    expected: []
                },
                {
                    name: 'should detect `gocheck` suite test function (non-aliased import)',
                    content: 'func (s *SomeSuite) TestSomething(c *check.C) {}',
                    imports: [{ lineNumber: 0, moduleName: 'gopkg.in/check.v1' }],
                    expected: [{
                        kind: 'gocheck',
                        functionName: 'TestSomething',
                        argType: { moduleName: 'gopkg.in/check.v1', typeName: 'C' },
                        receiverType: 'SomeSuite',
                        lineNumber: 0,
                        range: [0, 0, 0, 47],
                    }]
                },
                {
                    name: 'should detect `gocheck` suite test function (aliased import)',
                    content: 'func (s *SomeSuite) TestSomething(c *alias.C) {}',
                    imports: [{ lineNumber: 0, moduleName: 'gopkg.in/check.v1', alias: 'alias' }],
                    expected: [{
                        kind: 'gocheck',
                        functionName: 'TestSomething',
                        argType: { moduleName: 'gopkg.in/check.v1', typeName: 'C' },
                        receiverType: 'SomeSuite',
                        lineNumber: 0,
                        range: [0, 0, 0, 47],
                    }]
                },
                {
                    name: 'should detect `qtsuite` suite test function (non-aliased import)',
                    content: 'func (s *SomeSuite) TestSomething(c *qtsuite.C) {}',
                    imports: [{ lineNumber: 0, moduleName: 'github.com/frankban/quicktest/qtsuite' }],
                    expected: [{
                        kind: 'qtsuite',
                        functionName: 'TestSomething',
                        argType: { moduleName: 'github.com/frankban/quicktest/qtsuite', typeName: 'C' },
                        receiverType: 'SomeSuite',
                        lineNumber: 0,
                        range: [0, 0, 0, 49],
                    }]
                },
                {
                    name: 'should detect `qtsuite` suite test function (aliased import)',
                    content: 'func (s *SomeSuite) TestSomething(c *alias.C) {}',
                    imports: [{ lineNumber: 0, moduleName: 'github.com/frankban/quicktest/qtsuite', alias: 'alias' }],
                    expected: [{
                        kind: 'qtsuite',
                        functionName: 'TestSomething',
                        argType: { moduleName: 'github.com/frankban/quicktest/qtsuite', typeName: 'C' },
                        receiverType: 'SomeSuite',
                        lineNumber: 0,
                        range: [0, 0, 0, 47],
                    }]
                },
                {
                    name: 'should return empty for unknown test functions',
                    content: 'func (s *SomeSuite) TestSomething(c *unknownLibrary.C) {',
                    imports: [{ lineNumber: 0, moduleName: 'unknownLibrary' }],
                    expected: []
                },
                {
                    name: 'should return empty for test functions with missing library imports',
                    content: 'func (s *SomeSuiteA) TestA(c *check.C) {}\nfunc (s *SomeSuiteB) TestB(c *qtsuite.C) {}',
                    imports: [],
                    expected: []
                },
                {
                    name: 'should detect suite test function correctly if aliases were changed over',
                    content: 'func (s *SomeSuiteA) TestA(c *check.C) {}\nfunc (s *SomeSuiteB) TestB(c *qtsuite.C) {}',
                    imports: [
                        { lineNumber: 0, moduleName: 'github.com/frankban/quicktest/qtsuite', alias: 'check' },
                        { lineNumber: 1, moduleName: 'gopkg.in/check.v1', alias: 'qtsuite' }
                    ],
                    expected: [
                        {
                            kind: 'qtsuite',
                            functionName: 'TestA',
                            argType: { moduleName: 'github.com/frankban/quicktest/qtsuite', typeName: 'C' },
                            receiverType: 'SomeSuiteA',
                            lineNumber: 0,
                            range: [0, 0, 0, 40],
                        },
                        {
                            kind: 'gocheck',
                            functionName: 'TestB',
                            argType: { moduleName: 'gopkg.in/check.v1', typeName: 'C' },
                            receiverType: 'SomeSuiteB',
                            lineNumber: 1,
                            range: [1, 0, 1, 42],
                        }
                    ]
                },
            ];

            for (const x of cases) {
                test(x.name, function () {
                    assert.deepStrictEqual(
                        new GoParser(x.content).parseTestFunctions(x.imports),
                        x.expected
                    );
                });
            }
        });
    });

    suite('parse', function () {
        test('should use content property if no lines given as args', function () {
            assert.deepStrictEqual(
                new GoParser('package given-via-constructor-args').parse(),
                {
                    packageInfo: { name: 'given-via-constructor-args', lineNumber: 0 },
                    imports: [],
                    testFunctions: []
                }
            );
        });

        test('should accept content lines as argument', function () {
            assert.deepStrictEqual(
                new GoParser('package given-via-constructor-args').parse(['package given-via-args']),
                {
                    packageInfo: { name: 'given-via-args', lineNumber: 0 },
                    imports: [],
                    testFunctions: []
                }
            );
        });

        suite('should handle various args', function () {
            type Case = {
                name: string;
                content: string;
                expected: ReturnType<GoParser['parse']>;
            };
            const cases: Case[] = [
                {
                    name: 'should return `undefined` for empty content',
                    content: '',
                    expected: undefined
                },
                {
                    name: 'should return `undefined` if no package statement',
                    content: 'a:=1',
                    expected: undefined
                },
                {
                    name: 'should work with an only package statement',
                    content: 'package p',
                    expected: { packageInfo: { name: 'p', lineNumber: 0 }, imports: [], testFunctions: [] }
                },
                {
                    name: 'should pick the first package statement',
                    content: 'package p1\npackage p2',
                    expected: { packageInfo: { name: 'p1', lineNumber: 0 }, imports: [], testFunctions: [] }
                },
                {
                    name: 'should pick the first package statement and all imports',
                    content: 'package p1\nimport "a1"\npackage p2\nimport "a2"',
                    expected: {
                        packageInfo: { name: 'p1', lineNumber: 0 },
                        imports: [{ moduleName: 'a1', lineNumber: 1 }, { moduleName: 'a2', lineNumber: 3 }],
                        testFunctions: []
                    }
                },
                {
                    name: 'should pick the imports after the first package statement',
                    content: 'import "first"\npackage p\nimport "second"',
                    expected: {
                        packageInfo: { name: 'p', lineNumber: 1 },
                        imports: [{ moduleName: 'second', lineNumber: 2 }],
                        testFunctions: []
                    }
                },
                {
                    name: 'should detect suite test functions',
                    content: 'package p\nimport (\n\tgc "gopkg.in/check.v1"\n\tqts "github.com/frankban/quicktest/qtsuite"\n)\nfunc (s* SomeSuiteA) TestA(c *gc.C) {}\nfunc (s* SomeSuiteB) TestB(c *qts.C) {}',
                    expected: {
                        packageInfo: { name: 'p', lineNumber: 0 },
                        imports: [
                            { moduleName: 'gopkg.in/check.v1', alias: 'gc', lineNumber: 2 },
                            { moduleName: 'github.com/frankban/quicktest/qtsuite', alias: 'qts', lineNumber: 3 }
                        ],
                        testFunctions: [
                            {
                                kind: 'gocheck',
                                functionName: 'TestA',
                                argType: { moduleName: 'gopkg.in/check.v1', typeName: 'C' },
                                receiverType: 'SomeSuiteA',
                                lineNumber: 5,
                                range: [5, 0, 5, 37],
                            },
                            {
                                kind: 'qtsuite',
                                functionName: 'TestB',
                                argType: { moduleName: 'github.com/frankban/quicktest/qtsuite', typeName: 'C' },
                                receiverType: 'SomeSuiteB',
                                lineNumber: 6,
                                range: [6, 0, 6, 38],
                            }
                        ]
                    }
                }
            ];
            for (const x of cases) {
                test(x.name, function () {
                    assert.deepStrictEqual(new GoParser(x.content).parse(), x.expected);
                });
            }
        });
    });
});
