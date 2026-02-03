## LAMBADA
Lambada is a highly opinionated framework designed to simplify and accelerate the development of serverless applications. It provides a cohesive set of tools and abstractions for creating robust infrastructure with minimal effort.

### Key Features
- **True Infrastructure as Code**: Define your infrastructure entirely in TypeScript.
- **Replicable Development Environments**: Ensure consistency across local and production environments.
- **Security**: Simplified management of permissions and secrets.
- **Serverless First**: Optimized for serverless architectures with AWS.

## Example

Here’s how you can define an API Gateway, DynamoDB table, Lambda function, and CloudFront distribution in seconds:

```typescript
const result = run(projectName, environment, {
    endpointDefinitions: [
        (context) => ({
            path: '/todos',
            method: 'GET',
            callbackDefinition: async (event) => ({ result: [] }),
            resources: [{
                table: context.databases?.todos,
                access: [ LambdaResourceAccess.DynamoDbQuery ],
            }]
        })
    ],
    createOptionsForCors: true,
    tables: {
        'todos': {
            name: 'todos',
            primaryKey: 'userId',
            rangeKey: 'id',
            envKeyName: 'TODOS_TABLE_NAME'
        }
    },
    cdn: {
        useCDN: true
    },
});
```

## Tooling

Running `npm create @lambada` will bootstrap a project with:
- **DevContainer Configuration**: Pre-configured for VS Code.
- **Docker Compose**: Includes a development container with Node.js, AWS SDK, Pulumi CLI, and a local DynamoDB instance.
- **Pre-populated Package.json**: Includes dependencies like AWS SDK, Pulumi SDK, and Lambada core utilities.
- **Example Configuration**: A working example with a health endpoint and basic infrastructure setup.
