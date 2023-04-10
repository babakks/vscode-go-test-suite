import * as vscode from 'vscode';
import { GocheckTestLibraryAdapter, TestProvider } from './testProvider';
import { mkdirSync } from 'fs';

export function activate(context: vscode.ExtensionContext) {
    mkdirSync(context.logUri.fsPath, { recursive: true });
    const gocheckController = vscode.tests.createTestController('gocheck', 'Go (gocheck)');
    const gocheckOutput = vscode.window.createOutputChannel('Go (gocheck)');
    const gocheckAdapter = new GocheckTestLibraryAdapter();
    const gocheckTestProvider = new TestProvider(gocheckController, gocheckOutput, gocheckAdapter, context.logUri);
    context.subscriptions.push(gocheckController, gocheckOutput, gocheckTestProvider);
}

export function deactivate() { }

