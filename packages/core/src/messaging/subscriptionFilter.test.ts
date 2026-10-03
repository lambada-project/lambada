import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createDynamoDbTables } from '../database'
import { createMessaging } from '.'
import { filterArgs, LambdaSubscription, subscribeToTopic } from './createSubscription'

const created: pulumi.runtime.MockResourceArgs[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        created.push(args)
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}` } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

describe('a subscription filter', () => {
    test('on attributes is a MessageAttributes filter policy', () => {
        expect(filterArgs('onOrder', { attributes: { type: ['order.created'] } }))
            .toEqual({ filterPolicy: '{"type":["order.created"]}', filterPolicyScope: 'MessageAttributes' })
    })

    test('on the body is a MessageBody filter policy, nesting and all', () => {
        expect(filterArgs('onOrder', { body: { order: { amount: [{ numeric: ['>', 100] }] } } }))
            .toEqual({ filterPolicy: '{"order":{"amount":[{"numeric":[">",100]}]}}', filterPolicyScope: 'MessageBody' })
    })

    test('keeps the other subscription args', () => {
        expect(filterArgs('onOrder', { attributes: { type: ['a'] } }, { rawMessageDelivery: true }))
            .toMatchObject({ rawMessageDelivery: true, filterPolicyScope: 'MessageAttributes' })
    })

    test('absent leaves the subscription args as they were', () => {
        const args = { filterPolicy: '{"type":["a"]}' }

        expect(filterArgs('onOrder', undefined, args)).toBe(args)
    })

    test('next to a filter policy in subscriptionArgs is refused', () => {
        expect(() => filterArgs('onOrder', { body: { type: ['a'] } }, { filterPolicy: '{}' }))
            .toThrow('onOrder sets both filter and subscriptionArgs.filterPolicy')
    })
})

test("a subscription's filter reaches the SNS subscription", async () => {
    const environment = 'test'
    const context = {
        environment,
        databases: createDynamoDbTables(environment, { received: { name: 'received', primaryKey: 'id', envKeyName: 'RECEIVED' } }),
        messaging: createMessaging(environment, { events: { name: 'events', envKeyName: 'EVENTS' } }),
    }
    const subscription: LambdaSubscription = {
        name: 'onOrderCreated',
        callback: { functionFolder: '.', handler: 'index.main' },
        resources: { table: { received: ['dynamodb:PutItem'] } } as never,
        filter: { body: { type: ['order.created'] } },
    }

    const result = subscribeToTopic(context as never, 'events', subscription)
    await settled(result.subscription.arn)

    expect(created.find(r => r.type === 'aws:sns/topicSubscription:TopicSubscription')!.inputs)
        .toMatchObject({ filterPolicy: '{"type":["order.created"]}', filterPolicyScope: 'MessageBody', protocol: 'lambda' })
})
