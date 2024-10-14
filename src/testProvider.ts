import TelemetryReporter from '@vscode/extension-telemetry';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import { platform } from 'os';
import { basename, dirname } from 'path';
import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import { ExtensionAPI as GoExtensionAPI } from './go';
import { GoParser, type TestFunction, type TestSuite } from './goParser';
import { filterChildren, firstChild, traceChildren, tryReadFileSync } from './util';
import assert = require('assert');
import path = require('path');

export interface TestLibraryAdapter {
    discoverTestFunctions(content: string, path: string): TestFunction[];
    getRunCommand(data: TestFunctionData | TestSuiteData, path: string): { command?: string; args?: string[] };
    getDebugCommand(data: TestFunctionData | TestSuiteData, path: string): { program?: string; args?: string[] };
}

interface TestSuiteData {
    kind: 'suite';
    data: TestSuite;
}

interface TestFunctionData {
    kind: 'function';
    data: TestFunction;
}

export type TestData = TestFunctionData | TestSuiteData | 'file' | 'package';

function isTestFunctionData(v: TestData): v is TestFunctionData {
    return typeof v === 'object' && 'kind' in v && v.kind === 'function';
}

function isTestSuiteData(v: TestData): v is TestSuiteData {
    return typeof v === 'object' && 'kind' in v && v.kind === 'suite';
}

/**
 * Determines that a given {@link TestData} instance has a launch configuration
 * associated with it. This is not the case if the corresponding test data object
 * points to a file/package.
 */
export function hasLaunchConfiguration(v: TestData): boolean {
    return isTestFunctionData(v) || isTestSuiteData(v);
}

const _FAILED_TO_RETRIEVE_GO_EXECUTION_PARAMS_ERROR_MESSAGE = 'error: cannot retrieve `go` execution command from Go extension';

interface OnCreateDebugAdapterTrackerEventArgs {
    session: vscode.DebugSession;
    tracker: vscode.DebugAdapterTracker | undefined;
}

export type TelemetrySetup = {
    reporter: TelemetryReporter,
    events: {
        run: string;
        debug: string;
    }
};

/**
 * Provides Go tests for supported test libraries.
 *
 * The test *Entries* (i.e., `vscode.TestItem` instances) are structured in this way:
 *
 * - Package (e.g., `my_package`)
 *   - File (e.g., `normal_test.go`)
 *     - Suite (e.g., `SomeSuite`)
 *       - Function (e.g., `TestSomething`)
 */
