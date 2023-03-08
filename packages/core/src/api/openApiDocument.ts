import * as AWS from 'aws-sdk'
import { LambadaResources } from '..'
import { createEndpoint } from './createEndpoint'
import { Request, Response, Route } from '@pulumi/awsx/apigateway/api'
import { Callback } from '@pulumi/aws/lambda'

export const getOpenApiDocument: Callback<Request, Response> = async (request: Request): Promise<Response> => {
    const gateway = new AWS.APIGateway({

    })

    const exported = await gateway.getExport({
        restApiId: request.requestContext.apiId,
        exportType: 'oas30',
        stageName: request.requestContext.stage,
        accepts: 'application/json'
    }).promise()

    let body = ''

    if (typeof exported.body === 'string')
        body = exported.body
    else if (exported.body)
        body = exported.body.toString()

    return {
        statusCode: 200,
        body: body,
        headers: {
            'Content-Type': "application/json"
        }
    }
}

export const createOpenApiDocumentEndpoint = (context: LambadaResources): any => {
    return createEndpoint<Request, Response>('openapi', context, '/openapi', 'GET', getOpenApiDocument, [], undefined, false, [
        {
            arn: 'arn:aws:apigateway',
            access: ['apigateway:GET']
        }
    ])
}