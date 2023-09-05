import * as vscode from 'vscode';
import { COMMAND_MOVE_CURSOR_AND_EXEC_TEST, moveCursorAndExecuteTest } from './command';
import { TestProvider } from './testProvider';

export class ExecuteTestCodeLensProvider implements vscode.CodeLensProvider<vscode.CodeLens>, vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];

    private readonly _onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLensesEmitter.event;

    constructor(readonly providers: TestProvider[]) {
        this._disposables.push(
            ...this.providers.map(x => x.onUpdate(() => {
                this._onDidChangeCodeLensesEmitter.fire(undefined);
            })),
        );
    }

    dispose() {
        this._disposables.forEach(x => x.dispose());
    }

    provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
        if (document.isDirty) {
            return [];
        }

        const uriString = document.uri.toString();

        const result: vscode.CodeLens[] = [];
        for (const provider of this.providers) {
            const tests = provider.getTests().filter(x => x.uri && x.uri.toString() === uriString && x.range);
            if (!tests.length) {
                continue;
            }
            result.push(...tests.map(x => [
                new vscode.CodeLens(x.range!, {
                    title: 'Run Test',
                    command: COMMAND_MOVE_CURSOR_AND_EXEC_TEST,
                    arguments: [x, 'run'] satisfies Parameters<typeof moveCursorAndExecuteTest>,
                }),
                new vscode.CodeLens(x.range!, {
                    title: 'Debug Test',
                    command: COMMAND_MOVE_CURSOR_AND_EXEC_TEST,
                    arguments: [x, 'debug'] satisfies Parameters<typeof moveCursorAndExecuteTest>,
                }),
            ]).flat(1));
        }
        return result;
    }
}
