import { mkdirSync } from 'fs';
import * as vscode from 'vscode';
import { GocheckTestLibraryAdapter, QtsuiteTestLibraryAdapter, TestProvider } from './testProvider';

export function activate(context: vscode.ExtensionContext) {
    mkdirSync(context.logUri.fsPath, { recursive: true });
    context.subscriptions.push(
        ...setupGocheckTestProvider(context),
        ...setupQtsuiteTestProvider(context),
    );
}

export function deactivate() { }

function setupGocheckTestProvider(context: vscode.ExtensionContext): vscode.Disposable[] {
    const gocheckController = vscode.tests.createTestController('gocheck', 'Go (gocheck)');
    const gocheckOutput = vscode.window.createOutputChannel('Go (gocheck)');
    const gocheckAdapter = new GocheckTestLibraryAdapter();
    const gocheckTestProvider = new TestProvider(gocheckController, gocheckOutput, gocheckAdapter, context.logUri);
    return [gocheckController, gocheckOutput, gocheckTestProvider];
}

function setupQtsuiteTestProvider(context: vscode.ExtensionContext): vscode.Disposable[] {
    const qtsuiteController = vscode.tests.createTestController('qtsuite', 'Go (qtsuite)');
    const qtsuiteOutput = vscode.window.createOutputChannel('Go (qtsuite)');
    const qtsuiteAdapter = new QtsuiteTestLibraryAdapter();
    const qtsuiteTestProvider = new TestProvider(qtsuiteController, qtsuiteOutput, qtsuiteAdapter, context.logUri);
    return [qtsuiteController, qtsuiteOutput, qtsuiteTestProvider];
}