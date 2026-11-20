import * as pulumi from "@pulumi/pulumi"
import type { SignedRoute } from "../apis"

/** The security definition a signed route requires, by the name it is written under. */
export const SIGV4 = 'sigv4'

const sigv4Definition = {
    type: 'apiKey',
    name: 'Authorization',
    in: 'header',
    'x-amazon-apigateway-authtype': 'awsSigv4',
}

type Operation = {
    'x-amazon-apigateway-auth'?: { type?: string }
    security?: { [name: string]: string[] }[]
}

type Swagger = {
    paths?: { [path: string]: { [method: string]: Operation } }
    securityDefinitions?: { [name: string]: unknown }
}

const ANY_METHOD = 'x-amazon-apigateway-any-method'

/** Every route of the API that requires a signature, as API Gateway enforces it. */
export const signedRoutes = (swagger: Swagger): SignedRoute[] =>
    Object.entries(swagger.paths ?? {}).flatMap(([path, methods]) => Object.entries(methods)
        .filter(([, operation]) => operation.security?.some(requirement => SIGV4 in requirement))
        .map(([method]) => `${method === ANY_METHOD ? 'ANY' : method.toUpperCase()} ${path}` as SignedRoute))

const isSigned = (operation: Operation) => operation['x-amazon-apigateway-auth']?.type === 'AWS_IAM'

/**
 * awsx marks a signed route with `x-amazon-apigateway-auth`, which an imported REST API ignores, leaving
 * the route open. A route requires a signature when its security names the `awsSigv4` definition, and
 * an API key the route also takes joins the same requirement, so a request must carry both.
 */
export const requireSignatures = (swagger: Swagger): Swagger => {
    const operations = Object.values(swagger.paths ?? {}).flatMap(methods => Object.values(methods))
    if (!operations.some(isSigned)) return swagger

    for (const operation of operations.filter(isSigned)) {
        delete operation['x-amazon-apigateway-auth']
        operation.security = [Object.assign({ [SIGV4]: [] }, ...operation.security ?? [])]
    }
    swagger.securityDefinitions = { ...swagger.securityDefinitions, [SIGV4]: sigv4Definition }
    return swagger
}

/** The body with every signed route enforced. A body without one is returned as it came, byte for byte. */
const enforcedBody = (body: string): string => {
    const swagger: Swagger = JSON.parse(body)
    const signed = Object.values(swagger.paths ?? {}).some(methods => Object.values(methods).some(isSigned))
    return signed ? JSON.stringify(requireSignatures(swagger)) : body
}

/** A transformation rather than a transform: it runs in the SDK, so the rewrite holds under mocks too. */
export const withSignedRoutes: pulumi.ResourceTransformation = ({ type, props, opts }) =>
    type === 'aws:apigateway/restApi:RestApi'
        ? { props: { ...props, body: pulumi.output(props.body).apply(enforcedBody) }, opts }
        : undefined
