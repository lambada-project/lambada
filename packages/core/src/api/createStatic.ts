import { StaticRoute } from "@pulumi/awsx/classic/apigateway/api";


export const createStaticEndpoint = (path: string, localPath: string) : StaticRoute => {
    return {
        path,
        localPath
    }
}