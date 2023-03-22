## LAMBADA
Lambada is a very opinionated set of tools and frameworks put together to speed up developer productivity.

We believe in "true" Infrastructure as Code, Replicable development environments, Integration Testing, Security, and Serverless.


## Example

Let's say we want to put all these together:
 - API Gateway
 - DynamoDB Table
 - Lambda to get list of TODO with
   - Readonly (Query) Access to the table 
 - CloudFront
 

We can get it in seconds with the following script:

```typescript
const result = run(projectName, environment, {
    endpointDefinitions: [
        (context) => ({
            path: '/todos',
            method: 'GET',
            callbackDefinition: async (event) => ({ result: [] }), // Just a callback with whatever data as body
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


## Tooling

Running `npm create @lambada` will bootstrap:

- DevContainer configuration
- Docker Compose with:
  - Dockerfile to dev on, with:
    - Node
    - AWS-SDK V2
    - Latest Pulumi CLI
  - DynamoDb container image
- Pre-populated package.json with:
  - AWS-SDK
  - Pulumi-SDK
  - @lambada/core
- Example `run` configuration with a health endpoint.

