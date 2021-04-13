import { run, createEndpointSimple } from '@lambada/core'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config()

const projectName = pulumi.getProject()
const environment = pulumi.getStack()

const result = run(projectName, environment,
    {
        endpointDefinitions: [
            (context) => createEndpointSimple('health', context, '/health', 'GET', async (event) => ({ ok: true }), [])
        ]
    })


//export const apiUrl = result.api.url