export class TestProvider implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _goExtension: GoExtensionAPI | undefined;

    private readonly _map = new WeakMap<vscode.TestItem, TestData>();

    private readonly _onCreateDebugAdapterTracker = new vscode.EventEmitter<OnCreateDebugAdapterTrackerEventArgs>();

    private readonly _onUpdateEmitter = new vscode.EventEmitter<void>();
    /**
     * Fires when the list of discovered tests is updated.
     */
    readonly onUpdate = this._onUpdateEmitter.event;

    constructor(
        public readonly telemetry: TelemetrySetup,
        public readonly controller: vscode.TestController,
        public readonly output: vscode.OutputChannel,
        public readonly adapter: TestLibraryAdapter,
        public readonly logUri: vscode.Uri,
    ) {
        // First, create the `resolveHandler`. This may initially be called with
        // "undefined" to ask for all tests in the workspace to be discovered, usually
        // when the user opens the Test Explorer for the first time.
        this.controller.resolveHandler = async test => {
            if (!test) {
                await this._discoverAllTests();
                return;
            }

            const data = this._map.get(test);
            if (!data) {
                return;
            }

            if (data === 'package') {
                await this._refreshPackageEntry(test);
            } else if (data === 'file') {
                await this._refreshFileEntry(test);
            } else {
                assert(test.uri);
                await this._discoverTestsInFile(test.uri);
            }
        };

        this.controller.refreshHandler = async (token: vscode.CancellationToken) => {
            await this._discoverAllTests(token);
        };

        this._disposables.push(
            // When text documents are open, parse tests in them.
            vscode.workspace.onDidOpenTextDocument(e => this._discoverTestsInFile(e.uri, e.getText())),
            // // We could also listen to document changes to re-parse unsaved changes:
            // vscode.workspace.onDidChangeTextDocument(e => this.parseTestsInDocument(e.document)),
            controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, token) => this._startTestRun(false, request, token)),
            controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, (request, token) => this._startTestRun(true, request, token)),
        );

        vscode.debug.registerDebugAdapterTrackerFactory('go', {
            createDebugAdapterTracker: (session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> => {
                const e: OnCreateDebugAdapterTrackerEventArgs = { session, tracker: undefined };
                this._onCreateDebugAdapterTracker.fire(e);
                return e.tracker;
            }
        });
    }

    dispose() {
        this._disposables.forEach(x => x.dispose());
    }

    private async _go() {
        if (this._goExtension) {
            return this._goExtension;
        }

        const ext = vscode.extensions.getExtension<GoExtensionAPI>('golang.go');
        if (!ext) {
            throw new Error('Go extension should be installed');
        }
        if (!ext.isActive) {
            await ext.activate();
        }
        this._goExtension = ext.exports;
        return this._goExtension;
    }

    private async _getGoExecutionCommand() {
        return (await this._go()).settings.getExecutionCommand('go');
    }

    private _goTestEnvVars(): NodeJS.ProcessEnv {
        const config = vscode.workspace.getConfiguration('go');
        const value = config.get<NodeJS.ProcessEnv>('testEnvVars');
        if (typeof value === 'object' && !Array.isArray(value)) {
            return value;
        }
        return {};
    }

    getTests(): vscode.TestItem[] {
        const result: vscode.TestItem[] = [];
        const stack: vscode.TestItem[] = [];

        const push = (values: vscode.TestItemCollection) => values.forEach(x => stack.push(x));
        push(this.controller.items);
        while (true) {
            const entry = stack.pop();
            if (!entry) {
                break;
            }
            if (entry.range) {
                result.push(entry);
            }
            push(entry.children);
        }
        return result;
    }

    getTestData(test: vscode.TestItem): TestData | undefined {
        return this._map.get(test);
    }

    private _findFileEntry(uri: vscode.Uri): vscode.TestItem | undefined {
        return firstChild(this.controller.items, (x: vscode.TestItem) => x.uri?.path === uri.path && this._map.get(x) === 'file');
    }

    private _findSuiteEntriesWithNoChildren(): vscode.TestItem[] {
        return filterChildren(this.controller.items, (x: vscode.TestItem) => {
            const item = this._map.get(x);
            return !item ? false : ((item as TestSuiteData).kind === 'suite' ? !x.children.size : false);
        });
    }

    private _findFileEntriesWithNoChildren(): vscode.TestItem[] {
        return filterChildren(this.controller.items, (x: vscode.TestItem) => this._map.get(x) === 'file' && !x.children.size);
    }

    private _findPackageEntriesWithNoChildren(): vscode.TestItem[] {
        return filterChildren(this.controller.items, (x: vscode.TestItem) => this._map.get(x) === 'package' && !x.children.size);
    }

    private _purgeEntriesWithNoChildren() {
        for (const x of this._findSuiteEntriesWithNoChildren()) {
            assert(x.parent);
            this._map.delete(x);
            x.parent.children.delete(x.id);
        }

        for (const x of this._findFileEntriesWithNoChildren()) {
            assert(x.parent);
            this._map.delete(x);
            x.parent.children.delete(x.id);
        }

        for (const x of this._findPackageEntriesWithNoChildren()) {
            this._map.delete(x);
            this.controller.items.delete(x.id);
        }
    }

    private async _refreshPackageEntry(test: vscode.TestItem) {
        assert(test.uri);
        traceChildren(test).forEach(x => this._map.delete(x));
        test.children.replace([]);
        const files = await vscode.workspace.fs.readDirectory(test.uri);
        for (const [filename, fileType] of files) {
            if (fileType !== vscode.FileType.File) {
                continue;
            }
            await this._discoverTestsInFile(vscode.Uri.joinPath(test.uri, filename));
        }
    }

    private async _refreshFileEntry(test: vscode.TestItem) {
        assert(test.uri);
        test.children.forEach(x => this._map.delete(x));
        test.children.replace([]);
        await this._discoverTestsInFile(test.uri);
    }

    private async _discoverTestsInFile(uri: vscode.Uri, content?: string) {
        if (uri.scheme !== 'file' || !uri.path.endsWith('_test.go')) {
            return;
        }

        if (uri.path.split(path.sep).includes('testdata')) {
            /**
             * As per `go help test` docs:
             * > The go tool will ignore a directory named "testdata", making it available to hold ancillary data needed by the tests.
             */
            return;
        }

        const filename = basename(uri.path);
        if (filename.startsWith('.') || filename.startsWith('_')) {
            /**
             * As per `go help test` docs:
             * > Files whose names begin with "_" (including "_test.go") or "." are ignored.
             */
            return;
        }

        content ??= new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));

        const packageName = new GoParser(content).parsePackageName()?.name;
        if (!packageName) {
            return;
        }

        const discovered = this.adapter.discoverTestFunctions(content, uri.path);
        if (!discovered.length) {
            return;
        }

        let updated = false;

        const directory = uri.with({ path: dirname(uri.path) });
        const packageId = `${directory.path}:${packageName}`;
        let packageItem = this.controller.items.get(packageId);
        if (!packageItem) {
            const directoryAsRelative = vscode.workspace.asRelativePath(directory.fsPath + '/.');
            const label = `${directoryAsRelative}${directoryAsRelative ? '/' : ''}${packageName}`;
            packageItem = this.controller.createTestItem(packageId, label, directory);
            this.controller.items.add(packageItem);
            this._map.set(packageItem, 'package');
            updated = true;
        }

        const filenameWithoutExtension = filename.split('.').slice(0, -1).join('.');
        const fileId = filenameWithoutExtension;
        let fileItem = packageItem.children.get(fileId);
        if (!fileItem) {
            fileItem = this.controller.createTestItem(fileId, filename, uri);
            packageItem.children.add(fileItem);
            this._map.set(fileItem, 'file');
            updated = true;
        }

        for (const t of discovered) {
            if (t.receiverType === undefined) {
                continue;
            }

            const suiteId = t.receiverType;
            let suiteItem = fileItem.children.get(suiteId);
            if (!suiteItem) {
                suiteItem = this.controller.createTestItem(suiteId, suiteId, uri);
                fileItem.children.add(suiteItem);
                this._map.set(suiteItem, { kind: 'suite', data: { name: t.receiverType } });
                updated = true;
            }

            const id = `${t.receiverType ?? ''}.${t.functionName}`;
            const item = this.controller.createTestItem(id, t.functionName, uri);
            item.range = new vscode.Range(...t.range);
            suiteItem.children.add(item);
            this._map.set(item, { kind: 'function', data: t });
            updated = true;
        }

        if (updated) {
            this._onUpdateEmitter.fire();
        }
    }

    private async _discoverAllTests(token?: vscode.CancellationToken) {
        if (token?.isCancellationRequested) {
            return [];
        }

        this.controller.items.replace([]);

        if (!vscode.workspace.workspaceFolders) {
            return []; // handle the case of no open folders
        }

        const cancelPromise = token ? this._getCancellationTokenPromise(token) : undefined;
        const promises = vscode.workspace.workspaceFolders.map(async workspaceFolder => {
            const pattern = new vscode.RelativePattern(workspaceFolder, '**/*_test.go');
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            this._disposables.push(
                watcher,
                // When files are created, make sure there's a corresponding "file" node in the tree
                watcher.onDidCreate(async uri => { await this._discoverTestsInFile(uri); }),
                // When files change, re-parse them. Note that you could optimize this so
                // that you only re-parse children that have been resolved in the past.
                watcher.onDidChange(async uri => {
                    const test = this._findFileEntry(uri);
                    if (!test) {
                        await this._discoverTestsInFile(uri);
                    } else {
                        await this._refreshFileEntry(test);
                    }
                    this._purgeEntriesWithNoChildren();
                }),
                // And, finally, delete TestItems for removed files. This is simple, since
                // we use the URI as the TestItem's ID.
                watcher.onDidDelete(uri => {
                    const test = this._findFileEntry(uri);
                    if (!test) {
                        return;
                    }
                    test.parent?.children.delete(test.id);
                    this._map.delete(test);
                    this._purgeEntriesWithNoChildren();
                }),
            );

            const allFiles = vscode.workspace.findFiles(pattern);
            const race = await Promise.race([allFiles, ...(cancelPromise ? [cancelPromise] : [])]);
            if (!race) {
                return watcher;
            }

            for (const file of race) {
                if (token?.isCancellationRequested) {
                    break;
                }
                this._discoverTestsInFile(file);
            }
            return watcher;
        });
        return await Promise.all(promises);
    }

    private _getCancellationTokenPromise(token: vscode.CancellationToken) {
        return new Promise<void>(resolve => {
            if (token.isCancellationRequested) {
                resolve();
            }
            const listener = token.onCancellationRequested(e => {
                listener.dispose();
                resolve();
            });
            this._disposables.push(listener);
        });
    }

    private async _startTestRun(isDebug: boolean, request: vscode.TestRunRequest, token: vscode.CancellationToken) {
        const queue: { test: vscode.TestItem; data: TestFunctionData | TestSuiteData }[] = [];
        const run = this.controller.createTestRun(request);

        function gatherTestItems(collection: vscode.TestItemCollection) {
            const items: vscode.TestItem[] = [];
            collection.forEach(item => items.push(item));
            return items;
        }

        const discoverTests = async (tests: Iterable<vscode.TestItem>) => {
            for (const test of tests) {
                if (request.exclude?.includes(test)) {
                    continue;
                }

                const data = this._map.get(test);
                if (!data) {
                    continue;
                }

                if (data === 'file' || data === 'package') {
                    await discoverTests(gatherTestItems(test.children));
                } else {
                    run.enqueued(test);
                    queue.push({ test, data });
                }
            }
        };

        const runTestQueue = async () => {
            for (const { test, data } of queue) {
                if (run.token.isCancellationRequested) {
                    run.skipped(test);
                    this._log(`Skipped ${test.id}\r\n`, run);
                } else {
                    run.started(test);
                    if (data.kind === 'suite') {
                        this._log(`Running suite ${test.id}\r\n`, run);
                    } else {
                        this._log(`Running test ${test.id}\r\n`, run);
                    }

                    if (isDebug) {
                        this.telemetry.reporter.sendTelemetryEvent(this.telemetry.events.debug);
                        await this._debug(run, test, data, token);
                    } else {
                        this.telemetry.reporter.sendTelemetryEvent(this.telemetry.events.run);
                        await this._run(run, test, data, token);
                    }

                    if (data.kind === 'suite') {
                        this._log(`Completed suite ${test.id}\r\n`, run);
                    } else {
                        this._log(`Completed test ${test.id}\r\n`, run);
                    }
                }
            }

            run.end();
        };

        await discoverTests(request.include ?? gatherTestItems(this.controller.items));
        if (!queue.length) {
            vscode.window.showErrorMessage("No tests to run");
            run.end();
            return;
        } else if (isDebug && queue.length > 1) {
            vscode.window.showErrorMessage("The extension does not support debugging multiple tests");
            run.end();
            return;
        }
        await runTestQueue();
    };

    private async _run(run: vscode.TestRun, test: vscode.TestItem, data: TestFunctionData | TestSuiteData, token: vscode.CancellationToken) {
        assert(test.uri);

        const execution = await this._getGoExecutionCommand();
        if (!execution) {
            this._log(_FAILED_TO_RETRIEVE_GO_EXECUTION_PARAMS_ERROR_MESSAGE, run);
            run.skipped(test);
            return;
        }

        let cancel: (value: boolean) => void;
        const cancellationPromise = new Promise<boolean>(resolve => { cancel = resolve; });
        const disposables = [
            run.token.onCancellationRequested(e => cancel(true)),
            token.onCancellationRequested(e => cancel(true)),
        ];
        const disposeCancellationHooks = () => disposables.forEach(x => x.dispose());

        const cmd = this.adapter.getRunCommand(data, test.uri.fsPath);
        const testDirectory = dirname(test.uri.fsPath);
        const command = cmd.command || execution.binPath;
        const args = cmd.args || ['test'];
        const env = { ...process.env, ...execution.env as NodeJS.ProcessEnv ?? {}, ...this._goTestEnvVars() };

        type ProcessResult = { code: number | null; stdout: string; stderr: string; };
        test.busy = true;
        const start = Date.now();
        let testProcess: ChildProcessWithoutNullStreams | undefined;
        const testProcessPromise = new Promise<ProcessResult>(resolve => {
            assert(test.uri);
            testProcess = spawn(command, args, {
                cwd: testDirectory,
                env,
            });
            const result: ProcessResult = {
                code: 0,
                stdout: '',
                stderr: '',
            };
            testProcess.stdout.on('data', (data) => {
                result.stdout += (data.toString() as string).replace(/\r?\n/g, '\r\n');
            });
            testProcess.stderr.on('data', (data) => {
                result.stderr += (data.toString() as string).replace(/\r?\n/g, '\r\n');;
            });
            testProcess.on('close', (code) => {
                result.code = code;
                testProcess = undefined;
                resolve(result);
            });
        });

        const result = await Promise.race([testProcessPromise, cancellationPromise]);
        test.busy = false;
        disposeCancellationHooks();

        if (typeof result === 'boolean') {
            // User has cancelled the run.
            testProcess?.kill();
            run.skipped(test);
            run.errored(test, new vscode.TestMessage('Cancelled'), Date.now() - start);
            return;
        }

        if (result.code === 0) {
            if (result.stdout) {
                this._log(result.stdout, run);
            }
            run.passed(test, Date.now() - start);
            for (const [_, item] of test.children) {
                run.passed(item);
            }
        } else {
            this._log(`test failed (exit code: ${result.code}): ${test.id}`, run);
            if (result.stdout) {
                this._log(result.stdout, run);
            }
            if (result.stderr) {
                this._log(result.stderr, run);
            }
            run.failed(test, new vscode.TestMessage(`${result.stdout}\r\n${result.stderr}`), Date.now() - start);

            // TODO If it's suite test, we need to parse the output and mark the failed/passed test children accordingly.
            // Currently, we just mark them as skipped to drop any "passed" states.
            for (const [_, item] of test.children) {
                run.skipped(item);
            }
        }
    }

    private async _debug(run: vscode.TestRun, test: vscode.TestItem, data: TestFunctionData | TestSuiteData, token: vscode.CancellationToken) {
        assert(test.uri);

        const goCheckSessionIDKey = 'goTestSessionID' as const;
        const sessionId = randomUUID();

        let tracker: GoTestDebugAdapterTracker | undefined = undefined;
        const trackerListener = this._onCreateDebugAdapterTracker.event(e => {
            if (e.tracker || e.session.configuration[goCheckSessionIDKey] !== sessionId) {
                return;
            }
            e.tracker = tracker = new GoTestDebugAdapterTracker();
            trackerListener.dispose();
        });
        this._disposables.push(trackerListener);

        let sessionStartSignal: (value: vscode.DebugSession) => void;
        const sessionStartPromise = new Promise<vscode.DebugSession>(resolve => { sessionStartSignal = resolve; });
        const listener = vscode.debug.onDidStartDebugSession(e => {
            if (e.configuration[goCheckSessionIDKey] === sessionId) {
                sessionStartSignal(e);
                listener.dispose();
            }
        });
        this._disposables.push(listener);

        const bareLaunchConfiguration = await this.getDebugLaunchConfiguration(test, data);
        if (!bareLaunchConfiguration) {
            run.skipped(test);
            return;
        }

        const logFile = this._getLogFilePath(sessionId);
        const started = await vscode.debug.startDebugging(
            vscode.workspace.getWorkspaceFolder(test.uri),
            {
                ...bareLaunchConfiguration,
                [goCheckSessionIDKey]: sessionId,
                showLog: true,
                /**
                 * As of vscode-go extension docs, the `logDest` option is only available on Linux or Mac.
                 *
                 * See "logDest" description in:
                 *   https://github.com/golang/vscode-go/blob/d9015c19ed5be58bb51f3c53b651fe2468540086/docs/debugging.md#configuration
                 */
                ...(['darwin', 'linux'].includes(platform()) ? { logDest: logFile.fsPath } : {}),
            },
        );

        if (!started) {
            this._log('error: debug session did not start', run);
            run.skipped(test);
            return;
        }

        let sessionStopSignal: () => void;
        const sessionStopPromise = new Promise<void>(resolve => { sessionStopSignal = resolve; });

        const listener2 = vscode.debug.onDidTerminateDebugSession(e => {
            if (e.configuration[goCheckSessionIDKey] === sessionId) {
                if (tracker) {
                    const stdout = tracker.stdout.join('\r\n');
                    const stderr = tracker.stderr.join('\r\n');
                    const others = tracker.others.join('\r\n');
                    const trail = [stdout, stderr, others].join('\r\n');
                    const markAsFailed = () => {
                        run.failed(test, new vscode.TestMessage(trail));
                        // TODO If it's suite test, we need to parse the output and mark the failed/passed test children accordingly.
                        // Currently, we just mark them as skipped to drop any "passed" states.
                        for (const [_, item] of test.children) {
                            run.skipped(item);
                        }
                    };
                    const markAsPassed = () => {
                        run.passed(test);
                        for (const [_, item] of test.children) {
                            run.passed(item);
                        }
                    };
                    this._log(trail);
                    if (tracker.error) {
                        markAsFailed();
                    } else if (tracker.exitCode !== undefined) {
                        if (!tracker.exitCode) {
                            markAsPassed();
                        } else {
                            markAsFailed();
                        }
                    } else {
                        if (/^PASS$/m.exec(stdout)) {
                            markAsPassed();
                        } else if (/^FAIL$/m.exec(stdout)) {
                            markAsFailed();
                        } else {
                            run.skipped(test);
                        }
                    }
                } else {
                    run.skipped(test);
                }

                const debuggerLog = tryReadFileSync(logFile.fsPath);
                if (debuggerLog) {
                    this._log(debuggerLog.replace(/\r?\n/g, '\r\n'), run);
                }

                listener2.dispose();
                sessionStopSignal();
            }
        });
        this._disposables.push(listener2);

        const session = await sessionStartPromise;
        const cancelListener = token.onCancellationRequested(e => {
            vscode.debug.stopDebugging(session);
            cancelListener.dispose();
        });
        this._disposables.push(cancelListener);
        await sessionStopPromise;
    }

    async getDebugLaunchConfiguration(test: vscode.TestItem, data: TestData): Promise<vscode.DebugConfiguration | undefined> {
        assert(test.uri);

        if (!isTestFunctionData(data) && !isTestSuiteData(data)) {
            return undefined;
        }

        const execution = await this._getGoExecutionCommand();
        if (!execution) {
            this._log(_FAILED_TO_RETRIEVE_GO_EXECUTION_PARAMS_ERROR_MESSAGE);
            return;
        }

        const testDirectory = dirname(test.uri.fsPath);
        const cmd = this.adapter.getDebugCommand(data, test.uri.fsPath);
        const program = cmd.program || testDirectory;
        const args = cmd.args || [];
        const env = { ...execution.env as NodeJS.ProcessEnv ?? {}, ...this._goTestEnvVars() };

        return {
            type: 'go',
            request: 'launch',
            mode: 'test',
            name: `Debug test ${test.id}`,
            cwd: testDirectory,
            env,
            program,
            args,
        };
    }

    private _getLogFilePath(name: string): vscode.Uri {
        return vscode.Uri.joinPath(this.logUri, name);
    }

    private _log(message: string, run?: vscode.TestRun) {
        this.output.appendLine(message);
        run?.appendOutput(message);
    }
}

