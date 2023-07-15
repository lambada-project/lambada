import { run, createEndpointSimple } from '@lambada/core'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config()

const projectName = pulumi.getProject()
const environment = pulumi.getStack()

const result = run(projectName, environment,
    {
        api: {
            endpointDefinitions: [
                (context) => ({
                    name: 'health',
                    path: '/health',
                    method: 'GET',
                    callbackDefinition: async (event) => ({ ok: true }),
                })
            ]
        }
    })


export const apiUrl = result.api.url