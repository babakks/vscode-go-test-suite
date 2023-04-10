import { readFileSync } from 'fs';
import { TextDecoder } from 'util';
import * as vscode from 'vscode';

export function traceChildren(testItem: vscode.TestItem): vscode.TestItem[] {
    return Array.from(childGenerator(testItem));
}

export function firstChild(collection: vscode.TestItemCollection, predicate: (test: vscode.TestItem) => any): vscode.TestItem | undefined {
    for (const [, item] of collection) {
        if (predicate(item)) {
            return item;
        }
        for (const x of childGenerator(item)) {
            if (predicate(x)) {
                return x;
            }
        }
    }
}

export function filterChildren(collection: vscode.TestItemCollection, predicate: (test: vscode.TestItem) => any): vscode.TestItem[] {
    const result = [];
    for (const [, item] of collection) {
        if (predicate(item)) {
            result.push(item);
        }
        for (const x of childGenerator(item)) {
            if (predicate(x)) {
                result.push(x);
            }
        }
    }
    return result;
}

export function* childGenerator(testItem: vscode.TestItem) {
    const stack = [testItem];
    const result: vscode.TestItem[] = [];
    while (true) {
        const item = stack.pop();
        if (!item) {
            break;
        }
        if (item !== testItem) {
            yield item;
        }
        item.children.forEach(x => stack.push(x));
    }
}

export function tryReadFileSync(path: string): string | undefined {
    try {
        return new TextDecoder().decode(readFileSync(path));
    } catch {
        return;
    }
}