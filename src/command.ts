import * as vscode from 'vscode';
import { hasLaunchConfiguration, TestData, TestProvider } from './testProvider';

export const COMMAND_MOVE_CURSOR_AND_EXEC_TEST = 'vscode-go-test-suite._moveCursorAndExecuteTest';
export const COMMAND_SHOW_LAUNCH_CONFIGURATION = 'vscode-go-test-suite._showLaunchConfiguration';

export function registerCommands(cmd: CommandsProvider): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand(COMMAND_MOVE_CURSOR_AND_EXEC_TEST, cmd.moveCursorAndExecuteTest.bind(cmd)),
        vscode.commands.registerCommand(COMMAND_SHOW_LAUNCH_CONFIGURATION, cmd.showLaunchConfiguration.bind(cmd)),
    ];
}

export type MoveCursorAndExecuteTestParameters = Parameters<typeof CommandsProvider.prototype.moveCursorAndExecuteTest>;
export type ShowLaunchConfigurationParameters = Parameters<typeof CommandsProvider.prototype.showLaunchConfiguration>;

export class CommandsProvider {
    constructor(readonly providers: TestProvider[]) { }

    moveCursorAndExecuteTest(test: vscode.TestItem, mode: 'run' | 'debug') {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.toString() !== test.uri?.toString() || !test.range) {
            return;
        }

        const lastSelection = editor.selection;
        editor.selection = new vscode.Selection(test.range.start, test.range.end);
        if (mode === 'debug') {
            vscode.commands.executeCommand('testing.debugAtCursor');
        } else {
            vscode.commands.executeCommand('testing.runAtCursor');
        }
        editor.selection = lastSelection;
    }

    private _findTestData(test: vscode.TestItem): [TestData, TestProvider] | undefined {
        for (const provider of this.providers) {
            const result = provider.getTestData(test);
            if (result) {
                return [result, provider];
            }
        }
    }

    async showLaunchConfiguration(test: vscode.TestItem) {
        const hit = this._findTestData(test);
        if (!hit) {
            return;
        }

        const [testData, provider] = hit;
        if (!hasLaunchConfiguration(testData)) {
            return;
        }

        const launchConfiguration = await provider.getDebugLaunchConfiguration(test, testData);
        if (!launchConfiguration) {
            return;
        }

        const fullLaunchConfiguration = {
            "version": "0.2.0",
            "configurations": [
                launchConfiguration
            ],
        };

        const content = JSON.stringify(fullLaunchConfiguration, null, 4);
        const doc = await vscode.workspace.openTextDocument({ language: "jsonc", content });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
    }
}
