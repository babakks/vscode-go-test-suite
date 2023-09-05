import { mkdirSync } from 'fs';
import * as vscode from 'vscode';
import TelemetryReporter from '@vscode/extension-telemetry';

import { GocheckTestLibraryAdapter, QtsuiteTestLibraryAdapter, TelemetrySetup, TestProvider } from './testProvider';
import { registerCommands } from './command';

const _TELEMETRY_INSTRUMENTATION_KEY = '52da75ef-7ead-4f50-be55-f5644f9b7f4f';
let _reporter: TelemetryReporter;

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        _reporter = new TelemetryReporter(_TELEMETRY_INSTRUMENTATION_KEY)
    );
    mkdirSync(context.logUri.fsPath, { recursive: true });
    context.subscriptions.push(
        ...setupGocheckTestProvider(context, _reporter),
        ...setupQtsuiteTestProvider(context, _reporter),
    );

    context.subscriptions.push(...registerCommands());
}

export function deactivate() { }

function setupGocheckTestProvider(context: vscode.ExtensionContext, reporter: TelemetryReporter): vscode.Disposable[] {
    const controller = vscode.tests.createTestController('gocheck', 'Go (gocheck)');
    const output = vscode.window.createOutputChannel('Go (gocheck)');
    const adapter = new GocheckTestLibraryAdapter();
    const telemetry: TelemetrySetup = { reporter, events: { run: 'gocheck.run', debug: 'gocheck.debug', } };
    const provider = new TestProvider(telemetry, controller, output, adapter, context.logUri);
    return [controller, output, provider];
}

function setupQtsuiteTestProvider(context: vscode.ExtensionContext, reporter: TelemetryReporter): vscode.Disposable[] {
    const controller = vscode.tests.createTestController('qtsuite', 'Go (qtsuite)');
    const output = vscode.window.createOutputChannel('Go (qtsuite)');
    const adapter = new QtsuiteTestLibraryAdapter();
    const telemetry: TelemetrySetup = { reporter, events: { run: 'quicktest.run', debug: 'quicktest.debug', } };
    const provider = new TestProvider(telemetry, controller, output, adapter, context.logUri);
    return [controller, output, provider];
}