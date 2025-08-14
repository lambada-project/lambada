import { RepositoryBase } from './repository'
import { DefaultMarshaller, IMarshaller } from "./dynamoMarshaller"
import { describe, test, expect } from 'bun:test'

describe("Repository", () => {

    test("Marshaller", async () => {
        const repo = new TestRepo({
            envKeyName: "TEST_NAME",
            name: 'test',
            primaryKey: 'userId',
            rangeKey: 'id'
        }, undefined, {
            endpoint: `http://localhost:8000`,
            region: 'local',
            credentials: {
                accessKeyId: 'dummy',
                secretAccessKey: 'dummy'
            }
        })

        await repo.save({
            id: 1,
            name: 'test'
        })

        const marshaller: IMarshaller = DefaultMarshaller
        const original = {
            a: 1,
            b: 'b',
            c: [1, 2, 3],
            d: ['1', '2', '3']
        }

        const marshalled = marshaller.marshallItem(original)
        const unmarshalled = marshaller.unmarshallItem(marshalled) as unknown as typeof original

        expect(unmarshalled.a).toBe(original.a)
        expect(unmarshalled.b).toBe(original.b)
        expect(unmarshalled.c).toStrictEqual(original.c)
        expect(unmarshalled.d).toStrictEqual(original.d)
    })
})

class TestRepo extends RepositoryBase {

    constructor(...args: ConstructorParameters<typeof RepositoryBase>) {
        super(...args)
    }

    public save<T>(item: T): Promise<T> {
        return this.upsert(item)
    }

}



