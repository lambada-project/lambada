import { ConfigureAwsEnvironment, RemoveResources } from '@lambada/core'

beforeAll(async () => {
    await ConfigureAwsEnvironment({
       // PUT YOUR TABLES HERE
    });
})