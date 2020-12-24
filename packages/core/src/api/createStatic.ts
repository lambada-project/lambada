import { StaticRoute } from "@pulumi/awsx/apigateway/api";


export const createStaticEndpoint = (path: string, localPath: string) : StaticRoute => {
    return {
        path,
        localPath
    }
}