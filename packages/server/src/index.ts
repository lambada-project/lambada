process.env.PULUMI_TEST_MODE = "true"
import { EmbroideryApiEndpointCreator, EmbroideryRunArguments, createEndpointSimpleCors } from "@attire/core"
import * as Hapi from '@hapi/hapi'
import { EventHandlerRoute, Request, Response, Route } from '@pulumi/awsx/apigateway/api'
import { EventHandler, Callback } from '@pulumi/aws/lambda/lambdaMixins'
import { Function as LambdaFunction } from '@pulumi/aws/lambda/function'
import { Lifecycle } from "@hapi/hapi"


export async function server(projectName: string, environment: string, args: EmbroideryRunArguments) {

    const PORT = process.env.PORT || 3000
    const server = new Hapi.Server({
        host: 'localhost',
        port: PORT
    })

    const hapify = (definition: EmbroideryApiEndpointCreator): Hapi.ServerRoute => {
        const endpoint = definition({
            environment: environment,
            authorizers: [],
            environmentVariables: {},
        })
        const isEventHandler = (route: Route): route is EventHandlerRoute => {
            return typeof (route as EventHandlerRoute).eventHandler !== 'undefined' &&
                typeof (route as EventHandlerRoute).method !== 'undefined'
        }
        
        const isCallback = (handler: any): handler is Callback<Request, Response> => {
            return typeof (handler as Callback<Request, Response>).apply !== 'undefined';
        }
        /// EventHandlerRoute | StaticRoute | IntegrationRoute | RawDataRoute;
        const devCallback  = endpoint._devOnlyCallback
        if (isEventHandler(endpoint) && devCallback && isCallback(devCallback)) {

            return {
                method: endpoint.method,
                path: endpoint.path,
                handler: (request) => devCallback({
                    body: request.payload,

                } as any, {

                } as any,
                    () => ({})
                )
            }

        }
        throw 'Not implemented: Event handlers only'
    }

    server.route(args?.endpointDefinitions?.map(hapify) ?? [])

    await server.start()
    console.log('Dev-server started')
}

process.on('unhandledRejection', (err) => {

    console.log(err);
    process.exit(1);
});


server('example', 'dev', {
    endpointDefinitions: [
        (context) => createEndpointSimpleCors('test', context, '/test', 'GET', async (e) => ({
            data: "hello"
        }))
    ]
})