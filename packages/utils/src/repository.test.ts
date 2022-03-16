import { DefaultMarshaller, IMarshaller, RepositoryBase } from './repository'

describe("Repository", () => {
    test("Marshaller", async () => {
        // const repo = new TestRepo({
        //     envKeyName: "TEST_NAME",
        //     name: 'test',
        //     primaryKey: 'userId',
        //     rangeKey: 'id'
        // })

        const marshaller: IMarshaller = DefaultMarshaller
        const original = {
            a: 1,
            b: 'b',
            c: [1, 2, 3],
            d: ['1', '2', '3']
        }

        const marshalled = marshaller.marshallItem(original)
        console.log('marshalled', marshalled)
        const unmarshalled = marshaller.unmarshallItem(marshalled)
        console.log('unmarshalled', unmarshalled)

        expect(unmarshalled.a).toBe(original.a)
        expect(unmarshalled.b).toBe(original.b)
        expect(unmarshalled.c).toStrictEqual(original.c)
        expect(unmarshalled.d).toStrictEqual(original.d)
    })
})

class TestRepo extends RepositoryBase {

}



