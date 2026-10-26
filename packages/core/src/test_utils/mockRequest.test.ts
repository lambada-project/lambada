import { describe, expect, test } from 'bun:test'
import { getMockRequest, queryMaps } from './mockRequest'

/** What a REST API with a Lambda proxy integration delivered for each query, measured on AWS. */
const measured: [string, unknown, unknown][] = [
    ['?ids=a&ids=b', { ids: 'b' }, { ids: ['a', 'b'] }],
    ['?ids=a,b', { ids: 'a,b' }, { ids: ['a,b'] }],
    ['?ids=a%2Cb', { ids: 'a,b' }, { ids: ['a,b'] }],
    ['?ids=a', { ids: 'a' }, { ids: ['a'] }],
    ['?ids=', { ids: '' }, { ids: [''] }],
    ['?ids', { ids: '' }, { ids: [''] }],
    ['', null, null],
    ['?ids=a&ids=b&other=x', { ids: 'b', other: 'x' }, { ids: ['a', 'b'], other: ['x'] }],
    ['?ids=a&ids=&ids=b', { ids: 'b' }, { ids: ['a', '', 'b'] }],
    ['?IDS=a&ids=b', { IDS: 'a', ids: 'b' }, { IDS: ['a'], ids: ['b'] }],
]

describe('queryMaps', () => {
    test.each(measured)('%p arrives as AWS delivers it', (query, single, multi) => {
        expect(queryMaps(query)).toEqual({ queryStringParameters: single, multiValueQueryStringParameters: multi } as never)
    })

    test.each([
        [{ ids: ['a', 'b'] }, '?ids=a&ids=b'],
        [{ ids: 'a', other: 'x' }, '?ids=a&other=x'],
        [{}, ''],
    ] as const)('takes the query by key too: %p', (byKey, asSent) => {
        expect(queryMaps(byKey)).toEqual(queryMaps(asSent))
    })

    test('keeps a key every object inherits as a parameter of its own, as JSON.parse does with the event', () => {
        const { queryStringParameters: single, multiValueQueryStringParameters: multi } = queryMaps('?constructor=x&__proto__=y&__proto__=z&toString')

        expect(Object.entries(single!)).toEqual([['constructor', 'x'], ['__proto__', 'z'], ['toString', '']])
        expect(Object.entries(multi!)).toEqual([['constructor', ['x']], ['__proto__', ['y', 'z']], ['toString', ['']]])
        expect(Object.getPrototypeOf(multi)).toBe(Object.prototype)
        expect(queryMaps(JSON.parse('{"constructor":["x"],"__proto__":"y"}'))).toEqual(queryMaps('?constructor=x&__proto__=y'))
    })
})

describe('getMockRequest', () => {
    test('leaves both maps null without a query, as before', () => {
        const { request } = getMockRequest(true, { a: 1 })
        expect([request.queryStringParameters, request.multiValueQueryStringParameters]).toEqual([null, null])
    })

    test('carries a query in both maps', () => {
        const { request } = getMockRequest(true, undefined, '?ids=a&ids=b')
        expect(request.queryStringParameters).toEqual({ ids: 'b' })
        expect(request.multiValueQueryStringParameters).toEqual({ ids: ['a', 'b'] })
    })
})
