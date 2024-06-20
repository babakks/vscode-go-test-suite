import TelemetryReporter from '@vscode/extension-telemetry';
import { mkdirSync } from 'fs';
import * as vscode from 'vscode';
import { ExecuteTestCodeLensProvider } from './codeLens';
import { registerCommands } from './command';
import { GocheckTestLibraryAdapter, QtsuiteTestLibraryAdapter, TelemetrySetup, TestProvider } from './testProvider';

const _TELEMETRY_CONNECTION_STRING = 'InstrumentationKey=52da75ef-7ead-4f50-be55-f5644f9b7f4f;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=20ec7ba9-71fc-446e-a841-80c584d1292c';
let _reporter: TelemetryReporter;

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        _reporter = new TelemetryReporter(context.extensionMode === vscode.ExtensionMode.Production ? _TELEMETRY_CONNECTION_STRING : '')
    );
    mkdirSync(context.logUri.fsPath, { recursive: true });

    const gocheck = setupGocheckTestProvider(context, _reporter);
    context.subscriptions.push(gocheck.controller, gocheck.output, gocheck.provider);

    const qtsuite = setupQtsuiteTestProvider(context, _reporter);
    context.subscriptions.push(qtsuite.controller, qtsuite.output, qtsuite.provider);

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'go', pattern: '/**/*_test.go' },
            new ExecuteTestCodeLensProvider([gocheck.provider, qtsuite.provider]),
        ),
    );

    context.subscriptions.push(...registerCommands());

    vscode.commands.executeCommand('testing.refreshTests');
}

export function deactivate() { }

function setupGocheckTestProvider(context: vscode.ExtensionContext, reporter: TelemetryReporter) {
    const controller = vscode.tests.createTestController('gocheck', 'Go (gocheck)');
    const output = vscode.window.createOutputChannel('Go (gocheck)');
    const adapter = new GocheckTestLibraryAdapter();
    const telemetry: TelemetrySetup = { reporter, events: { run: 'gocheck.run', debug: 'gocheck.debug', } };
    const provider = new TestProvider(telemetry, controller, output, adapter, context.logUri);
    return { controller, output, provider };
}

function setupQtsuiteTestProvider(context: vscode.ExtensionContext, reporter: TelemetryReporter) {
    const controller = vscode.tests.createTestController('qtsuite', 'Go (qtsuite)');
    const output = vscode.window.createOutputChannel('Go (qtsuite)');
    const adapter = new QtsuiteTestLibraryAdapter();
    const telemetry: TelemetrySetup = { reporter, events: { run: 'quicktest.run', debug: 'quicktest.debug', } };
    const provider = new TestProvider(telemetry, controller, output, adapter, context.logUri);
    return { controller, output, provider };
}