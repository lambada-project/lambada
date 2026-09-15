import { describe, expect, test } from 'bun:test'
import { bucketName } from '../buckets'
import { keyAlias } from '../security'
import { physical } from './awsEnv'

/** The runner has to create what run() deploys, under the same name. */
describe('the name the runner creates', () => {
    test('is the bucket name run() deploys', () => {
        expect(physical('uploads', 'test')).toBe(bucketName('uploads', 'test'))
    })

    test('is the key alias CreateKey publishes', () => {
        expect(`alias/${physical('proj', 'data', 'test')}`).toBe(keyAlias('proj-data', 'test'))
    })

    test('is the table name, prefix and all', () => {
        expect(physical('proj', 'pets', 'test')).toBe('proj-pets-test')
    })

    test('degrades to the bare definition name when the stack is not named', () => {
        expect(physical(undefined, 'pets', undefined)).toBe('pets')
    })
})
