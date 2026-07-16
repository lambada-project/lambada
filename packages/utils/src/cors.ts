export const getRequestOrigin = (headers: { [name: string]: string | undefined } | null | undefined): string | undefined => {
    if (!headers) return undefined
    const key = Object.keys(headers).find(x => x.toLowerCase() === 'origin')
    return key ? headers[key] : undefined
}

export const getCorsHeaders = (requestOrigin: string | undefined, origins: string[] | undefined, allowHeaders: string[] | undefined) => {
    const allowedOrigins = origins?.map(x => x.trim()) ?? ["*"]
    const trimmedRequestOrigin = (requestOrigin ?? '').trim()

    const origin = allowedOrigins.indexOf("*") >= 0 ? "*" :
        allowedOrigins.find(x => x == trimmedRequestOrigin) ??
        (allowedOrigins[0] ?? "*")

    return {
        "Access-Control-Allow-Headers": allowHeaders ? allowHeaders.join(',') : "*",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH, TRACE, CONNECT",
        "Access-Control-Max-Age": '86400'
    }
}
