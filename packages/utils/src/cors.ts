export const getCorsHeaders = (domainName: string | undefined, origins: string[] | undefined, allowHeaders: string[] | undefined) => {
    const allowedOrigins = origins?.map(x => x.trim()) ?? ["*"]
    const requestOrigin = (domainName ?? '').trim()

    const origin = allowedOrigins.indexOf("*") >= 0 ? "*" :
        allowedOrigins.find(x => x == requestOrigin) ??
        (allowedOrigins.shift() ?? "*")

    return {
        "Access-Control-Allow-Headers": allowHeaders ? allowHeaders.join(',') : "*",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH, TRACE, CONNECT",
        "Access-Control-Max-Age": '86400'
    }
}
