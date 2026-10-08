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
        const args = { rawMessageDelivery: true }

        expect(filterArgs('onOrder', undefined, args)).toBe(args)
    })

    test.each([
        [{ filterPolicy: '{"type":["a"]}' }, undefined, 'onOrder sets subscriptionArgs.filterPolicy; a subscription is filtered by its filter'],
        [{ filterPolicy: '{}' }, { body: { type: ['a'] } }, 'onOrder sets subscriptionArgs.filterPolicy'],
        [{ filterPolicyScope: 'MessageBody' }, undefined, 'onOrder sets subscriptionArgs.filterPolicyScope'],
        [{ filterPolicy: undefined }, undefined, 'onOrder sets subscriptionArgs.filterPolicy'],
    ])('is the only way to filter: subscriptionArgs %j is refused', (args, filter, message) => {
        expect(() => filterArgs('onOrder', filter as never, args as never)).toThrow(message)
    })

    test('takes no raw policy in its subscription args, in its types', () => {
        const typeOnly = () => {
            // @ts-expect-error
            filterArgs('onOrder', undefined, { filterPolicy: '{}' })
            // @ts-expect-error
            filterArgs('onOrder', undefined, { filterPolicyScope: 'MessageBody' })
        }
        expect(typeOnly).toBeFunction()
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
