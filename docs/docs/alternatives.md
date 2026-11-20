---
title: Why Lambada
sidebar_label: Why Lambada
slug: /alternatives
description: How Lambada compares with the Serverless Framework, AWS CDK and plain Pulumi, using one function that reads a table.
---

Take one function behind an HTTP route that reads one DynamoDB table, and compare how each tool declares it.

## Serverless Framework

```yaml title="serverless.yml"
functions:
  list:
    handler: todos/list.list
    environment:
      DYNAMODB_TABLE: ${self:service}-${sls:stage}
    events:
      - http:
          path: todos
          method: get

provider:
  iam:
    role:
      statements:
        - Effect: Allow
          Action: [dynamodb:Query]
          Resource: arn:aws:dynamodb:${aws:region}:*:table/${self:service}-${sls:stage}

resources:
  Resources:
    TodosTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:service}-${sls:stage}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - { AttributeName: id, AttributeType: S }
        KeySchema:
          - { AttributeName: id, KeyType: HASH }
```

Simple to start with, and its conventions are close to lambada's. But the table's name is spelled three times, IAM is written by hand and usually shared by every function, and `handler: todos/list.list` is a string: a typo there is found when the function is invoked, not when it is deployed.

## AWS CDK

```ts
const table = new dynamodb.Table(this, 'Todos', {
    partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
})

const list = new lambda.NodejsFunction(this, 'List', {
    entry: 'src/todos/list.ts',
    environment: { TABLE_NAME: table.tableName },
})
table.grantReadData(list)

const api = new apigateway.RestApi(this, 'Api')
api.root.addResource('todos').addMethod('GET', new apigateway.LambdaIntegration(list))
```

Everything is TypeScript, and `grantReadData` writes the IAM. But each step is separate: the grant, the environment variable that carries the name, and the route are three statements that have to agree, and nothing checks that the handler reads the variable the stack sets. The grant is also broader than the function needs: `grantReadData` allows scans and batch reads when the function only queries.

## Pulumi

Plain Pulumi is as expressive as the CDK, and its `CallbackFunction` lets the handler live in the program. You still write the role, the policy document, the attachment, the environment and the route for every function. That is the code lambada writes for you.

## Lambada

```ts
run('todos', pulumi.getStack(), {
    tables: {
        todos: { name: 'todos', primaryKey: 'id', envKeyName: 'TODOS_TABLE' },
    },
    api: {
        endpointDefinitions: [{
            name: 'listTodos', path: '/todos', method: 'GET', callbackDefinition: listTodos,
            resources: { table: { todos: ['dynamodb:Query'] } },
        }],
    },
})
```

- The handler is a function you import, so the compiler checks it exists.
- The grant names the table and the one action the function needs. lambada writes a role holding that and the permission to write logs, and sets `TODOS_TABLE` for that function only.
- A wrong name fails `pulumi preview`, naming the function and the resources the stack does have.
- Each environment (`pulumi.getStack()`) gets its own table, functions and API.

Lambada is built on Pulumi and returns what it builds. Anything it doesn't cover is plain Pulumi next to `run()`, in any provider: `@pulumi/cloudflare` for DNS, `@pulumi/kubernetes` for a cluster.

## When not to use Lambada

- **You need resources lambada has no kind for, everywhere.** It covers the serverless core: API Gateway REST APIs, Lambda, DynamoDB, S3, SNS, SQS, EventBridge schedules, KMS, Secrets Manager and Cognito. HTTP APIs (API Gateway v2), Step Functions or containers are plain Pulumi, which works, but the conventions stop at the edge of `run()`.
- **Your team isn't on TypeScript.** Stacks and handlers are both TypeScript.
- **You want no opinions.** Naming, tagging, how roles are built and the request/response contract are decided for you.

Curious? Deploy a stack in the [Quickstart](quickstart).
