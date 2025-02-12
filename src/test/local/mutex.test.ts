import * as assert from 'assert';
import { suite, test } from 'mocha';
import { Mutex } from '../../mutex';

suite('Mutex', function () {
    function makeDeferred(): { done: (() => void); donePromise: Promise<void> } {
        let done: (() => void) | undefined = undefined;
        const donePromise = new Promise<void>(resolve => { done = resolve; });
        return { done: done!, donePromise };
    }

    test('normal', async function () {
        const { done, donePromise } = makeDeferred();

        const mutex = new Mutex();

        const state: string[] = [];
        setImmediate(async () => {
            assert.strictEqual(mutex.isLocked(), false);
            const unlock = await mutex.lock();
            assert.strictEqual(mutex.isLocked(), true);
            state.push("acquired by a");
            setImmediate(() => {
                state.push("released by a");
                unlock();
                assert.strictEqual(mutex.isLocked(), false);
            });
        });
        setImmediate(async () => {
            assert.strictEqual(mutex.isLocked(), true); // Should already be acquired by a.
            const unlock = await mutex.lock();
            assert.strictEqual(mutex.isLocked(), true);
            state.push("acquired by b");
            setImmediate(() => {
                state.push("released by b");
                unlock();
                assert.strictEqual(mutex.isLocked(), false);
                done();
            });
        });

        await donePromise;
        assert.deepEqual(state, [
            "acquired by a",
            "released by a",
            "acquired by b",
            "released by b",
        ]);
    });

    test('synchronized lock/unlock sequence', async function () {
        const { done, donePromise } = makeDeferred();

        const mutex = new Mutex();

        const n = 20;
        const state: string[] = [];

        for (let i = 0; i < n; i++) {
            const ii = i;
            const name = ii.toString();
            setImmediate(async () => {
                assert.strictEqual(mutex.isLocked(), ii === 0 ? false : true); // Should already be acquired by the first one.
                const unlock = await mutex.lock();
                assert.strictEqual(mutex.isLocked(), true);
                state.push(`acquired by #${name}`);
                setImmediate(() => {
                    state.push(`released by #${name}`);
                    unlock();
                    assert.strictEqual(mutex.isLocked(), false);
                    if (ii === n - 1) {
                        done();
                    }
                });
            });
        }

        await donePromise;
        assert.strictEqual(state.length, 2 * n);
        for (let i = 0; i < n; i += 2) {
            assert.strictEqual(state[i + 1].split("#")[1], state[i].split("#")[1]);
        }
    });
});