class GoTestDebugAdapterTracker implements vscode.DebugAdapterTracker {
    public readonly stdout: string[] = [];
    public readonly stderr: string[] = [];
    public readonly others: string[] = [];

    private _exitCode: number | undefined = undefined;
    get exitCode() {
        return this._exitCode;
    }

    private _error: Error | undefined = undefined;
    get error() {
        return this._error;
    }

    /**
     * The debug adapter has sent a Debug Adapter Protocol message to the editor.
     */
    onDidSendMessage(message: any): void {
        if (message['type'] !== 'event' || message['event'] !== 'output') {
            return;
        }
        if (message.body.category === 'stdout') {
            this.stdout.push(message.body.output);
        } else if (message.body.category === 'stderr') {
            this.stderr.push(message.body.output);
        } else {
            this.others.push(message.body.output);
        }
    }

    /**
     * An error with the debug adapter has occurred.
     */
    onError(error: Error): void {
        this._error = error;
    }

    /**
     * The debug adapter has exited with the given exit code or signal.
     */
    onExit(code: number | undefined, signal: string | undefined): void {
        this._exitCode = code;
    }
}

export class GocheckTestLibraryAdapter implements TestLibraryAdapter {
    discoverTestFunctions(content: string, path: string): TestFunction[] {
        return new GoParser(content).parse()?.testFunctions.filter(x => x.kind === 'gocheck') || [];
    }

