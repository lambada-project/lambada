---
title: Alternatives
sidebar_label: Alternatives
slug: /alternatives
---


### Why not serverless, CDK, etc?


Let's compare how to get a function that has access to a dynamo table on each framework:

#### Serverless Framework
Looks very simple at first, a single lambda, and some policies to the table. Things can get complicated once you start having more and more resources.
The full example can be found [here](https://github.com/serverless/examples/blob/master/aws-node-typescript-rest-api-with-dynamodb/serverless.yml)
```yaml
functions:
  create:
    handler: todos/create.create
    events:
      - http:
          path: todos
          method: post
          cors: true

resources:
  Resources:
    TodosDynamoDbTable:
      Type: 'AWS::DynamoDB::Table'
      DeletionPolicy: Retain
      Properties:
        AttributeDefinitions:
          -
            AttributeName: id
            AttributeType: S
        KeySchema:
          -
            AttributeName: id
            KeyType: HASH
        ProvisionedThroughput:
          ReadCapacityUnits: 1
          WriteCapacityUnits: 1
        TableName: ${self:provider.environment.DYNAMODB_TABLE}
```

As with a lot of yaml-based frameworks, the handler and the code that creates and deploys it suffer from a disconnection. There a lot of room for failure. 
Under the `handler` section we can see how it's pointing to a (filepath).(module), anyone can have a typo here, plus imagine having dozens of handlers, it can get wild quickly.

I do like the simplicity of Serverless, and the way they abstract away a lot of things go hand to hand with the Lambada project. But if I'm doing typescript, I expect to do everything in typescript!



### CDK
What I like about CDK is that there is almost no yaml required, and that the IaC language can be shared with the application itself, in this example, we'll take a look at a nodejs [example](https://github.com/aws-samples/aws-cdk-examples/blob/master/typescript/api-cors-lambda-crud-dynamodb/index.ts)

``` typescript
    // ... unrelated code before this

    const dynamoTable = new dynamodb.Table(this, 'items', {
      partitionKey: {
        name: 'itemId',
        type: dynamodb.AttributeType.STRING
      },
      tableName: 'items',

      // The default removal policy is RETAIN, which means that cdk destroy will not attempt to delete
      // the new table, and it will remain in your account until manually deleted. By setting the policy to 
      // DESTROY, cdk destroy will delete the table (even if it has data in it)
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
    });

    const getOneLambda = new lambda.Function(this, 'getOneItemFunction', {
      code: new lambda.AssetCode('src'),
      handler: 'get-one.handler',
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: {
        TABLE_NAME: dynamoTable.tableName,
        PRIMARY_KEY: 'itemId'
      }
    });

    ////....


    dynamoTable.grantReadWriteData(getOneLambda);

    /// ...

    const api = new apigateway.RestApi(this, 'itemsApi', {
      restApiName: 'Items Service'
    });

    /// ...

    const singleItem = items.addResource('{id}');
    const getOneIntegration = new apigateway.LambdaIntegration(getOneLambda);
    singleItem.addMethod('GET', getOneIntegration);

```


We'll this goes on and on. There is a lot of manual work to do. I'm sure somebody is going to abstract this away and make a awsx or lambada-like library on top of CDK, but it won't be as battle tested as Pulumi (which if you have used pulumi already, this might look very familiar, looks like they were inspired by it).

One small bit we are missing here, is that, like in serverless, the handler and the definitions are also not run-time tight to each other. And it has to be manually matched.




## How does Lambada compare?
NOTE: In this case we are inlining the lambda definition and the lambda handler itself, but we recommend having it separate places so it can be integration-tested. You can see an example of how to do this [here](https://github.com/lambada-project/lambada/tree/main/example/src/api/todos).

Judge for yourself:
```typescript
const result = run(projectName, environment, {
    endpointDefinitions: [
        (context) => ({
            path: '/todos',
            method: 'GET',
            callbackDefinition: async (event) => ({ result: [] }), // Just a callback
            resources: [{ // When we set access on a resource, we inject the env var with the final name
                table: context.databases?.todos,
                access: [ LambdaResourceAccess.DynamoDbQuery ],
            }]
        })
    ],
    createOptionsForCors: true, // Want to have cors of all lambdas? Done
    tables: {
        'todos': {
            name: 'todos', // Will have a final name of {name}-{environment}
            primaryKey: 'userId',
            rangeKey: 'id',
            envKeyName: 'TODOS_TABLE_NAME' // To get the actual table name on runtime
        }
    },
    cdn: {
        useCDN: true // Want to have Cloudfront on top? Done
    },
})

```

We use the power of pulumi serialization and the abstractions on pulumi-awsx to get to this point. 
As you may see, this follows a very minimalistic and opinionated way to create *robust* infrastructure dancing-fast.

Of course, Lambada can create much more than this, and because it's using pulumi as a base, you can use any other pulumi provider along-side the aws one. 

- Need to use Azure to run some ML work? ` @pulumi/azure-native`
- Need to control some k8s clusters? `@pulumi/kubernetes`
- Need to set some records on a cloudflare-managed domain? `@pulumi/cloudflare`

Here is a complete list of all the official [pulumi providers](https://www.pulumi.com/docs/intro/cloud-providers)

We'll introduce more functionality as we need it, and don't expect Lambada to be a all-in-one solution. This library has an specific target, and for that works perfectly well!

Got curious about the project? Head over the [Quickstart](/quickstart) and try it for yourself.