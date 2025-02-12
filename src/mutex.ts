export class Mutex {
    private _promise: Promise<void> | undefined;

    constructor() { }

    isLocked(): boolean {
        return !!this._promise;
    }

    async lock(): Promise<(() => void)> {
        const acquire = (): (() => void) => {
            let unlock: () => void;
            this._promise = new Promise<void>(resolve => {
                unlock = () => {
                    resolve();
                    this._promise = undefined;
                };
            });
            return unlock!;
        };

        if (!this._promise) {
            return acquire();
        }

        let currentPromise = this._promise;
        while (true) {
            await currentPromise;
            if (!this._promise) {
                return acquire();
            }
            currentPromise = this._promise;
        }
    }
}