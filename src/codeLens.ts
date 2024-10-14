import * as vscode from 'vscode';
import {
    COMMAND_MOVE_CURSOR_AND_EXEC_TEST,
    COMMAND_SHOW_LAUNCH_CONFIGURATION,
    type MoveCursorAndExecuteTestParameters,
    type ShowLaunchConfigurationParameters
} from './command';
import { hasLaunchConfiguration, TestProvider } from './testProvider';

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
            for (const item of tests) {
                result.push(
                    new vscode.CodeLens(item.range!, {
                        title: "Run",
                        command: COMMAND_MOVE_CURSOR_AND_EXEC_TEST,
                        arguments: [item, 'run'] satisfies MoveCursorAndExecuteTestParameters,
                    }),
                    new vscode.CodeLens(item.range!, {
                        title: "Debug",
                        command: COMMAND_MOVE_CURSOR_AND_EXEC_TEST,
                        arguments: [item, 'debug'] satisfies MoveCursorAndExecuteTestParameters,
                    }),
                );

                const testData = provider.getTestData(item);
                if (testData && hasLaunchConfiguration(testData)) {
                    result.push(new vscode.CodeLens(item.range!, {
                        title: "Launch Configuration",
                        command: COMMAND_SHOW_LAUNCH_CONFIGURATION,
                        arguments: [item] satisfies ShowLaunchConfigurationParameters,
                    }));
                }
            }
        }
        return result;
    }
}