    getRunCommand(data: TestFunctionData | TestSuiteData, path: string): { command?: string | undefined; args?: string[] | undefined; } {
        return data.kind === 'suite' ? { args: ['test', '-check.f', `^${data.data.name}$`] }
            : { args: ['test', '-check.f', `^${data.data.receiverType}.${data.data.functionName}$`] };
    }

    getDebugCommand(data: TestFunctionData | TestSuiteData, path: string): { program?: string | undefined; args?: string[] | undefined; } {
        return data.kind === 'suite' ? { args: ['-check.f', `^${data.data.name}$`] }
            : { args: ['-check.f', `^${data.data.receiverType}.${data.data.functionName}$`] };
    }
}

export class QtsuiteTestLibraryAdapter implements TestLibraryAdapter {
    discoverTestFunctions(content: string, path: string): TestFunction[] {
        return new GoParser(content).parse()?.testFunctions.filter(x => x.kind === 'quicktest') || [];
    }

    getRunCommand(data: TestFunctionData | TestSuiteData, path: string): { command?: string | undefined; args?: string[] | undefined; } {
        return data.kind === 'suite' ? { args: ['test', '-run', `^${data.data.name}$`] }
            : { args: ['test', '-run', `.*/${data.data.functionName}$`] };
    }

    getDebugCommand(data: TestFunctionData | TestSuiteData, path: string): { program?: string | undefined; args?: string[] | undefined; } {
        return data.kind === 'suite' ? { args: ['-test.run', `^${data.data.name}$`] }
            : { args: ['-test.run', `.*/${data.data.functionName}$`] };
    }
}