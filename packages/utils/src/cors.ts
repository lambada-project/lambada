export const getCorsHeaders = (domainName?: string, origins?: string[]) => {
    const allowedOrigins = origins?.map(x => x.trim()) ?? ["*"]
    const requestOrigin = (domainName ?? '').trim()

    const origin = allowedOrigins.indexOf("*") >= 0 ? "*" :
        allowedOrigins.find(x => x == requestOrigin) ??
        (allowedOrigins.shift() ?? "*")

    return {
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "*"
    }
}
