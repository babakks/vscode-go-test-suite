import * as vscode from 'vscode';

export const COMMAND_MOVE_CURSOR_AND_EXEC_TEST = 'vscode-go-test-suite._moveCursorAndExecuteTest';

export function registerCommands(): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand(COMMAND_MOVE_CURSOR_AND_EXEC_TEST, moveCursorAndExecuteTest),
    ];
}

export function moveCursorAndExecuteTest(test: vscode.TestItem, mode: 'run' | 'debug') {
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
