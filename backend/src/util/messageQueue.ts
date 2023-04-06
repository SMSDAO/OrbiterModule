import { sleep } from 'orbiter-chaincore/src/utils/core';
import { Mutex } from "async-mutex";
import { accessLogger } from './logger';

type Message = {
    id: string;
    data: any;
};

export class MessageQueue {
    private messages: Message[] = [];
    private consumedIds: Set<string> = new Set();
    public lastConsumeTime: number = Date.now();
    private mutex = new Mutex();
    constructor(private readonly name: string, private method: Function) {
    }
    public async enqueue(id: string, data: any) {
        await this.mutex.runExclusive(async () => {
            if (this.consumedIds.has(id)) {
                console.log(`${this.name} Message ${id} has already been consumed.`);
                return;
            }
            this.messages.push({ id, data });
            console.log(`${this.name} Message ${id} has been enqueued.${this.messages.length}`);
        });
    }
    public size() {
        return this.messages.length;
    }
    public async dequeue() {
        return new Promise(async (resolve, reject) => {
            // let result: any = null;
            await this.mutex.runExclusive(async () => {
                try {
                    while (this.messages.length > 0 && this.consumedIds.has(this.messages[0].id)) {
                        console.warn(`${this.name} Message has been consumed ${this.messages[0].id}`)
                        this.messages.shift();
                    }
                    if (this.messages.length > 0) {
                        const message = this.messages[0];
                        const result = await this.method(message.data);
                        this.consumedIds.add(message.id);
                        this.messages.shift();
                        console.log(`Message ${message.id} has been consumed.`);
                        return resolve(result)
                    }
                    this.clearConsumedIds();
                } catch (error) {
                    console.error(`Consumption error`, error);
                    reject(error);
                } finally {
                    this.lastConsumeTime = Date.now();
                }
            });
            // return result;
        })

    }
    public async consumeQueue(callback: Function) {
        setInterval(async () => {
            try {
                if (this.size() < 50 && Date.now() % 120 === 0) {
                    accessLogger.info(`check queue:${this.name}, size:${this.size()}, lastConsumeTime:${this.lastConsumeTime}`);
                } else if (this.size() > 50 && Date.now() % 60 === 0) {
                    accessLogger.info(`check queue:${this.name}, size:${this.size()}, lastConsumeTime:${this.lastConsumeTime}`);
                }
                if (this.size() > 0) {
                    const response = await this.dequeue();
                    accessLogger.info(`queue:${this.name}, Consumption results::${JSON.stringify(response || {})}`);
                    if (response) {
                        await callback(null, response)
                    }
                }
            } catch (error) {
                callback(error);
                accessLogger.error(`queue:${this.name}, Consumption error`, error);
            }
        }, 1000);
    }

    private clearConsumedIds() {
        for (const id of this.consumedIds) {
            if (!this.messages.some((message) => message.id === id)) {
                this.consumedIds.delete(id);
            }
        }
    }
}